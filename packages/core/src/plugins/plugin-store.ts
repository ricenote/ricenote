/**
 * 插件状态持久化（`rn_plugins` / `rn_plugin_settings`）。
 *
 * 状态存于数据库而非文件，保证多实例部署与容器重启后行为一致。
 */

import type { PluginState } from '@ricenote/shared';
import type { DatabaseAdapter } from '../database/adapter.js';
import type { LoadedPlugin } from './manifest.js';

export interface StoredPlugin {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  state: PluginState;
  enabled: boolean;
  builtin: boolean;
  path: string;
  lastError?: string;
  installedAt: Date;
  updatedAt: Date;
}

interface PluginRow {
  id: string;
  name: string;
  version: string;
  api_version: string;
  state: string;
  enabled: number;
  builtin: number;
  path: string;
  last_error: string | null;
  installed_at: Date | string;
  updated_at: Date | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export class PluginStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async list(): Promise<StoredPlugin[]> {
    const rows = await this.db.query<PluginRow>(
      'SELECT id, name, version, api_version, state, enabled, builtin, path, last_error, installed_at, updated_at FROM rn_plugins'
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      apiVersion: row.api_version,
      state: row.state as PluginState,
      enabled: row.enabled === 1,
      builtin: row.builtin === 1,
      path: row.path,
      ...(row.last_error ? { lastError: row.last_error } : {}),
      installedAt: toDate(row.installed_at),
      updatedAt: toDate(row.updated_at)
    }));
  }

  async listIds(): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>('SELECT id FROM rn_plugins');
    return rows.map((row) => row.id);
  }

  /** 插入或更新插件记录（保留已有的 enabled 与 installed_at）。 */
  async upsert(plugin: LoadedPlugin, options: { enabled: boolean; state: PluginState }): Promise<void> {
    const manifestJson = JSON.stringify(plugin.manifest);
    await this.db.execute(
      `INSERT INTO rn_plugins
         (id, name, version, api_version, state, enabled, builtin, path, manifest_json, installed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         version = VALUES(version),
         api_version = VALUES(api_version),
         builtin = VALUES(builtin),
         path = VALUES(path),
         manifest_json = VALUES(manifest_json),
         updated_at = NOW()`,
      [
        plugin.manifest.id,
        plugin.manifest.name,
        plugin.manifest.version,
        plugin.manifest.apiVersion,
        options.state,
        options.enabled ? 1 : 0,
        plugin.builtin ? 1 : 0,
        plugin.dir,
        manifestJson
      ]
    );
  }

  async isKnown(id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>('SELECT id FROM rn_plugins WHERE id = ? LIMIT 1', [id]);
    return rows.length > 0;
  }

  /** 更新状态；`lastError` 为空表示清除错误。 */
  async setState(id: string, state: PluginState, lastError?: string): Promise<void> {
    await this.db.execute('UPDATE rn_plugins SET state = ?, last_error = ?, updated_at = NOW() WHERE id = ?', [
      state,
      lastError ?? null,
      id
    ]);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.execute('UPDATE rn_plugins SET enabled = ?, updated_at = NOW() WHERE id = ?', [
      enabled ? 1 : 0,
      id
    ]);
  }

  /** 载入站点级插件配置覆盖。 */
  async loadSettings(): Promise<Map<string, Record<string, unknown>>> {
    const rows = await this.db.query<{ plugin_id: string; settings_json: string | Record<string, unknown> }>(
      'SELECT plugin_id, settings_json FROM rn_plugin_settings'
    );
    const map = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const raw = row.settings_json;
      if (typeof raw === 'string') {
        try {
          map.set(row.plugin_id, JSON.parse(raw) as Record<string, unknown>);
        } catch {
          map.set(row.plugin_id, {});
        }
      } else {
        map.set(row.plugin_id, raw ?? {});
      }
    }
    return map;
  }

  /** 读取某插件配置的当前 revision；从未保存过时返回 0。 */
  async revisionOf(pluginId: string): Promise<number> {
    const rows = await this.db.query<{ revision: number }>(
      'SELECT revision FROM rn_plugin_settings WHERE plugin_id = ? LIMIT 1',
      [pluginId]
    );
    return rows[0] ? Number(rows[0].revision) : 0;
  }

  /** 保存插件配置覆盖（使用 revision 乐观锁）。 */
  async saveSettings(
    pluginId: string,
    siteId: string,
    settings: Record<string, unknown>
  ): Promise<{ revision: number }> {
    const payload = JSON.stringify(settings);
    await this.db.execute(
      `INSERT INTO rn_plugin_settings (plugin_id, site_id, settings_json, revision, updated_at)
       VALUES (?, ?, CAST(? AS JSON), 1, NOW())
       ON DUPLICATE KEY UPDATE
         settings_json = VALUES(settings_json),
         revision = revision + 1,
         updated_at = NOW()`,
      [pluginId, siteId, payload]
    );
    const rows = await this.db.query<{ revision: number }>(
      'SELECT revision FROM rn_plugin_settings WHERE plugin_id = ? LIMIT 1',
      [pluginId]
    );
    return { revision: rows[0]?.revision ?? 1 };
  }
}
