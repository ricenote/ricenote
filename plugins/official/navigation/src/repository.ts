/** navigation 插件数据访问层（只操作 `rn_nav_items`，不触碰其他插件的表）。 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';
import type { NavItemType } from '@ricenote/shared';
import { SORT_STEP, sortOrderAt } from './nav.js';

export interface NavItemRow {
  id: number;
  site_id: string;
  label: string | null;
  item_type: string;
  href: string | null;
  ref_id: number | null;
  new_tab: number | boolean;
  enabled: number | boolean;
  sort_order: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = `id, site_id, label, item_type, href, ref_id, new_tab, enabled, sort_order,
  created_at, updated_at`;

export interface NavItemWriteInput {
  siteId: string;
  label: string | null;
  type: NavItemType;
  href: string | null;
  refId: number | null;
  newTab: boolean;
  enabled: boolean;
  /** 新建时使用；更新时忽略（排序由 `move` 单独负责）。 */
  sortOrder: number;
}

/** 全部导航项（含停用），按后台顺序。 */
export async function listItems(db: PluginDatabase, siteId: string): Promise<NavItemRow[]> {
  return db.query<NavItemRow>(
    `SELECT ${COLUMNS} FROM rn_nav_items WHERE site_id = ?
      ORDER BY sort_order ASC, id ASC`,
    [siteId]
  );
}

export async function findItemById(
  db: PluginDatabase,
  siteId: string,
  id: number
): Promise<NavItemRow | undefined> {
  const rows = await db.query<NavItemRow>(
    `SELECT ${COLUMNS} FROM rn_nav_items WHERE site_id = ? AND id = ? LIMIT 1`,
    [siteId, id]
  );
  return rows[0];
}

/** 新建时追加到末尾：取当前最大 sort_order + 间隔。 */
export async function nextSortOrder(db: PluginDatabase, siteId: string): Promise<number> {
  const rows = await db.query<{ max_order: number | null }>(
    'SELECT MAX(sort_order) AS max_order FROM rn_nav_items WHERE site_id = ?',
    [siteId]
  );
  const current = Number(rows[0]?.max_order ?? 0);
  return (Number.isFinite(current) ? current : 0) + SORT_STEP;
}

export async function insertItem(db: PluginDatabase, input: NavItemWriteInput): Promise<number> {
  const result = await db.execute(
    `INSERT INTO rn_nav_items
       (site_id, label, item_type, href, ref_id, new_tab, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      input.siteId,
      input.label,
      input.type,
      input.href,
      input.refId,
      input.newTab ? 1 : 0,
      input.enabled ? 1 : 0,
      input.sortOrder
    ]
  );
  return Number(result.insertId);
}

export async function updateItem(
  db: PluginDatabase,
  siteId: string,
  id: number,
  input: Omit<NavItemWriteInput, 'siteId' | 'sortOrder'>
): Promise<boolean> {
  const result = await db.execute(
    `UPDATE rn_nav_items SET
       label = ?, item_type = ?, href = ?, ref_id = ?, new_tab = ?, enabled = ?, updated_at = NOW()
     WHERE site_id = ? AND id = ?`,
    [input.label, input.type, input.href, input.refId, input.newTab ? 1 : 0, input.enabled ? 1 : 0, siteId, id]
  );
  return result.affectedRows > 0;
}

export async function deleteItem(db: PluginDatabase, siteId: string, id: number): Promise<boolean> {
  const result = await db.execute('DELETE FROM rn_nav_items WHERE site_id = ? AND id = ?', [siteId, id]);
  return result.affectedRows > 0;
}

/**
 * 按给定顺序整体重编号。
 *
 * 之所以整体重写而不是"交换两行的 sort_order"：历史数据里可能有并列值
 * （手工修改、导入等），交换会让并列关系变得不可预测；
 * 重编号让顺序永远只由后台的排列决定。导航项数量很小，代价可忽略。
 */
export async function renumberItems(
  db: PluginDatabase,
  siteId: string,
  orderedIds: number[]
): Promise<void> {
  if (orderedIds.length === 0) return;
  await db.transaction(async (tx) => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await tx.execute('UPDATE rn_nav_items SET sort_order = ? WHERE site_id = ? AND id = ?', [
        sortOrderAt(index),
        siteId,
        orderedIds[index]
      ]);
    }
  });
}

/**
 * 是否存在引用该内容的**已启用**导航项。
 *
 * 用于"内容变化 → 是否需要清 HTML 缓存"的精确判定：导航插槽出现在每个页面上，
 * 但只有被引用的内容变化才会让缓存的页面变旧，否则每次编辑文章都清全站缓存。
 */
export async function referencesContent(
  db: PluginDatabase,
  siteId: string,
  type: Exclude<NavItemType, 'custom'>,
  refId: number
): Promise<boolean> {
  const rows = await db.query<{ id: number }>(
    `SELECT id FROM rn_nav_items
      WHERE site_id = ? AND item_type = ? AND ref_id = ? AND enabled = 1
      LIMIT 1`,
    [siteId, type, refId]
  );
  return rows.length > 0;
}
