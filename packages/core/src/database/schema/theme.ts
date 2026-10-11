/** 主题相关表：已安装主题、每主题设置快照与发布历史。 */

import { bigint, datetime, int, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/** 已安装主题清单。 */
export const rnThemes = mysqlTable('rn_themes', {
  id: varchar('id', { length: 120 }).primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  version: varchar('version', { length: 32 }).notNull(),
  apiVersion: varchar('api_version', { length: 32 }).notNull(),
  path: varchar('path', { length: 500 }).notNull(),
  manifestJson: json('manifest_json').notNull(),
  installedAt: datetime('installed_at', { mode: 'date' }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date' }).notNull()
});

/** 每主题的已发布设置快照与 revision（乐观锁）。 */
export const rnThemeSettings = mysqlTable('rn_theme_settings', {
  siteId: varchar('site_id', { length: 64 }).notNull(),
  themeId: varchar('theme_id', { length: 120 }).notNull(),
  settingsJson: json('settings_json').notNull(),
  revision: int('revision', { unsigned: true }).notNull().default(1),
  updatedBy: bigint('updated_by', { mode: 'number', unsigned: true }),
  updatedAt: datetime('updated_at', { mode: 'date' }).notNull()
});

/** 设置发布历史，用于回滚与审计。 */
export const rnThemeSettingRevisions = mysqlTable('rn_theme_setting_revisions', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  siteId: varchar('site_id', { length: 64 }).notNull(),
  themeId: varchar('theme_id', { length: 120 }).notNull(),
  revision: int('revision', { unsigned: true }).notNull(),
  settingsJson: json('settings_json').notNull(),
  createdBy: bigint('created_by', { mode: 'number', unsigned: true }),
  createdAt: datetime('created_at', { mode: 'date' }).notNull()
});
