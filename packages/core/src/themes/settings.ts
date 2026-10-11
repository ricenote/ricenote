/**
 * 主题设置持久化：三层配置模型中的"已发布覆盖"部分。
 *
 * - `rn_theme_settings`：当前生效的覆盖值与 revision；
 * - `rn_theme_setting_revisions`：发布历史，支持回滚；
 * - 保存使用 revision 乐观锁，冲突返回 REVISION_CONFLICT(409)。
 */

import { ErrorCode, RiceNoteError, type ThemeSettingValues } from '@ricenote/shared';
import type { DatabaseAdapter } from '../database/adapter.js';

export interface PublishedSettings {
  themeId: string;
  values: ThemeSettingValues;
  revision: number;
  updatedAt: Date;
}

export interface SettingRevisionEntry {
  revision: number;
  values: ThemeSettingValues;
  createdAt: Date;
  createdBy?: number;
}

export class ThemeSettingsStore {
  constructor(private readonly db: DatabaseAdapter) {}

  /** 读取已发布覆盖值；不存在时返回 undefined（表示使用主题默认值）。 */
  async getPublished(siteId: string, themeId: string): Promise<PublishedSettings | undefined> {
    const rows = await this.db.query<{
      settings_json: string | Record<string, unknown>;
      revision: number;
      updated_at: Date | string;
    }>(
      'SELECT settings_json, revision, updated_at FROM rn_theme_settings WHERE site_id = ? AND theme_id = ? LIMIT 1',
      [siteId, themeId]
    );

    const row = rows[0];
    if (!row) return undefined;

    return {
      themeId,
      values: parseJsonObject(row.settings_json),
      revision: row.revision,
      updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)
    };
  }

  /**
   * 保存并发布整组设置。
   *
   * @param expectedRevision 客户端持有的 revision；与当前不一致时抛 409。
   */
  async publish(
    siteId: string,
    themeId: string,
    values: ThemeSettingValues,
    expectedRevision: number,
    actorId?: number
  ): Promise<{ revision: number }> {
    const current = await this.getPublished(siteId, themeId);
    const currentRevision = current?.revision ?? 0;

    if (currentRevision !== expectedRevision) {
      throw new RiceNoteError(
        ErrorCode.REVISION_CONFLICT,
        `主题设置已被其他会话修改（期望 revision ${expectedRevision}，当前 ${currentRevision}）`,
        {
          status: 409,
          details: { themeId, expectedRevision, currentRevision }
        }
      );
    }

    const nextRevision = currentRevision + 1;
    const payload = JSON.stringify(values);

    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO rn_theme_settings (site_id, theme_id, settings_json, revision, updated_by, updated_at)
         VALUES (?, ?, CAST(? AS JSON), ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           settings_json = VALUES(settings_json),
           revision = VALUES(revision),
           updated_by = VALUES(updated_by),
           updated_at = NOW()`,
        [siteId, themeId, payload, nextRevision, actorId ?? null]
      );

      await tx.execute(
        `INSERT INTO rn_theme_setting_revisions (site_id, theme_id, revision, settings_json, created_by, created_at)
         VALUES (?, ?, ?, CAST(? AS JSON), ?, NOW())`,
        [siteId, themeId, nextRevision, payload, actorId ?? null]
      );
    });

    return { revision: nextRevision };
  }

  /** 恢复默认：等价于发布一份空覆盖（清空所有字段覆盖）。 */
  async reset(siteId: string, themeId: string, actorId?: number): Promise<{ revision: number }> {
    const current = await this.getPublished(siteId, themeId);
    const expected = current?.revision ?? 0;
    return this.publish(siteId, themeId, {}, expected, actorId);
  }

  /** 列出发布历史（倒序）。 */
  async history(siteId: string, themeId: string, limit = 20): Promise<SettingRevisionEntry[]> {
    const rows = await this.db.query<{
      revision: number;
      settings_json: string | Record<string, unknown>;
      created_at: Date | string;
      created_by: number | null;
    }>(
      `SELECT revision, settings_json, created_at, created_by
         FROM rn_theme_setting_revisions
        WHERE site_id = ? AND theme_id = ?
        ORDER BY revision DESC
        LIMIT ?`,
      [siteId, themeId, Math.max(1, Math.min(limit, 100))]
    );

    return rows.map((row) => ({
      revision: row.revision,
      values: parseJsonObject(row.settings_json),
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      ...(row.created_by !== null ? { createdBy: row.created_by } : {})
    }));
  }

  /** 回滚到指定 revision（以"复制历史快照为新 revision"的方式实现，保证历史不可变）。 */
  async rollback(
    siteId: string,
    themeId: string,
    targetRevision: number,
    actorId?: number
  ): Promise<{ revision: number }> {
    const rows = await this.db.query<{ settings_json: string | Record<string, unknown> }>(
      'SELECT settings_json FROM rn_theme_setting_revisions WHERE site_id = ? AND theme_id = ? AND revision = ? LIMIT 1',
      [siteId, themeId, targetRevision]
    );

    const row = rows[0];
    if (!row) {
      throw new RiceNoteError(
        ErrorCode.NOT_FOUND,
        `未找到 revision ${targetRevision} 的设置快照`,
        { status: 404, details: { themeId, targetRevision } }
      );
    }

    const current = await this.getPublished(siteId, themeId);
    return this.publish(siteId, themeId, parseJsonObject(row.settings_json), current?.revision ?? 0, actorId);
  }
}

/** MySQL JSON 列在不同驱动配置下可能返回字符串，这里统一解析。 */
function parseJsonObject(value: string | Record<string, unknown> | null): ThemeSettingValues {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as ThemeSettingValues)
        : {};
    } catch {
      return {};
    }
  }
  return value as ThemeSettingValues;
}
