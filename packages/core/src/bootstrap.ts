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
  type CoreSecurityService,
  type CoreThemeService as CoreThemeServiceContract
} from '@ricenote/shared';
import { escapeHtml, markTrusted, sanitizeRichText } from './render/safe-html.js';
import { capabilityMatches } from './capabilities.js';
import { loadConfig, type LoadConfigOptions, type RiceNoteConfig } from './config/loader.js';
import { createLogger, type Logger } from './logger.js';
import { createDatabaseAdapter, type DatabaseAdapter } from './database/adapter.js';
import { MigrationCoordinator } from './database/migrate-coordinator.js';
import { ServiceRegistry } from './services/registry.js';
import { EventBus } from './events/bus.js';
import { InMemoryOutbox, type Outbox } from './events/outbox.js';
import { RouterRegistry } from './routing/registry.js';
import { SlotRegistry } from './render/slots.js';
import { HtmlCache } from './render/cache.js';
import { ThemeRenderer } from './render/renderer.js';
import { AdminMenuRegistry } from './plugins/admin-menu.js';
import { PluginManager, type PluginBootstrapReport } from './plugins/manager.js';
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
  /** 当前实际启用的能力契约（供 `has_feature()` 使用）。 */
  enabledCapabilities(): string[];
  /** 判断某能力是否可用（支持 capability 契约、全名或短名）。 */
  hasFeature(query: string): boolean;
  health(): Promise<HealthReport>;
  shutdown(): Promise<void>;
  /** 插件启动报告（含失败与依赖问题，供后台展示）。 */
  readonly pluginReport: PluginBootstrapReport;
}

/** 启动内核。数据库不可用时抛出 DB_UNAVAILABLE。 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<RiceNoteKernel> {
  const config = loadConfig(options);
  const startedAt = Date.now();

  const logger = createLogger({
    level: config.logLevel,
    filePath: path.join(config.paths.logsDir, 'ricenote.log')
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
  const slots = new SlotRegistry(logger);
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

    // ---- 主题（需要在注册 Core 服务前可用）----
    themeManager = new ThemeManager({ config, logger, db, cache });

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
      invalidate: (tags: string[]) => cache.invalidateTags(tags)
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
      adminMenu,
      migrations,
      coreApiVersion: PLUGIN_API_VERSION
    });
    const pluginReport = await plugins.bootstrap();

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
      enabledCapabilities
    });

    await db.execute(
      `INSERT INTO rn_site_state (site_id, active_theme_id, runtime_status, app_version, started_at, updated_at)
       VALUES (?, NULL, 'running', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE runtime_status = 'running', app_version = VALUES(app_version), started_at = NOW(), updated_at = NOW()`,
      [config.site.id, APP_VERSION]
    );

    await migrations.releaseLock();

    logger.info('RiceNote 启动完成', {
      started: pluginReport.started.length,
      failed: pluginReport.failed.length,
      excluded: pluginReport.excluded.length,
      invalid: pluginReport.invalid.length,
      theme: (await themeManager.getActive()).manifest.id
    });

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
      enabledCapabilities,
      hasFeature: (query: string) => capabilityMatches(enabledCapabilities(), query),
      pluginReport,
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
          node: process.version
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
