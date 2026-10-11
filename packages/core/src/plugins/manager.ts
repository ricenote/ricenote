/**
 * 插件管理器：发现 → 校验 → 安装（迁移）→ 启用 → 启动 → 停止的全流程编排。
 *
 * 核心保证：
 * - 单个插件失败不影响其他插件（FAILED 独立记录）；
 * - 依赖问题在启动前一次性收集，并以"迭代剔除"方式收敛，避免连锁失败；
 * - 未声明能力的插件无法触碰数据库/路由/事件（由 ContextFactory 强制）；
 * - 停用前校验反向依赖，禁止破坏其他插件。
 */

import {
  PLUGIN_API_VERSION,
  type Plugin,
  type PluginContext,
  type Dispose
} from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  type PluginState,
  type PluginSummary,
  type PluginDependencyInfo
} from '@ricenote/shared';
import type { RiceNoteConfig } from '../config/loader.js';
import type { Logger } from '../logger.js';
import type { DatabaseAdapter } from '../database/adapter.js';
import type { MigrationCoordinator } from '../database/migrate-coordinator.js';
import type { ServiceRegistry } from '../services/registry.js';
import type { EventBus } from '../events/bus.js';
import type { RouterRegistry } from '../routing/registry.js';
import type { SlotRegistry } from '../render/slots.js';
import type { AdminMenuRegistry } from './admin-menu.js';
import {
  discoverPlugins,
  loadPluginModule,
  readPluginMigrations,
  type InvalidPlugin,
  type LoadedPlugin
} from './manifest.js';
import {
  buildCapabilityIndex,
  findDependents,
  resolveDependencies,
  type DependencyProblem
} from './dependency-resolver.js';
import { assertTransition, type PluginRecord } from './lifecycle.js';
import { PluginStore } from './plugin-store.js';
import { createPluginContext, type ContextFactoryDeps, type PluginContextBundle } from './context-factory.js';

export interface PluginManagerDeps {
  config: RiceNoteConfig;
  logger: Logger;
  db: DatabaseAdapter;
  services: ServiceRegistry;
  events: EventBus;
  router: RouterRegistry;
  slots: SlotRegistry;
  adminMenu: AdminMenuRegistry;
  migrations: MigrationCoordinator;
  coreApiVersion?: string;
}

export interface PluginBootstrapReport {
  started: string[];
  failed: { id: string; error: string }[];
  excluded: string[];
  invalid: InvalidPlugin[];
  dependencyProblems: DependencyProblem[];
}

/** 取插件 ID 的最后一段作为短名（`rice.posts` → `posts`）。 */
export function shortName(pluginId: string): string {
  const parts = pluginId.split('.');
  return parts[parts.length - 1] ?? pluginId;
}

export class PluginManager {
  private readonly store: PluginStore;
  private loaded = new Map<string, LoadedPlugin>();
  private modules = new Map<string, Plugin>();
  private bundles = new Map<string, PluginContextBundle>();
  private records = new Map<string, PluginRecord>();
  private invalidPlugins: InvalidPlugin[] = [];
  private problems: DependencyProblem[] = [];
  /** 已停止的插件 ID（用于"注册表无残留"断言）。 */
  private readonly stoppedIds = new Set<string>();
  private readonly coreApiVersion: string;

  constructor(private readonly deps: PluginManagerDeps) {
    this.store = new PluginStore(deps.db);
    this.coreApiVersion = deps.coreApiVersion ?? PLUGIN_API_VERSION;
  }

  /* --------------------------- 启动编排 --------------------------- */

  async bootstrap(): Promise<PluginBootstrapReport> {
    const { config, logger, migrations, events } = this.deps;

    const discovery = discoverPlugins(config.paths.pluginsDir);
    this.invalidPlugins = discovery.invalid;
    this.loaded = new Map(discovery.plugins.map((plugin) => [plugin.manifest.id, plugin]));

    for (const invalid of discovery.invalid) {
      logger.error('插件 Manifest 校验失败，已忽略', {
        dir: invalid.dir,
        issues: invalid.issues.slice(0, 5)
      });
    }

    await migrations.ensureLedger();

    // 1) 同步发现结果到 rn_plugins（首次启动按种子配置启用）
    const existing = new Map((await this.store.list()).map((row) => [row.id, row]));
    const seed = new Set(config.seedPlugins);
    for (const plugin of this.loaded.values()) {
      const id = plugin.manifest.id;
      const known = existing.get(id);
      if (!known) {
        const enabled = seed.has(id) || seed.has(shortName(id));
        await this.store.upsert(plugin, { enabled, state: enabled ? 'INSTALLED' : 'VALIDATED' });
      } else {
        await this.store.upsert(plugin, { enabled: known.enabled, state: known.state });
      }
    }

    const enabledIds = new Set(
      (await this.store.list()).filter((row) => row.enabled).map((row) => row.id)
    );
    for (const id of enabledIds) {
      if (!this.loaded.has(id)) {
        logger.warn('数据库中标记为启用的插件在磁盘上不存在，已跳过', { plugin: id });
        enabledIds.delete(id);
      }
    }

    this.records = new Map();
    for (const plugin of this.loaded.values()) {
      const id = plugin.manifest.id;
      this.records.set(id, {
        id,
        state: enabledIds.has(id) ? 'INSTALLED' : 'DISABLED',
        enabled: enabledIds.has(id)
      });
    }

    // 2) 迭代剔除存在依赖问题的插件，直到收敛
    this.problems = [];
    const excluded = new Set<string>();
    let order: LoadedPlugin[] = [];

    for (let round = 0; round < 6; round += 1) {
      const candidateSet = new Set([...enabledIds].filter((id) => !excluded.has(id)));
      const resolution = resolveDependencies([...this.loaded.values()], candidateSet, this.coreApiVersion);
      this.problems = resolution.problems;
      order = resolution.order;

      const newlyBroken = new Set(
        resolution.problems.map((problem) => problem.pluginId).filter((id) => candidateSet.has(id))
      );
      if (newlyBroken.size === 0) break;
      for (const id of newlyBroken) excluded.add(id);
    }

    for (const id of excluded) {
      const problem = this.problems.find((item) => item.pluginId === id);
      const message = problem?.message ?? '依赖解析失败';
      this.records.set(id, { id, state: 'FAILED', enabled: true, lastError: message });
      await this.store.setState(id, 'FAILED', message);
      logger.error('插件因依赖问题被排除', { plugin: id, error: message });
    }

    // 3) 迁移 + 启动
    const started: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const plugin of order) {
      const id = plugin.manifest.id;
      try {
        await this.installMigrations(plugin);
        this.records.set(id, { id, state: 'ENABLED', enabled: true });
        await this.store.setState(id, 'ENABLED');

        await this.startPlugin(plugin);
        started.push(id);
        this.records.set(id, { id, state: 'STARTED', enabled: true, startedAt: Date.now() });
        await this.store.setState(id, 'STARTED');
        logger.info('插件已启动', { plugin: id, version: plugin.manifest.version });
      } catch (error) {
        const message = error instanceof RiceNoteError ? `${error.code}: ${error.message}` : String(error);
        failed.push({ id, error: message });
        this.records.set(id, { id, state: 'FAILED', enabled: true, lastError: message });
        await this.store.setState(id, 'FAILED', message);
        logger.error('插件启动失败', { plugin: id, error: message });
        await this.safeStop(id);
      }
    }

    // 全部插件启动完成后广播生命周期事件。
    // 需要"在其他插件订阅就绪之后再执行"的初始化逻辑（例如 identity 创建初始管理员、
    // 由 authorization 分派角色）必须挂在这里，而不是各自的 start() 中，
    // 否则会出现"事件已发出但订阅者尚未注册"的竞态。
    await events.emit(
      'core.runtime.started.v1',
      {
        started,
        failed: failed.map((item) => item.id),
        excluded: [...excluded]
      },
      { source: 'core' }
    );

    return {
      started,
      failed,
      excluded: [...excluded],
      invalid: this.invalidPlugins,
      dependencyProblems: this.problems
    };
  }

  /** 执行插件声明的迁移（加锁由调用方保证）。 */
  private async installMigrations(plugin: LoadedPlugin): Promise<void> {
    const migrations = readPluginMigrations(plugin);
    if (migrations.length === 0) return;
    const outcome = await this.deps.migrations.apply({
      scope: `plugin:${plugin.manifest.id}`,
      migrations
    });
    if (outcome.applied.length > 0) {
      this.deps.logger.info('插件迁移完成', {
        plugin: plugin.manifest.id,
        applied: outcome.applied
      });
    }
  }

  private async startPlugin(plugin: LoadedPlugin): Promise<void> {
    const settings = await this.store.loadSettings();
    const factoryDeps: ContextFactoryDeps = {
      db: this.deps.db,
      services: this.deps.services,
      events: this.deps.events,
      router: this.deps.router,
      slots: this.deps.slots,
      adminMenu: this.deps.adminMenu,
      site: {
        id: this.deps.config.site.id,
        title: this.deps.config.site.title,
        description: this.deps.config.site.description,
        url: this.deps.config.http.siteUrl,
        language: this.deps.config.site.language
      },
      pluginSettings: settings,
      logger: this.deps.logger
    };

    const bundle = createPluginContext(plugin, factoryDeps);
    const module = await loadPluginModule(plugin);
    this.modules.set(plugin.manifest.id, module);
    this.bundles.set(plugin.manifest.id, bundle);

    if (module.setup) {
      await module.setup(bundle.context);
      this.records.set(plugin.manifest.id, { id: plugin.manifest.id, state: 'ENABLED', enabled: true });
    }
    if (module.start) {
      await module.start(bundle.context);
    }
  }

  /* --------------------------- 启停 --------------------------- */

  /** 启用插件：需要重启进程使路由生效（ADR-004）。 */
  async enable(pluginId: string): Promise<{ restartRequired: true }> {
    const plugin = this.loaded.get(pluginId);
    if (!plugin) {
      throw new RiceNoteError(ErrorCode.PLUGIN_NOT_FOUND, `插件不存在：${pluginId}`, { status: 404 });
    }
    const record = this.records.get(pluginId);
    if (record?.enabled) {
      return { restartRequired: true };
    }
    await this.store.setEnabled(pluginId, true);
    this.records.set(pluginId, { id: pluginId, state: 'ENABLED', enabled: true });
    await this.store.setState(pluginId, 'ENABLED');
    return { restartRequired: true };
  }

  /** 禁用插件：若存在已启用的反向依赖则拒绝。 */
  async disable(pluginId: string): Promise<{ restartRequired: true }> {
    const plugin = this.loaded.get(pluginId);
    if (!plugin) {
      throw new RiceNoteError(ErrorCode.PLUGIN_NOT_FOUND, `插件不存在：${pluginId}`, { status: 404 });
    }

    const enabledIds = new Set(
      [...this.records.values()].filter((record) => record.enabled).map((record) => record.id)
    );
    enabledIds.delete(pluginId);
    const dependents = findDependents([...this.loaded.values()], pluginId).filter(
      (id) => id !== pluginId && enabledIds.has(id)
    );

    if (dependents.length > 0) {
      throw new RiceNoteError(
        ErrorCode.DEPENDENCY_DISABLED,
        `无法禁用 ${pluginId}：以下已启用插件依赖它 —— ${dependents.join('、')}`,
        { status: 409, details: { pluginId, dependents } }
      );
    }

    await this.safeStop(pluginId);
    await this.store.setEnabled(pluginId, false);
    await this.store.setState(pluginId, 'DISABLED');
    this.records.set(pluginId, { id: pluginId, state: 'DISABLED', enabled: false, stoppedAt: Date.now() });
    return { restartRequired: true };
  }

  /** 停止单个插件并注销其全部注册项。 */
  private async safeStop(pluginId: string): Promise<void> {
    const module = this.modules.get(pluginId);
    const bundle = this.bundles.get(pluginId);

    if (module?.stop && bundle) {
      try {
        await module.stop(bundle.context);
      } catch (error) {
        this.deps.logger.error('插件 stop() 抛出异常', {
          plugin: pluginId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // 兜底注销：插件若忘记调用某些句柄，这里补齐，保证注册表干净
    const viaPlugin = bundle ? bundle.disposers.length : 0;
    this.disposeAll(bundle);
    if (bundle && viaPlugin > 0) {
      this.deps.logger.debug('插件未自行注销全部句柄，已由 Core 兜底释放', {
        plugin: pluginId,
        remaining: viaPlugin
      });
    }

    this.modules.delete(pluginId);
    this.bundles.delete(pluginId);
    this.stoppedIds.add(pluginId);
  }

  /** 兜底注销：调用所有尚未释放的句柄。 */
  private disposeAll(bundle?: PluginContextBundle): void {
    if (!bundle) return;
    const remaining: Dispose[] = bundle.disposers.splice(0, bundle.disposers.length);
    for (const dispose of remaining) {
      try {
        dispose();
      } catch {
        /* 注销异常不阻塞关停流程 */
      }
    }
  }

  /** 停止全部插件（进程关停时调用）。 */
  async stopAll(): Promise<void> {
    for (const pluginId of [...this.modules.keys()].reverse()) {
      await this.safeStop(pluginId);
      const record = this.records.get(pluginId);
      if (record) {
        this.records.set(pluginId, { ...record, state: 'STOPPED', stoppedAt: Date.now() });
      }
    }
  }

  /* --------------------------- 查询 --------------------------- */

  /**
   * 校验**已停止**的插件没有在注册表中留下任何痕迹。
   *
   * 这是"低耦合、可独立启停"的核心可验证承诺：插件被禁用后，
   * 它注册的路由、服务、Slot、后台菜单与事件订阅都必须不可见。
   * （仍在运行的插件自然持有注册项，因此不参与校验。）
   */
  assertNoLeaks(): void {
    const residual: string[] = [];

    for (const pluginId of this.stoppedIds) {
      const routes = this.deps.router.ownedBy(pluginId);
      const owned = {
        pageRoutes: routes.pages,
        rawRoutes: routes.raw,
        adminRoutes: routes.admin,
        services: this.deps.services.ownedBy(pluginId),
        slots: this.deps.slots.ownedBy(pluginId),
        menuItems: this.deps.adminMenu.ownedBy(pluginId),
        events: this.deps.events.ownedBy(pluginId)
      };

      const count = Object.values(owned).reduce((total, list) => total + list.length, 0);
      if (count > 0) residual.push(`${pluginId}: ${JSON.stringify(owned)}`);
    }

    if (residual.length > 0) {
      throw new RiceNoteError(
        ErrorCode.PLUGIN_STOP_FAILED,
        `插件停止后仍在注册表中残留资源 —— ${residual.join(' | ')}`,
        { status: 500, details: { residual } }
      );
    }
  }

  /** 已停止插件的数量（诊断用）。 */
  get stoppedCount(): number {
    return this.stoppedIds.size;
  }

  /** 构建后台需要的插件摘要列表。 */
  summary(): PluginSummary[] {
    const all = [...this.loaded.values()];
    const enabledIds = new Set(
      [...this.records.values()].filter((record) => record.enabled).map((record) => record.id)
    );

    return all
      .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))
      .map((plugin) => {
        const id = plugin.manifest.id;
        const record = this.records.get(id);
        const provides = plugin.manifest.provides ?? [];
        const dependencies: PluginDependencyInfo[] = Object.entries(plugin.manifest.requires ?? {}).map(
          ([key, range]) => {
            const problem = this.problems.find((item) => item.pluginId === id && item.key === key);
            return {
              key,
              range,
              satisfied: !problem,
              isCapability: key.includes('@'),
              ...(problem ? {} : { providedBy: this.resolveProviderOf(key) })
            };
          }
        );

        return {
          id,
          name: plugin.manifest.name,
          ...(plugin.manifest.description ? { description: plugin.manifest.description } : {}),
          version: plugin.manifest.version,
          apiVersion: plugin.manifest.apiVersion,
          ...(plugin.manifest.author ? { author: plugin.manifest.author } : {}),
          state: (record?.state ?? 'DISCOVERED') as PluginState,
          enabled: record?.enabled ?? false,
          builtin: plugin.builtin,
          path: plugin.dir,
          provides,
          capabilities: plugin.manifest.capabilities ?? [],
          dependencies,
          dependents: findDependents(all, id).filter((dependent) => enabledIds.has(dependent)),
          ...(record?.lastError ? { lastError: record.lastError } : {})
        };
      });
  }

  /** 读取插件配置（Manifest 默认值 + 站点级覆盖）。 */
  async readSettings(pluginId: string): Promise<Record<string, unknown>> {
    const plugin = this.loaded.get(pluginId);
    const overrides = (await this.store.loadSettings()).get(pluginId) ?? {};
    return { ...(plugin?.manifest.settings ?? {}), ...overrides };
  }

  /** 保存插件配置覆盖（返回新的 revision）。 */
  async writeSettings(
    pluginId: string,
    siteId: string,
    values: Record<string, unknown>
  ): Promise<{ revision: number }> {
    const result = await this.store.saveSettings(pluginId, siteId, values);
    this.deps.logger.info('插件配置已更新', { plugin: pluginId, revision: result.revision });
    return result;
  }

  /** 解析依赖键对应的提供者插件 ID（capability 或插件 ID）。 */
  private resolveProviderOf(key: string): string | undefined {
    if (key.includes('@')) {
      const provider = buildCapabilityIndex([...this.loaded.values()]).find((entry) => entry.raw === key);
      return provider?.pluginId;
    }
    return this.loaded.has(key) ? key : undefined;
  }

  getRecord(pluginId: string): PluginRecord | undefined {
    return this.records.get(pluginId);
  }

  getInvalidPlugins(): InvalidPlugin[] {
    return this.invalidPlugins;
  }

  getDependencyProblems(): DependencyProblem[] {
    return this.problems;
  }

  getCoreApiVersion(): string {
    return this.coreApiVersion;
  }

  /** 已启动的插件 ID 列表。 */
  startedIds(): string[] {
    return [...this.records.values()].filter((record) => record.state === 'STARTED').map((record) => record.id);
  }
}
