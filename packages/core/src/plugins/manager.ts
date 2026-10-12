/**
 * 插件管理器：发现 → 校验 → 安装（迁移）→ 启用 → 启动 → 停止的全流程编排。
 *
 * 核心保证：
 * - 单个插件失败不影响其他插件（FAILED 独立记录）；
 * - 依赖问题在启动前一次性收集，并以"迭代剔除"方式收敛，避免连锁失败；
 * - 未声明能力的插件无法触碰数据库/路由/事件（由 ContextFactory 强制）；
 * - 停用前校验反向依赖，禁止破坏其他插件。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  PLUGIN_API_VERSION,
  type Plugin,
  type PluginContext,
  type Dispose,
  type SiteInfo
} from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  findCatalogEntryByNpm,
  satisfiesRange,
  type AdminMenuItem,
  type EffectiveSiteInfo,
  type PluginState,
  type PluginSourceInfo,
  type PluginSummary,
  type PluginDependencyInfo,
  type PluginSettingsDto
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
import { registerDeclaredAdminPages, resolveAdminPages } from './admin-pages.js';
import { isOfficialPlugin } from './catalog.js';
import { parsePackageSpec } from './install/sources.js';
import {
  discoverPlugins,
  discoverPluginsFrom,
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
import {
  assertPluginSettingsValid,
  buildPluginSettingsGroups,
  declaredSettingKeys,
  hasDeclarativeSettings,
  resolvePluginSettings,
  validatePluginSettingsValues
} from './settings-schema.js';

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
  /**
   * 生效中的站点信息（含后台覆盖）。
   *
   * 以**取值函数**而非快照传入：`ctx.site` 需要实时反映后台对站点信息的修改，
   * 而站点信息是可以在不重启的前提下变更的（与插件配置不同）。
   */
  siteInfo?: () => EffectiveSiteInfo;
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

    /*
     * 三个根目录都参与发现：官方目录、第三方安装目录、以及配置登记的本地开发目录。
     * 本地目录的存在让"开发调试直接引用源码、改动即生效"成为可能 ——
     * 它们不需要任何安装动作（见 `RICENOTE_LOCAL_PLUGINS`）。
     */
    const discovery = discoverPluginsFrom([
      config.paths.pluginsDir,
      config.paths.pluginsInstallDir,
      ...config.paths.localPluginDirs
    ]);
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
    /** 本次启动生效的来源（新建内置来源后同步进内存，避免再查一次库）。 */
    const sourceById = new Map<string, PluginSourceInfo>();

    for (const plugin of this.loaded.values()) {
      const id = plugin.manifest.id;
      const known = existing.get(id);
      if (!known) {
        const enabled = seed.has(id) || seed.has(shortName(id));
        await this.store.upsert(plugin, { enabled, state: enabled ? 'INSTALLED' : 'VALIDATED' });
      } else {
        await this.store.upsert(plugin, { enabled: known.enabled, state: known.state });
      }

      /*
       * 内置插件（随仓库一起分发）的来源**每次启动都以仓库路径为准**。
       *
       * 不沿用历史记录：内置插件的实际代码位置是确定的（就在 plugins/official 下），
       * 若沿用旧值，会出现"指向一个已被删除的目录"这类陈旧来源
       * （例如某次以同 ID 安装到 third-party、随后该目录被清理）。
       * 它也没有版本解析与更新检查，但扩展中心需要能区分"从哪来"。
       *
       * 非内置插件则保留已记录的来源 —— registry / git / zip 的记录是权威的。
       */
      if (plugin.builtin) {
        const source: PluginSourceInfo = {
          type: 'local',
          spec: path.relative(config.paths.rootDir, plugin.dir),
          via: 'directory'
        };
        await this.store.setSource(id, source);
        sourceById.set(id, source);
      } else if (known?.source) {
        sourceById.set(id, known.source);
      }
    }

    /*
     * 声明式清单核对（`RICENOTE_PLUGINS`）：**只报告、不安装**。
     *
     * 重建环境时清单是"期望状态"，而实际装了什么只有这里能对照出来；
     * 缺件与新版本都直接给出可执行的命令，避免变成"感觉少了点什么"。
     */
    this.reportDeclaredPlugins(config, logger);

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
      const source = sourceById.get(id);
      this.records.set(id, {
        id,
        state: enabledIds.has(id) ? 'INSTALLED' : 'DISABLED',
        enabled: enabledIds.has(id),
        ...(source ? { source } : {})
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
      this.patchRecord(id, { state: 'FAILED', enabled: true, lastError: message });
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
        this.patchRecord(id, { state: 'ENABLED', enabled: true });
        await this.store.setState(id, 'ENABLED');

        await this.startPlugin(plugin);
        started.push(id);
        this.patchRecord(id, { state: 'STARTED', enabled: true, startedAt: Date.now() });
        await this.store.setState(id, 'STARTED');
        logger.info('插件已启动', { plugin: id, version: plugin.manifest.version });
      } catch (error) {
        const message = error instanceof RiceNoteError ? `${error.code}: ${error.message}` : String(error);
        failed.push({ id, error: message });
        this.patchRecord(id, { state: 'FAILED', enabled: true, lastError: message });
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
      site: () => this.siteInfo(),
      pluginSettings: settings,
      logger: this.deps.logger
    };

    const bundle = createPluginContext(plugin, factoryDeps);
    const module = await loadPluginModule(plugin);
    this.modules.set(plugin.manifest.id, module);
    this.bundles.set(plugin.manifest.id, bundle);

    if (module.setup) {
      await module.setup(bundle.context);
      this.patchRecord(plugin.manifest.id, { state: 'ENABLED', enabled: true });
    }
    if (module.start) {
      await module.start(bundle.context);
    }

    /*
     * 声明式后台界面（manifest.admin.pages）：
     * 与插件在 start() 里自己调用 ctx.adminMenu.add 等价，但插件无需写注册代码。
     * 句柄同样交给 bundle 回收，因此"插件停止 = 菜单消失"保持一致。
     */
    const pageDisposers = registerDeclaredAdminPages(plugin, this.deps.adminMenu, this.deps.logger);
    if (pageDisposers.length > 0) {
      bundle.disposers.push(...pageDisposers);
      this.deps.logger.debug('插件后台界面已注册', {
        plugin: plugin.manifest.id,
        pages: pageDisposers.length
      });
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
    this.patchRecord(pluginId, { state: 'ENABLED', enabled: true });
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
    this.patchRecord(pluginId, { state: 'DISABLED', enabled: false, stoppedAt: Date.now() });
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

  /**
   * 更新内存记录（**合并**而非覆盖）。
   *
   * 直接 `records.set(id, { id, state, enabled })` 会把附加字段悄悄抹掉
   * （来源元数据、此前记录的错误等）—— 状态迁移只应该改状态。
   */
  /**
   * 核对 `RICENOTE_PLUGINS` 声明与磁盘实际安装情况。
   *
   * 三类问题各给一条可执行提示：
   * - 声明了但没装 → `pnpm plugin install <spec>`（或 `pnpm run setup -- --from-manifest`）；
   * - 已装版本不满足声明的区间 → `pnpm plugin update <id>`；
   * - 声明了未经官方目录收录的包 → 无法把包名映射到插件 ID，只能提示一句。
   *
   * 刻意**不**自动安装：启动路径联网装东西会让启动时间不可预测，
   * 失败也难定位；清单是意图声明，执行动作留给显式命令。
   */
  private reportDeclaredPlugins(config: RiceNoteConfig, logger: Logger): void {
    if (config.declaredPlugins.length === 0) return;

    for (const spec of config.declaredPlugins) {
      let name: string;
      let range: string;
      try {
        ({ name, range } = parsePackageSpec(spec));
      } catch {
        logger.warn('插件清单中存在无法解析的条目', { spec, hint: '形如 @scope/name@^1.0.0' });
        continue;
      }

      const entry = findCatalogEntryByNpm(name);
      if (!entry) {
        logger.warn('插件清单声明了未经官方插件目录收录的包', { spec, package: name });
        continue;
      }

      const installed = this.loaded.get(entry.id)?.manifest.version;
      if (!installed) {
        logger.warn('插件清单声明的插件尚未安装', {
          plugin: entry.id,
          spec,
          hint: `执行 pnpm plugin install ${spec}`
        });
        continue;
      }
      if (range !== 'latest' && !satisfiesRange(installed, range)) {
        logger.warn('已安装版本不满足插件清单声明', {
          plugin: entry.id,
          installed,
          declared: range,
          hint: `执行 pnpm plugin update ${entry.id}`
        });
      }
    }
  }

  private patchRecord(
    pluginId: string,
    patch: Partial<PluginRecord> & { state: PluginState }
  ): void {
    const existing = this.records.get(pluginId);
    const merged: PluginRecord = {
      ...existing,
      ...patch,
      id: pluginId,
      state: patch.state,
      // 显式兜底：首次记录（尚无记录）时也要得到一个合法的布尔值
      enabled: patch.enabled ?? existing?.enabled ?? false
    };
    this.records.set(pluginId, merged);
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
          /*
           * `official` 与 `builtin` 是两件事（见 ADR-016）：
           * builtin = 随仓库分发（不可卸载）；official = 属于官方插件目录
           * （从 npm 装的官方插件也可卸载，但仍显示"官方"并参与推荐版本比较）。
           */
          official: isOfficialPlugin(id, record?.source),
          path: plugin.dir,
          provides,
          capabilities: plugin.manifest.capabilities ?? [],
          dependencies,
          dependents: findDependents(all, id).filter((dependent) => enabledIds.has(dependent)),
          ...(record?.lastError ? { lastError: record.lastError } : {}),
          ...(record?.source ? { source: record.source } : {})
        };
      });
  }

  /**
   * 插件目录绝对路径。
   *
   * 用于托管插件自带的静态资源（后台界面）：托管方必须拿到"受信目录"，
   * 而不是让调用方拼接路径。
   */
  directoryOf(pluginId: string): string | undefined {
    return this.loaded.get(pluginId)?.dir;
  }

  /**
   * 卸载插件：移出内存记录并删除数据库元数据。
   *
   * 调用方负责先删磁盘目录（卸载编排里完成）。这里**只处理内核侧状态**，
   * 插件自己的数据表刻意保留（ADR-007：卸载不自动 drop 表）。
   */
  async forget(pluginId: string): Promise<void> {
    await this.store.remove(pluginId);
    this.records.delete(pluginId);
    this.modules.delete(pluginId);
    this.bundles.delete(pluginId);
    this.loaded.delete(pluginId);
  }

  /**
   * 记录或清除插件的来源元数据。
   *
   * 由安装编排与 ZIP 入口在**安装成功之后**调用；`undefined` 表示清除（卸载时用）。
   * 内存记录同步更新，后台列表无需重新查询数据库。
   */
  async recordSource(
    pluginId: string,
    source: PluginSourceInfo | undefined,
    meta?: { name?: string; version?: string; dir?: string }
  ): Promise<void> {
    await this.store.setSource(pluginId, source, meta);

    const record = this.records.get(pluginId);
    if (!record) return;
    if (source) record.source = source;
    else delete record.source;
  }

  /** 插件是否已启用（资源托管与菜单可见性共用同一判定）。 */
  isEnabled(pluginId: string): boolean {
    return this.records.get(pluginId)?.enabled ?? false;
  }

  /** 插件模块是否已启动（后台界面可用性的判定依据）。 */
  isStarted(pluginId: string): boolean {
    return this.modules.has(pluginId);
  }

  /**
   * 全部**已声明**的后台界面（含当前未启动的插件）。
   *
   * 用途：后台菜单除了已注册的可用入口，还要知道"这个地址本该属于哪个插件"，
   * 才能在插件被停用后给出可解释的提示（而不是 404 或静默跳转）。
   * 入口文件不存在的声明会被跳过（那属于构建/发布问题，由 validate 拦住）。
   */
  declaredAdminPages(): AdminMenuItem[] {
    const items: AdminMenuItem[] = [];
    for (const plugin of this.loaded.values()) {
      let pages;
      try {
        pages = resolveAdminPages(plugin);
      } catch (error) {
        this.deps.logger.debug('插件后台页面声明无法解析（已跳过）', {
          plugin: plugin.manifest.id,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

      for (const page of pages) {
        if (!existsSync(page.entryPath)) continue;
        // 声明了样式但文件缺失时不下发样式 URL：避免前端加载一个 404
        const hasStyle = page.stylePath !== undefined && existsSync(page.stylePath);
        items.push({
          id: page.id,
          label: page.label,
          path: page.path,
          pluginId: page.pluginId,
          entryUrl: page.entryUrl,
          available: this.isStarted(page.pluginId),
          ...(hasStyle && page.styleUrl ? { styleUrl: page.styleUrl } : {}),
          ...(page.icon ? { icon: page.icon } : {}),
          ...(page.order === undefined ? {} : { order: page.order }),
          ...(page.permission ? { permission: page.permission } : {})
        });
      }
    }
    return items;
  }

  /** 读取插件配置（声明式默认值 + 旧写法默认值 + 站点级覆盖）。 */
  async readSettings(pluginId: string): Promise<Record<string, unknown>> {
    const plugin = this.loaded.get(pluginId);
    if (!plugin) return {};
    return resolvePluginSettings(plugin.manifest, await this.overridesOf(pluginId));
  }

  /**
   * 后台设置面板数据（声明式分组 + 当前值 + 乐观锁版本）。
   *
   * 未声明 `settingsSchema` 的插件返回空分组，前端据此退化为键值编辑。
   */
  async settingsDto(pluginId: string): Promise<PluginSettingsDto> {
    const plugin = this.loaded.get(pluginId);
    if (!plugin) {
      throw new RiceNoteError(ErrorCode.PLUGIN_NOT_FOUND, `插件不存在：${pluginId}`, { status: 404 });
    }

    const overrides = (await this.store.loadSettings()).get(pluginId) ?? {};
    const values = resolvePluginSettings(plugin.manifest, overrides);
    const revision = await this.store.revisionOf(pluginId);

    return {
      pluginId,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      revision,
      groups: buildPluginSettingsGroups(plugin.manifest, values, this.effectiveSite().language),
      values,
      declarative: hasDeclarativeSettings(plugin.manifest),
      // ctx.config 是插件启动期快照（ADR-004），因此保存后必须重启才生效
      restartRequiredOnSave: true
    };
  }

  /** 插件声明的设置字段名（供后台提示与诊断）。 */
  declaredSettingKeysOf(pluginId: string): string[] {
    const plugin = this.loaded.get(pluginId);
    return plugin ? declaredSettingKeys(plugin.manifest) : [];
  }

  /**
   * 保存插件配置覆盖。
   *
   * 两段式：先按声明校验（声明式走字段类型/范围校验，旧写法只校验键范围），
   * 再与既有覆盖合并后落库 —— 合并而非替换，避免局部提交把其他字段清空。
   */
  async writeSettings(
    pluginId: string,
    siteId: string,
    values: Record<string, unknown>
  ): Promise<{ revision: number; values: Record<string, unknown> }> {
    const plugin = this.loaded.get(pluginId);
    if (!plugin) {
      throw new RiceNoteError(ErrorCode.PLUGIN_NOT_FOUND, `插件不存在：${pluginId}`, { status: 404 });
    }

    const checked = validatePluginSettingsValues(plugin.manifest, values);
    assertPluginSettingsValid(pluginId, checked);

    const existing = await this.overridesOf(pluginId);
    const merged: Record<string, unknown> = { ...existing, ...checked.normalized };

    const result = await this.store.saveSettings(pluginId, siteId, merged);
    this.deps.logger.info('插件配置已更新', {
      plugin: pluginId,
      revision: result.revision,
      fields: Object.keys(checked.normalized)
    });
    return { revision: result.revision, values: { ...values } };
  }

  /** 读取原始覆盖项（不含默认值）。 */
  private async overridesOf(pluginId: string): Promise<Record<string, unknown> | undefined> {
    return (await this.store.loadSettings()).get(pluginId);
  }

  /** 生效中的站点信息（由 bootstrap 注入的 provider 提供，缺失时回落到配置）。 */
  private effectiveSite(): EffectiveSiteInfo {
    const fromProvider = this.deps.siteInfo?.();
    if (fromProvider) return fromProvider;

    const { config } = this.deps;
    return {
      siteId: config.site.id,
      title: config.site.title,
      description: config.site.description,
      language: config.site.language,
      url: config.http.siteUrl,
      revision: 0,
      overridden: []
    };
  }

  /** 转换为插件可见的 `SiteInfo`（字段名差异在边界处收敛）。 */
  private siteInfo(): SiteInfo {
    const info = this.effectiveSite();
    return {
      id: info.siteId,
      title: info.title,
      description: info.description,
      url: info.url,
      language: info.language,
      ...(info.logoUrl ? { logoUrl: info.logoUrl } : {}),
      ...(info.faviconUrl ? { faviconUrl: info.faviconUrl } : {}),
      ...(info.icpText ? { icpText: info.icpText } : {}),
      ...(info.icpUrl ? { icpUrl: info.icpUrl } : {})
    };
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
