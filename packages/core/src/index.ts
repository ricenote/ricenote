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
export {
  createLogger,
  parseLogLevel,
  resolveLogFormat,
  LOG_LEVELS,
  type Logger,
  type LogLevel,
  type LogFormat,
  type LoggerOptions
} from './logger.js';
export { renderStartupBanner, printStartupBanner, type StartupBannerInput } from './startup-banner.js';

export { createDatabaseAdapter, DatabaseAdapter, PluginScopedDatabase, scopedTableName, type OrmHandle, type QueryRunner } from './database/adapter.js';
export {
  ensureDatabase,
  validateDatabaseName,
  type EnsureDatabaseInput
} from './database/ensure-database.js';
export { MigrationCoordinator, checksumOf, MIGRATION_LOCK_NAME, type MigrationSource, type MigrationOutcome } from './database/migrate-coordinator.js';
export { CORE_MIGRATIONS, type CoreMigration } from './database/core-migrations.js';

export { ServiceRegistry } from './services/registry.js';
export { EventBus } from './events/bus.js';
export { InMemoryOutbox, type Outbox, type OutboxMessage } from './events/outbox.js';
export { RouterRegistry, type RegisteredPageRoute, type RegisteredRawRoute, type RegisteredAdminRoute } from './routing/registry.js';
export { buildPath, absoluteUrl, normalizePath, routeSignature } from './routing/url.js';

export { SlotRegistry } from './render/slots.js';
export {
  ExtensionRegistry,
  CORE_PROVIDER,
  type AdminContributionMeta,
  type ExtensionContributionRecord,
  type ExtensionDeclarationRecord,
  type ExtensionPointSummary
} from './extensions/registry.js';
export { registerDeclaredExtensions } from './extensions/contributions.js';
export {
  hasContentFields,
  resolveContentFields,
  validateContentFieldValues,
  assertContentFieldValues,
  pickDeclaredContentFields
} from './extensions/content-fields.js';
export { HtmlCache, type HtmlCacheOptions, type HtmlCacheStats } from './render/cache.js';
export { ThemeRenderer, type RenderInput, type RenderOutput, type ThemeRendererDeps } from './render/renderer.js';
export { buildTemplateContext, buildPagination, viewerFromRequest, type TemplateContext } from './render/context.js';
export { TrustedHtml, markTrusted, isTrusted, sanitizeRichText, escapeHtml } from './render/safe-html.js';

export { ThemeManager, type LoadedTheme, type InvalidTheme } from './themes/manager.js';
export { ThemeSettingsStore, type PublishedSettings, type SettingRevisionEntry } from './themes/settings.js';
export { extractZipSafely, DEFAULT_ZIP_GUARD, type ZipGuardOptions } from './themes/zip-guard.js';

/* 系统能力：运行日志、备份恢复、运行时站点设置与重启 */
export { LogsReader, type LogsReaderOptions, type LogsQueryResult } from './system/index.js';
export { BackupService, RESTORE_ZIP_GUARD, type BackupServiceDeps } from './system/index.js';
export {
  SiteSettingsProvider,
  SITE_SETTING_KEYS,
  validateSiteSettingsUpdate,
  type SiteSettingKey,
  type SiteSettingsProviderDeps,
  type SiteSettingsValidationResult
} from './system/index.js';
export { RestartCoordinator, type RestartCoordinatorDeps, type RestartState } from './system/index.js';

export { PluginManager, shortName, type PluginManagerDeps, type PluginBootstrapReport } from './plugins/manager.js';
export {
  discoverPlugins,
  discoverPluginsFrom,
  pluginDiscoveryRoots,
  loadPluginModule,
  readPluginMigrations,
  type LoadedPlugin,
  type InvalidPlugin,
  type DiscoveryResult
} from './plugins/manifest.js';
export { installPluginFromZip, type InstallPluginInput } from './plugins/installer.js';
export { PLUGIN_ZIP_GUARD, PLUGIN_EXTENSIONS } from './plugins/install/package-validation.js';
export {
  installPlugin,
  type InstallPluginRequest,
  type InstallPluginOutcome,
  type InstallProgress,
  type InstallStep
} from './plugins/install/orchestrator.js';
export {
  resolveSource,
  parsePackageSpec,
  pickVersion,
  validateGitRepo,
  verifyIntegrity,
  type InstallSourceInput,
  type ResolvedSource,
  type SourceResolveContext
} from './plugins/install/sources.js';
export {
  detectToolchain,
  runCommand,
  requirePackageManager,
  requireGit,
  type ToolchainInfo,
  type PackageManagerKind,
  type RunOptions,
  type RunResult
} from './plugins/install/toolchain.js';
export {
  PluginInstallRunner,
  type PluginInstallRunnerDeps,
  type InstallRunnerPluginPort,
  type InstalledPluginInfo,
  type SubmitJobInput,
  type JobSource
} from './plugins/install/jobs.js';
export { resolveDependencies, findDependents, topologicalSort, buildCapabilityIndex, type DependencyProblem, type ResolutionResult } from './plugins/dependency-resolver.js';
export { createPluginContext, type ContextFactoryDeps, type PluginContextBundle } from './plugins/context-factory.js';
export { AdminMenuRegistry } from './plugins/admin-menu.js';
export {
  PLUGIN_ADMIN_URL_PREFIX,
  pluginAdminEntryUrl,
  registerDeclaredAdminPages,
  resolveAdminPages,
  type ResolvedAdminPage
} from './plugins/admin-pages.js';
export { PluginStore, type StoredPlugin } from './plugins/plugin-store.js';
export {
  officialCatalogEntries,
  catalogEntryOf,
  isOfficialPlugin,
  updateToRecommended,
  buildCatalogView
} from './plugins/catalog.js';
export {
  buildPluginSettingsGroups,
  declaredSettingKeys,
  hasDeclarativeSettings,
  resolvePluginSettings,
  validatePluginSettingsValues,
  assertPluginSettingsValid
} from './plugins/settings-schema.js';
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
