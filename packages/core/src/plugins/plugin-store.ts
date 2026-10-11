/**
 * 插件状态持久化（`rn_plugins` / `rn_plugin_settings`）。
 *
 * 状态存于数据库而非文件，保证多实例部署与容器重启后行为一致。
 */

import type { PluginSourceInfo, PluginSourceType, PluginState } from '@ricenote/shared';
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
  /** 来源元数据（v0.4.0 起记录；老的记录已回填为 `local`）。 */
  source?: PluginSourceInfo;
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
  source_type: string | null;
  source_spec: string | null;
  source_ref: string | null;
  resolved_version: string | null;
  integrity: string | null;
  installed_via: string | null;
  installed_at: Date | string;
  updated_at: Date | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** 把一行来源列还原成 DTO；缺来源类型时返回 undefined（未知来源）。 */
function toSource(row: PluginRow): PluginSourceInfo | undefined {
  if (!row.source_type || !row.source_spec) return undefined;
  return {
    type: row.source_type as PluginSourceType,
    spec: row.source_spec,
    ...(row.source_ref ? { ref: row.source_ref } : {}),
    ...(row.resolved_version ? { resolvedVersion: row.resolved_version } : {}),
    ...(row.integrity ? { integrity: row.integrity } : {}),
    ...(row.installed_via ? { via: row.installed_via as 'directory' | 'zip' } : {})
  };
}

export class PluginStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async list(): Promise<StoredPlugin[]> {
    const rows = await this.db.query<PluginRow>(
      `SELECT id, name, version, api_version, state, enabled, builtin, path, last_error,
              source_type, source_spec, source_ref, resolved_version, integrity, installed_via,
              installed_at, updated_at
       FROM rn_plugins`
    );
    return rows.map((row) => {
      const source = toSource(row);
      return {
        id: row.id,
        name: row.name,
        version: row.version,
        apiVersion: row.api_version,
        state: row.state as PluginState,
        enabled: row.enabled === 1,
        builtin: row.builtin === 1,
        path: row.path,
        ...(row.last_error ? { lastError: row.last_error } : {}),
        ...(source ? { source } : {}),
        installedAt: toDate(row.installed_at),
        updatedAt: toDate(row.updated_at)
      };
    });
  }

  /**
   * 写入来源元数据。
   *
   * 只在安装/更新成功（或识别出内置来源）时调用；`undefined` 表示清空。
   * 与 `upsert()` 分开是有意的 —— 启动期每次都会 upsert（同步版本号等），
   * 若在那里写来源，会把"手工放置的目录"覆盖成错误的来源信息。
   *
   * **记录不存在时会补一条最小记录**：安装刚完成、内核还没重启时，
   * `rn_plugins` 里还没有这个插件（它由启动期的发现有过程写入）。
   * 若只做 UPDATE，来源会被静默丢弃 —— 表现为"装完显示来源未知"。
   */
  async setSource(
    id: string,
    source: PluginSourceInfo | undefined,
    meta?: { name?: string; version?: string; dir?: string }
  ): Promise<void> {
    const values = [
      source?.type ?? null,
      source?.spec ?? null,
      source?.ref ?? null,
      source?.resolvedVersion ?? null,
      source?.integrity ?? null,
      source?.via ?? null
    ];

    const existing = await this.db.query<{ id: string }>(
      'SELECT id FROM rn_plugins WHERE id = ? LIMIT 1',
      [id]
    );

    if (existing.length === 0) {
      await this.db.execute(
        `INSERT INTO rn_plugins
           (id, name, version, api_version, state, enabled, builtin, path, manifest_json,
            source_type, source_spec, source_ref, resolved_version, integrity, installed_via,
            installed_at, updated_at)
         VALUES (?, ?, ?, '^0.0.0', 'VALIDATED', 0, 0, ?, CAST('{}' AS JSON), ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          id,
          meta?.name ?? id,
          meta?.version ?? '0.0.0',
          meta?.dir ?? '',
          ...values
        ]
      );
      return;
    }

    await this.db.execute(
      `UPDATE rn_plugins
         SET source_type = ?, source_spec = ?, source_ref = ?, resolved_version = ?,
             integrity = ?, installed_via = ?, updated_at = updated_at
       WHERE id = ?`,
      [...values, id]
    );
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

  /**
   * 删除插件记录（卸载用）。
   *
   * 只删元数据，**不碰插件自己的数据表** —— 与既有启停语义一致：
   * 插件的数据要先备份，卸载不自动 drop（ADR-007）。
   */
  async remove(id: string): Promise<void> {
    await this.db.execute('DELETE FROM rn_plugins WHERE id = ?', [id]);
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
