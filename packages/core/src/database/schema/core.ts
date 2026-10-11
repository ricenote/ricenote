/**
 * Core 拥有的 Drizzle 表定义（插件与站点运行状态的元数据）。
 *
 * 索引与约束在 `core-migrations.ts` 的 DDL 中显式声明，
 * 这里只描述列，避免两处定义漂移。
 */

import { bigint, datetime, int, json, mysqlTable, tinyint, varchar } from 'drizzle-orm/mysql-core';

/** 插件安装状态、版本与健康。 */
export const rnPlugins = mysqlTable('rn_plugins', {
  id: varchar('id', { length: 120 }).primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  version: varchar('version', { length: 32 }).notNull(),
  apiVersion: varchar('api_version', { length: 32 }).notNull(),
  state: varchar('state', { length: 24 }).notNull(),
  enabled: tinyint('enabled').notNull().default(0),
  builtin: tinyint('builtin').notNull().default(0),
  path: varchar('path', { length: 500 }).notNull(),
  manifestJson: json('manifest_json').notNull(),
  lastError: varchar('last_error', { length: 1000 }),
  /*
   * 来源元数据（v0.4.0）：决定后台如何展示"从哪来"以及能否检查更新。
   * 历史记录（v0.4.0 之前）只有 ZIP 上传这一条路径，已回填为 `local`；
   * `installed_via` 对历史记录保持 NULL（当时无法区分上传与手工拷贝目录）。
   */
  sourceType: varchar('source_type', { length: 16 }),
  sourceSpec: varchar('source_spec', { length: 500 }),
  sourceRef: varchar('source_ref', { length: 200 }),
  resolvedVersion: varchar('resolved_version', { length: 64 }),
  integrity: varchar('integrity', { length: 200 }),
  installedVia: varchar('installed_via', { length: 16 }),
  installedAt: datetime('installed_at', { mode: 'date' }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date' }).notNull()
});

/** 插件迁移日志与校验值。 */
export const rnPluginMigrations = mysqlTable('rn_plugin_migrations', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  scope: varchar('scope', { length: 160 }).notNull(),
  migration: varchar('migration', { length: 255 }).notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  appliedAt: datetime('applied_at', { mode: 'date' }).notNull()
});

/** 插件配置覆盖（站点级）。 */
export const rnPluginSettings = mysqlTable('rn_plugin_settings', {
  pluginId: varchar('plugin_id', { length: 120 }).primaryKey(),
  siteId: varchar('site_id', { length: 64 }).notNull(),
  settingsJson: json('settings_json').notNull(),
  revision: int('revision', { unsigned: true }).notNull().default(1),
  updatedAt: datetime('updated_at', { mode: 'date' }).notNull()
});

/** 站点运行状态：激活主题、运行标记与待重启标记。 */
export const rnSiteState = mysqlTable('rn_site_state', {
  siteId: varchar('site_id', { length: 64 }).primaryKey(),
  activeThemeId: varchar('active_theme_id', { length: 120 }),
  runtimeStatus: varchar('runtime_status', { length: 32 }).notNull(),
  appVersion: varchar('app_version', { length: 32 }).notNull(),
  /** 是否存在需要重启才能生效的变更。 */
  restartRequired: tinyint('restart_required').notNull().default(0),
  /** 待生效变更的原因（直接展示给管理员）。 */
  restartReason: varchar('restart_reason', { length: 500 }),
  restartRequestedAt: datetime('restart_requested_at', { mode: 'date' }),
  startedAt: datetime('started_at', { mode: 'date' }),
  updatedAt: datetime('updated_at', { mode: 'date' }).notNull()
});

/** 站点信息覆盖层（稀疏覆盖：只存被后台显式修改过的字段）。 */
export const rnSiteSettings = mysqlTable('rn_site_settings', {
  siteId: varchar('site_id', { length: 64 }).primaryKey(),
  settingsJson: json('settings_json').notNull(),
  revision: int('revision', { unsigned: true }).notNull().default(1),
  updatedBy: bigint('updated_by', { mode: 'number', unsigned: true }),
  updatedAt: datetime('updated_at', { mode: 'date' }).notNull()
});
