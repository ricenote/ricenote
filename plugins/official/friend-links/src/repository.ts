/** friend-links 插件数据访问层（只操作 `rn_friend_links`，不触碰其他插件的表）。 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';

export interface FriendLinkRow {
  id: number;
  site_id: string;
  name: string;
  url: string;
  avatar_url: string | null;
  description: string | null;
  sort_order: number;
  enabled: number | boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = `id, site_id, name, url, avatar_url, description, sort_order, enabled,
  created_at, updated_at`;

export interface FriendLinkWriteInput {
  siteId: string;
  name: string;
  url: string;
  avatarUrl: string | null;
  description: string | null;
  sortOrder: number;
  enabled: boolean;
}

/** 全部友链（含停用），按后台顺序。 */
export async function listLinks(db: PluginDatabase, siteId: string): Promise<FriendLinkRow[]> {
  return db.query<FriendLinkRow>(
    `SELECT ${COLUMNS} FROM rn_friend_links WHERE site_id = ?
      ORDER BY sort_order ASC, id ASC`,
    [siteId]
  );
}

/** 前台可见的友链（仅启用项），顺序与后台一致。 */
export async function listEnabledLinks(db: PluginDatabase, siteId: string): Promise<FriendLinkRow[]> {
  return db.query<FriendLinkRow>(
    `SELECT ${COLUMNS} FROM rn_friend_links WHERE site_id = ? AND enabled = 1
      ORDER BY sort_order ASC, id ASC`,
    [siteId]
  );
}

export async function findLinkById(
  db: PluginDatabase,
  siteId: string,
  id: number
): Promise<FriendLinkRow | undefined> {
  const rows = await db.query<FriendLinkRow>(
    `SELECT ${COLUMNS} FROM rn_friend_links WHERE site_id = ? AND id = ? LIMIT 1`,
    [siteId, id]
  );
  return rows[0];
}

/** 新建时追加到末尾：取当前最大 sort_order + 1。 */
export async function nextSortOrder(db: PluginDatabase, siteId: string): Promise<number> {
  const rows = await db.query<{ max_order: number | null }>(
    'SELECT MAX(sort_order) AS max_order FROM rn_friend_links WHERE site_id = ?',
    [siteId]
  );
  const current = Number(rows[0]?.max_order ?? 0);
  return (Number.isFinite(current) ? current : 0) + 1;
}

export async function insertLink(db: PluginDatabase, input: FriendLinkWriteInput): Promise<number> {
  const result = await db.execute(
    `INSERT INTO rn_friend_links
       (site_id, name, url, avatar_url, description, sort_order, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      input.siteId,
      input.name,
      input.url,
      input.avatarUrl,
      input.description,
      input.sortOrder,
      input.enabled ? 1 : 0
    ]
  );
  return Number(result.insertId);
}

export async function updateLink(
  db: PluginDatabase,
  siteId: string,
  id: number,
  input: Omit<FriendLinkWriteInput, 'siteId'>
): Promise<boolean> {
  const result = await db.execute(
    `UPDATE rn_friend_links SET
       name = ?, url = ?, avatar_url = ?, description = ?, sort_order = ?, enabled = ?, updated_at = NOW()
     WHERE site_id = ? AND id = ?`,
    [
      input.name,
      input.url,
      input.avatarUrl,
      input.description,
      input.sortOrder,
      input.enabled ? 1 : 0,
      siteId,
      id
    ]
  );
  return result.affectedRows > 0;
}

export async function deleteLink(db: PluginDatabase, siteId: string, id: number): Promise<boolean> {
  const result = await db.execute('DELETE FROM rn_friend_links WHERE site_id = ? AND id = ?', [
    siteId,
    id
  ]);
  return result.affectedRows > 0;
}
