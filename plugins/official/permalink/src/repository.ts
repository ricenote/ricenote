/**
 * permalink 插件数据访问层（只操作 `rn_permalink_settings`）。
 *
 * 存储是**按方案**的一行（`site_id + scheme_id`），与内置方案还是第三方方案无关，
 * 因此第三方接入不需要任何迁移。模板为空串时删行，读取侧回落到方案默认模板。
 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';

export interface PermalinkSettingRow {
  scheme_id: string;
  template: string;
}

/** 读取站点下全部已配置模板；键为方案 id。 */
export async function listTemplates(
  db: PluginDatabase,
  siteId: string
): Promise<Map<string, string>> {
  const rows = await db.query<PermalinkSettingRow>(
    'SELECT scheme_id, template FROM rn_permalink_settings WHERE site_id = ?',
    [siteId]
  );

  const templates = new Map<string, string>();
  for (const row of rows) {
    const template = typeof row.template === 'string' ? row.template : '';
    if (template.length > 0) templates.set(row.scheme_id, template);
  }
  return templates;
}

/**
 * 写入一批模板（整批在一个事务里完成）。
 *
 * 空串表示"回到该方案的默认模板"，因此删行而不是写空串 ——
 * 读取侧的回落逻辑只有一处（`resolveTemplate`），不必再判断空值。
 */
export async function saveTemplates(
  db: PluginDatabase,
  input: { siteId: string; templates: Record<string, string>; actorId?: number }
): Promise<void> {
  const entries = Object.entries(input.templates);
  if (entries.length === 0) return;

  await db.transaction(async (tx) => {
    for (const [schemeId, rawTemplate] of entries) {
      const template = rawTemplate.trim();
      if (template.length === 0) {
        await tx.execute('DELETE FROM rn_permalink_settings WHERE site_id = ? AND scheme_id = ?', [
          input.siteId,
          schemeId
        ]);
        continue;
      }

      await tx.execute(
        `INSERT INTO rn_permalink_settings (site_id, scheme_id, template, updated_by, updated_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           template = VALUES(template),
           updated_by = VALUES(updated_by),
           updated_at = NOW()`,
        [input.siteId, schemeId, template, input.actorId ?? null]
      );
    }
  });
}
