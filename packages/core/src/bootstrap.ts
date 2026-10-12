/**
 * 内核组装与启动编排。
 *
 * 启动顺序（对应架构文档第 2 节）：
 *   配置 → 日志 → 数据库 → Core 迁移（加锁）→ 注册表
 *   → 安全组件 + Core 服务（必须先于插件，插件启动时会消费这些服务）
 *   → 主题同步 → 插件发现/依赖解析/迁移/启动 → 释放锁 → 渲染器 → 运行标记
 *
 * 若数据库不可用，`bootstrap` 抛出 DB_UNAVAILABLE，由调用方（服务端）
 * 切换到恢复模式，保证"核心可独立启动并展示安装/维护界面"。
 */

import path from 'node:path';
import { PLUGIN_API_VERSION } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  type CoreHtmlService,
  type CoreRuntimeService,
  type CoreSecurityService,
  type CoreSiteService,
  type CoreThemeService as CoreThemeServiceContract,
  type EffectiveSiteInfo
} from '@ricenote/shared';
import { escapeHtml, markTrusted, sanitizeRichText } from './render/safe-html.js';
import { capabilityMatches } from './capabilities.js';
import { loadConfig, type LoadConfigOptions, type RiceNoteConfig } from './config/loader.js';
import { createLogger, resolveLogFormat, type Logger } from './logger.js';
import { SiteSettingsProvider } from './system/site-settings.js';
import { RestartCoordinator } from './system/runtime.js';
import { printStartupBanner } from './startup-banner.js';
import { createDatabaseAdapter, type DatabaseAdapter } from './database/adapter.js';
import { MigrationCoordinator } from './database/migrate-coordinator.js';
import { ServiceRegistry } from './services/registry.js';
import { EventBus } from './events/bus.js';
import { InMemoryOutbox, type Outbox } from './events/outbox.js';
import { RouterRegistry } from './routing/registry.js';
import { SlotRegistry } from './render/slots.js';
import { ExtensionRegistry } from './extensions/registry.js';
import { HtmlCache } from './render/cache.js';
import { ThemeRenderer } from './render/renderer.js';
import { AdminMenuRegistry } from './plugins/admin-menu.js';
import { PluginManager, type PluginBootstrapReport } from './plugins/manager.js';
import { PluginInstallRunner } from './plugins/install/jobs.js';
import { ThemeManager } from './themes/manager.js';
import { SessionManager } from './security/session.js';
import { CsrfManager, LoginThrottle } from './security/csrf.js';
import { AuditLogger } from './security/audit.js';
import { SecurityGateway } from './security/gateway.js';
import { APP_VERSION } from './version.js';

export { APP_VERSION };

export interface BootstrapOptions extends LoadConfigOptions {
  /** 是否信任反向代理头（Nginx 场景为 true）。 */
  trustProxy?: boolean;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  database: { reachable: boolean; latencyMs: number | null };
  plugins: { started: number; failed: number; invalid: number };
  theme: { id: string; version: string } | null;
  cache: ReturnType<HtmlCache['stats']>;
  node: string;
  /** 是否存在需要重启才能生效的变更。 */
  restartRequired: boolean;
}

/** 组装完成的内核对象。 */
export interface RiceNoteKernel {
  config: RiceNoteConfig;
  logger: Logger;
  db: DatabaseAdapter;
  migrations: MigrationCoordinator;
  services: ServiceRegistry;
  events: EventBus;
  outbox: Outbox;
  router: RouterRegistry;
  slots: SlotRegistry;
  /** 命名扩展点注册表（后台扩展点下发与诊断接口读取它）。 */
  extensions: ExtensionRegistry;
  adminMenu: AdminMenuRegistry;
  plugins: PluginManager;
  themeManager: ThemeManager;
  renderer: ThemeRenderer;
  cache: HtmlCache;
  sessions: SessionManager;
  csrf: CsrfManager;
  throttle: LoginThrottle;
  audit: AuditLogger;
  gateway: SecurityGateway;
  /** 站点信息运行时覆盖层（env 默认值 + 数据库覆盖）。 */
  site: SiteSettingsProvider;
  /** 待重启状态与重启请求（机制由进程入口注入）。 */
  runtime: RestartCoordinator;
  /**
   * 插件安装任务队列（安装 / 更新 / 卸载）。
   *
   * 后台与 CLI 共用同一个执行器：任务在进程内串行执行、状态落库，
   * 因此 CLI 装到一半与后台点安装不会互相踩磁盘。
   */
  installer: PluginInstallRunner;
  /** 当前实际启用的能力契约（供 `has_feature()` 使用）。 */
  enabledCapabilities(): string[];
  /** 判断某能力是否可用（支持 capability 契约、全名或短名）。 */
  hasFeature(query: string): boolean;
  health(): Promise<HealthReport>;
  shutdown(): Promise<void>;
  /** 插件启动报告（含失败与依赖问题，供后台展示）。 */
  readonly pluginReport: PluginBootstrapReport;
  /**
   * 本次启动时间（ISO 8601）。
   *
   * 前端在软重启后通过它判断"已经是新进程"，从而结束"重启中"的等待状态。
   */
  readonly startedAt: string;
}

/** 启动内核。数据库不可用时抛出 DB_UNAVAILABLE。 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<RiceNoteKernel> {
  const config = loadConfig(options);
  const startedAt = Date.now();

  // 终端与日志文件分离：文件恒为 JSON Lines，终端默认可读格式
  const logFormat = resolveLogFormat();
  const logger = createLogger({
    level: config.logLevel,
    filePath: path.join(config.paths.logsDir, 'ricenote.log'),
    format: logFormat
  });

  logger.info('RiceNote 启动中', {
    env: config.env,
    version: APP_VERSION,
    node: process.version,
    site: config.site.id
  });

  // ---- 数据库 ----
  const db = createDatabaseAdapter(config);
  const reachable = await db.ping();
  if (!reachable) {
    await db.close().catch(() => undefined);
    throw new RiceNoteError(
      ErrorCode.DB_UNAVAILABLE,
      `无法连接数据库 ${config.database.host}:${config.database.port}/${config.database.name}`,
      { status: 503, details: { host: config.database.host, port: config.database.port } }
    );
  }

  const migrations = new MigrationCoordinator(config, logger);
  await migrations.ensureLedger();

  if (!(await migrations.acquireLock())) {
    await db.close().catch(() => undefined);
    throw new RiceNoteError(ErrorCode.MIGRATION_LOCKED, '另一个实例正在执行迁移，请稍后重试', {
      status: 503
    });
  }

  // ---- 注册表 ----
  const services = new ServiceRegistry();
  const events = new EventBus(logger);
  const outbox = new InMemoryOutbox();
  const router = new RouterRegistry();
  // 扩展点注册表先于 slots 创建：slots 已退化为它的 render 作用域门面
  const extensions = new ExtensionRegistry(logger);
  const slots = new SlotRegistry(extensions, logger);
  const adminMenu = new AdminMenuRegistry();
  const cache = new HtmlCache({
    enabled: config.render.cacheEnabled,
    ttlSeconds: config.render.cacheTtlSeconds
  });

  // ---- 安全组件（必须先于插件启动，因为插件会注册解析器）----
  const sessions = new SessionManager({
    secret: config.security.sessionSecret,
    ttlSeconds: config.security.sessionTtlSeconds,
    cookieSecure: config.env === 'production',
    cookieSameSite: 'lax'
  });

  const csrf = new CsrfManager({
    secret: config.security.sessionSecret,
    enabled: config.security.csrfEnabled
  });

  const throttle = new LoginThrottle({ maxAttempts: 8, windowSeconds: 300, blockSeconds: 900 });
  const audit = new AuditLogger(db, config.site.id, logger);

  const gateway = new SecurityGateway({
    sessionManager: sessions,
    csrfManager: csrf,
    audit,
    logger,
    trustProxy: options.trustProxy ?? config.env === 'production'
  });

  let themeManager!: ThemeManager;

  try {
    await migrations.applyCore();

    // ---- 站点信息覆盖层（必须先于主题/插件，因为文案与站点名都取自它）----
    const siteProvider = new SiteSettingsProvider({ config, logger, db });
    await siteProvider.ensureLoaded();
    const siteInfo = (): EffectiveSiteInfo => siteProvider.info();

    // ---- 待重启状态（落库，重启后仍可见）----
    const restart = new RestartCoordinator({ config, logger, db });
    await restart.load();

    // ---- 主题（需要在注册 Core 服务前可用）----
    themeManager = new ThemeManager({
      config,
      logger,
      db,
      cache,
      siteLanguage: () => siteInfo().language
    });

    // ---- 发布 Core 自身的服务契约 ----
    const securityService: CoreSecurityService = {
      registerSessionResolver: (resolver) => {
        sessions.setResolver(async (sessionId) => {
          const resolved = await resolver(sessionId);
          if (!resolved) return undefined;
          return {
            user: resolved.user,
            sessionId: resolved.sessionId,
            expiresAt: new Date(resolved.expiresAt)
          };
        });
      },
      registerAuthorizationResolver: (resolver) => {
        gateway.setAuthorizationResolver({
          permissionsOf: (userId) => resolver.permissionsOf(userId),
          rolesOf: (userId) => resolver.rolesOf(userId)
        });
      }
    };

    const themeService: CoreThemeServiceContract = {
      activeThemeId: async () => (await themeManager.getActive()).manifest.id,
      settings: async () =>
        (await themeManager.resolveSettings(await themeManager.getActive())).values,
      pageTemplates: () => themeManager.activePageTemplates(),
      invalidate: (tags: string[]) => cache.invalidateTags(tags),
      clearCache: () => cache.clear()
    };

    const siteService: CoreSiteService = {
      info: () => siteInfo()
    };

    services.provide('core', {
      name: SERVICE_CONTRACTS.CORE_SECURITY,
      version: '1.0.0',
      implementation: securityService
    });
    services.provide('core', {
      name: SERVICE_CONTRACTS.CORE_THEME,
      version: '1.0.0',
      implementation: themeService
    });
    services.provide('core', {
      name: SERVICE_CONTRACTS.CORE_SITE,
      version: '1.0.0',
      implementation: siteService
    });
    services.provide('core', {
      name: SERVICE_CONTRACTS.CORE_RUNTIME,
      version: '1.0.0',
      implementation: restart satisfies CoreRuntimeService as CoreRuntimeService
    });

    services.provide('core', {
      name: SERVICE_CONTRACTS.CORE_SETUP,
      version: '1.0.0',
      implementation: {
        siteId: () => config.site.id,
        bootstrapAdmin: () => ({
          username: config.bootstrap.adminUsername,
          password: config.bootstrap.adminPassword,
          email: config.bootstrap.adminEmail
        }),
        paths: () => ({
          storageDir: config.paths.storageDir,
          uploadsDir: config.paths.uploadsDir,
          cacheDir: config.paths.cacheDir
        })
      }
    });

    services.provide('core', {
      name: SERVICE_CONTRACTS.CORE_HTML,
      version: '1.0.0',
      implementation: {
        sanitize: (dirty: string, options?: { extraTags?: string[] }) =>
          sanitizeRichText(dirty, options ?? {}),
        markTrusted: (html: string) => markTrusted(html),
        escape: (text: string) => escapeHtml(text)
      } satisfies CoreHtmlService
    });

    await themeManager.sync();

    // ---- 插件 ----
    const plugins = new PluginManager({
      config,
      logger,
      db,
      services,
      events,
      router,
      slots,
      extensions,
      adminMenu,
      migrations,
      siteInfo,
      coreApiVersion: PLUGIN_API_VERSION
    });
    const pluginReport = await plugins.bootstrap();

    /*
     * 安装任务队列：与后台/CLI 共用。
     *
     * 依赖 `plugins.recordSource`（写来源与内存记录）与 `restart.markRestartRequired`
     * （安装后必须重启才生效），因此必须在两者之后创建。
     */
    const installer = new PluginInstallRunner({
      db,
      config,
      logger,
      plugins,
      markRestartRequired: (input) => restart.markRestartRequired(input),
      audit: (input) =>
        audit.record({
          action: input.action,
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          ...(input.targetId === undefined ? {} : { targetType: 'plugin', targetId: input.targetId }),
          detail: input.detail
        })
    });

    const enabledCapabilities = (): string[] => {
      const provided: string[] = [];
      for (const plugin of plugins.summary()) {
        if (plugin.state === 'STARTED') provided.push(...plugin.provides);
      }
      return provided.sort();
    };

    const renderer = new ThemeRenderer({
      config,
      logger,
      themeManager,
      slots,
      router,
      cache,
      enabledCapabilities,
      siteInfo
    });

    await db.execute(
      `INSERT INTO rn_site_state (site_id, active_theme_id, runtime_status, app_version, started_at, updated_at)
       VALUES (?, NULL, 'running', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE runtime_status = 'running', app_version = VALUES(app_version), started_at = NOW(), updated_at = NOW()`,
      [config.site.id, APP_VERSION]
    );

    await migrations.releaseLock();

    /*
     * 启动成功即认为"待生效变更"已被本次启动消费掉。
     *
     * 顺序很关键：必须在插件全部启动、主题同步完成之后清除，
     * 否则重启过程中若启动失败，标记会丢失，管理员将不知道还需要再重启一次。
     */
    const pendingBefore = restart.state();
    await restart.clearRestartRequired();

    const activeTheme = await themeManager.getActive();
    const dbLatency = await measureLatency(db);

    logger.info('RiceNote 启动完成', {
      started: pluginReport.started.length,
      failed: pluginReport.failed.length,
      excluded: pluginReport.excluded.length,
      invalid: pluginReport.invalid.length,
      theme: activeTheme.manifest.id
    });

    printStartupBanner(
      {
        version: APP_VERSION,
        env: config.env,
        node: process.version,
        rootDir: config.paths.rootDir,
        database: {
          host: config.database.host,
          port: config.database.port,
          name: config.database.name,
          latencyMs: dbLatency
        },
        theme: {
          id: activeTheme.manifest.id,
          name: activeTheme.manifest.name,
          version: activeTheme.manifest.version
        },
        plugins: {
          started: pluginReport.started,
          failed: pluginReport.failed,
          excluded: pluginReport.excluded,
          invalid: pluginReport.invalid.map((item) => ({
            dir: item.dir,
            ...(item.id ? { id: item.id } : {}),
            message: item.issues
              .slice(0, 3)
              .map((issue) => `${issue.path} ${issue.message}`)
              .join('；')
          }))
        },
        routes: {
          pages: router.pages().length,
          admin: router.adminRoutesList().length,
          raw: router.rawRoutesList().length
        },
        services: services.list().length,
        slots: slots.list().length,
        events: events.list().length,
        http: {
          host: config.http.host,
          port: config.http.port,
          siteUrl: config.http.siteUrl
        },
        durationMs: Date.now() - startedAt,
        // 若本次启动是"为应用待生效变更"而发生的，把原因回显出来便于确认
        appliedPendingChange: pendingBefore.restartRequired ? pendingBefore.reason : undefined
      },
      logFormat
    );

    return {
      config,
      logger,
      db,
      migrations,
      services,
      events,
      outbox,
      router,
      slots,
      extensions,
      adminMenu,
      plugins,
      themeManager,
      renderer,
      cache,
      sessions,
      csrf,
      throttle,
      audit,
      gateway,
      site: siteProvider,
      runtime: restart,
      installer,
      enabledCapabilities,
      hasFeature: (query: string) => capabilityMatches(enabledCapabilities(), query),
      pluginReport,
      startedAt: new Date(startedAt).toISOString(),
      async health(): Promise<HealthReport> {
        const latencyStart = Date.now();
        const ok = await db.ping();
        const latencyMs = ok ? Date.now() - latencyStart : null;
        const summary = plugins.summary();

        let theme: { id: string; version: string } | null = null;
        try {
          const active = await themeManager.getActive();
          theme = { id: active.manifest.id, version: active.manifest.version };
        } catch {
          theme = null;
        }

        return {
          status: ok && pluginReport.failed.length === 0 ? 'ok' : 'degraded',
          version: APP_VERSION,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          database: { reachable: ok, latencyMs },
          plugins: {
            started: summary.filter((item) => item.state === 'STARTED').length,
            failed: summary.filter((item) => item.state === 'FAILED').length,
            invalid: pluginReport.invalid.length
          },
          theme,
          cache: cache.stats(),
          node: process.version,
          restartRequired: restart.state().restartRequired
        };
      },
      async shutdown(): Promise<void> {
        logger.info('RiceNote 正在关停');
        await plugins.stopAll();
        await db
          .execute("UPDATE rn_site_state SET runtime_status = 'stopped', updated_at = NOW() WHERE site_id = ?", [
            config.site.id
          ])
          .catch(() => undefined);
        await db.close().catch(() => undefined);
        logger.info('RiceNote 已关停');
      }
    };
  } catch (error) {
    await migrations.releaseLock().catch(() => undefined);
    await db.close().catch(() => undefined);
    throw error;
  }
}

/** 测量数据库往返延迟（仅用于启动横幅展示，失败不影响启动）。 */
async function measureLatency(db: DatabaseAdapter): Promise<number | null> {
  const start = Date.now();
  const reachable = await db.ping().catch(() => false);
  return reachable ? Date.now() - start : null;
}
