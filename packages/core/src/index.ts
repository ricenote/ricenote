/**
 * @ricenote/core —— RiceNote 内核。
 *
 * 对外只暴露"组装入口 + 内核对象 + 稳定的注册表类型"，
 * 插件与主题一律通过 SDK 接触内核，不直接依赖本包的内部模块。
 */

export { bootstrap, APP_VERSION, type BootstrapOptions, type RiceNoteKernel, type HealthReport } from './bootstrap.js';
export { capabilityMatches } from './capabilities.js';

export {
  loadConfig,
  assertConfig,
  parseDatabaseUrl,
  resolveRootDir,
  type RiceNoteConfig,
  type LoadConfigOptions
} from './config/loader.js';
export { createLogger, parseLogLevel, LOG_LEVELS, type Logger, type LogLevel, type LoggerOptions } from './logger.js';

export { createDatabaseAdapter, DatabaseAdapter, PluginScopedDatabase, scopedTableName, type OrmHandle, type QueryRunner } from './database/adapter.js';
export { MigrationCoordinator, checksumOf, MIGRATION_LOCK_NAME, type MigrationSource, type MigrationOutcome } from './database/migrate-coordinator.js';
export { CORE_MIGRATIONS, type CoreMigration } from './database/core-migrations.js';

export { ServiceRegistry } from './services/registry.js';
export { EventBus } from './events/bus.js';
export { InMemoryOutbox, type Outbox, type OutboxMessage } from './events/outbox.js';
export { RouterRegistry, type RegisteredPageRoute, type RegisteredRawRoute, type RegisteredAdminRoute } from './routing/registry.js';
export { buildPath, absoluteUrl, normalizePath, routeSignature } from './routing/url.js';

export { SlotRegistry } from './render/slots.js';
export { HtmlCache, type HtmlCacheOptions, type HtmlCacheStats } from './render/cache.js';
export { ThemeRenderer, type RenderInput, type RenderOutput, type ThemeRendererDeps } from './render/renderer.js';
export { buildTemplateContext, buildPagination, viewerFromRequest, type TemplateContext } from './render/context.js';
export { TrustedHtml, markTrusted, isTrusted, sanitizeRichText, escapeHtml } from './render/safe-html.js';

export { ThemeManager, type LoadedTheme, type InvalidTheme } from './themes/manager.js';
export { ThemeSettingsStore, type PublishedSettings, type SettingRevisionEntry } from './themes/settings.js';
export { extractZipSafely, DEFAULT_ZIP_GUARD, type ZipGuardOptions } from './themes/zip-guard.js';

export { PluginManager, shortName, type PluginManagerDeps, type PluginBootstrapReport } from './plugins/manager.js';
export { discoverPlugins, loadPluginModule, readPluginMigrations, type LoadedPlugin, type InvalidPlugin, type DiscoveryResult } from './plugins/manifest.js';
export { resolveDependencies, findDependents, topologicalSort, buildCapabilityIndex, type DependencyProblem, type ResolutionResult } from './plugins/dependency-resolver.js';
export { createPluginContext, type ContextFactoryDeps, type PluginContextBundle } from './plugins/context-factory.js';
export { AdminMenuRegistry } from './plugins/admin-menu.js';
export { PluginStore, type StoredPlugin } from './plugins/plugin-store.js';
export { assertTransition, canTransition, describeState, ALLOWED_TRANSITIONS, type PluginRecord } from './plugins/lifecycle.js';

export {
  SessionManager,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  safeCompare,
  type AuthContext,
  type SessionResolver,
  type SessionPayload
} from './security/session.js';
export { CsrfManager, LoginThrottle } from './security/csrf.js';
export { AuditLogger, type AuditInput, type AuditQuery } from './security/audit.js';
export { SecurityGateway, readCookie, type AuthorizationResolver, type GatewayDeps } from './security/gateway.js';
