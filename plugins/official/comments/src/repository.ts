/**
 * comments 插件的数据访问层。
 *
 * 边界纪律：只操作 `rn_comments`；文章标题与用户信息一律通过服务契约获取，
 * 不做跨插件联查（说明书第 8 章）。
 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';
import type { CommentListQuery, CommentStatus } from '@ricenote/shared';

export interface CommentRow {
  id: number;
  site_id: string;
  post_id: number;
  parent_id: number | null;
  user_id: number | null;
  author_name: string;
  author_email: string;
  author_url: string | null;
  content: string;
  status: CommentStatus;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, site_id, post_id, parent_id, user_id, author_name, author_email,
  author_url, content, status, ip_hash, user_agent, created_at, updated_at`;

const MAX_PAGE_SIZE = 100;

export interface InsertCommentInput {
  siteId: string;
  postId: number;
  parentId: number | null;
  userId: number | null;
  authorName: string;
  authorEmail: string;
  authorUrl: string | null;
  content: string;
  status: CommentStatus;
  ipHash: string | null;
  userAgent: string | null;
}

export async function insertComment(db: PluginDatabase, input: InsertCommentInput): Promise<number> {
  const result = await db.execute(
    `INSERT INTO rn_comments
       (site_id, post_id, parent_id, user_id, author_name, author_email, author_url,
        content, status, ip_hash, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      input.siteId,
      input.postId,
      input.parentId,
      input.userId,
      input.authorName,
      input.authorEmail,
      input.authorUrl,
      input.content,
      input.status,
      input.ipHash,
      input.userAgent
    ]
  );
  return result.insertId;
}

export async function findCommentById(db: PluginDatabase, id: number): Promise<CommentRow | undefined> {
  const rows = await db.query<CommentRow>(`SELECT ${COLUMNS} FROM rn_comments WHERE id = ? LIMIT 1`, [id]);
  return rows[0];
}

/**
 * 按 ID 批量读取（同一站点内）。
 *
 * 两处用到：审核前取"变更前的状态"，以及事件载荷里补上被回复评论的作者。
 */
export async function listByIds(
  db: PluginDatabase,
  siteId: string,
  ids: number[]
): Promise<CommentRow[]> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return [];

  const placeholders = unique.map(() => '?').join(', ');
  return db.query<CommentRow>(
    `SELECT ${COLUMNS} FROM rn_comments WHERE site_id = ? AND id IN (${placeholders})`,
    [siteId, ...unique]
  );
}

/** 读取某文章的全部已通过评论（升序，用于构建线程）。 */
export async function listApprovedByPost(
  db: PluginDatabase,
  siteId: string,
  postId: number
): Promise<CommentRow[]> {
  return db.query<CommentRow>(
    `SELECT ${COLUMNS} FROM rn_comments
      WHERE site_id = ? AND post_id = ? AND status = 'approved'
      ORDER BY created_at ASC, id ASC`,
    [siteId, postId]
  );
}

/** 后台审核列表（含全部状态）。 */
export async function listForAdmin(
  db: PluginDatabase,
  siteId: string,
  query: CommentListQuery
): Promise<{ items: CommentRow[]; total: number }> {
  const where: string[] = ['site_id = ?'];
  const params: unknown[] = [siteId];

  if (query.status && query.status !== 'all') {
    where.push('status = ?');
    params.push(query.status);
  }
  if (query.postId !== undefined) {
    where.push('post_id = ?');
    params.push(query.postId);
  }
  if (query.keyword) {
    where.push('(content LIKE ? OR author_name LIKE ? OR author_email LIKE ?)');
    const like = `%${query.keyword}%`;
    params.push(like, like, like);
  }

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.pageSize ?? 20)));
  const clause = where.join(' AND ');

  const totalRows = await db.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM rn_comments WHERE ${clause}`,
    params
  );
  const items = await db.query<CommentRow>(
    `SELECT ${COLUMNS} FROM rn_comments WHERE ${clause}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

/** 按状态统计。 */
export async function countByStatus(
  db: PluginDatabase,
  siteId: string
): Promise<Record<CommentStatus, number>> {
  const rows = await db.query<{ status: CommentStatus; total: number }>(
    'SELECT status, COUNT(*) AS total FROM rn_comments WHERE site_id = ? GROUP BY status',
    [siteId]
  );

  const output: Record<CommentStatus, number> = { pending: 0, approved: 0, spam: 0, trash: 0 };
  for (const row of rows) {
    output[row.status] = Number(row.total);
  }
  return output;
}

/** 批量读取多篇文章的已通过评论数（缺失的文章补 0）。 */
export async function countsForPosts(
  db: PluginDatabase,
  siteId: string,
  postIds: number[]
): Promise<Record<number, number>> {
  const output: Record<number, number> = {};
  for (const id of postIds) output[id] = 0;

  const unique = [...new Set(postIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return output;

  const placeholders = unique.map(() => '?').join(', ');
  const rows = await db.query<{ post_id: number; total: number }>(
    `SELECT post_id, COUNT(*) AS total FROM rn_comments
      WHERE site_id = ? AND status = 'approved' AND post_id IN (${placeholders})
      GROUP BY post_id`,
    [siteId, ...unique]
  );

  for (const row of rows) output[Number(row.post_id)] = Number(row.total);
  return output;
}

/** 批量统计直接回复数（后台列表展示用）。 */
export async function countReplies(
  db: PluginDatabase,
  parentIds: number[]
): Promise<Record<number, number>> {
  const output: Record<number, number> = {};
  const unique = [...new Set(parentIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return output;

  const placeholders = unique.map(() => '?').join(', ');
  const rows = await db.query<{ parent_id: number; total: number }>(
    `SELECT parent_id, COUNT(*) AS total FROM rn_comments
      WHERE parent_id IN (${placeholders})
      GROUP BY parent_id`,
    unique
  );

  for (const row of rows) output[Number(row.parent_id)] = Number(row.total);
  return output;
}

/** 批量更新审核状态，返回受影响行数。 */
export async function updateStatus(
  db: PluginDatabase,
  siteId: string,
  ids: number[],
  status: CommentStatus
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.execute(
    `UPDATE rn_comments SET status = ?, updated_at = NOW()
      WHERE site_id = ? AND id IN (${placeholders})`,
    [status, siteId, ...ids]
  );
  return result.affectedRows;
}

/** 批量删除，返回受影响行数。 */
export async function deleteByIds(db: PluginDatabase, siteId: string, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.execute(
    `DELETE FROM rn_comments WHERE site_id = ? AND id IN (${placeholders})`,
    [siteId, ...ids]
  );
  return result.affectedRows;
}

/** 读取给定评论所属的文章 ID（去重），用于审核后精确失效页面缓存。 */
export async function postIdsOf(
  db: PluginDatabase,
  siteId: string,
  ids: number[]
): Promise<number[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.query<{ post_id: number }>(
    `SELECT DISTINCT post_id FROM rn_comments WHERE site_id = ? AND id IN (${placeholders})`,
    [siteId, ...ids]
  );
  return rows.map((row) => Number(row.post_id));
}

/** 最近评论（仪表盘）。 */
export async function recent(db: PluginDatabase, siteId: string, limit: number): Promise<CommentRow[]> {
  return db.query<CommentRow>(
    `SELECT ${COLUMNS} FROM rn_comments WHERE site_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [siteId, Math.min(50, Math.max(1, limit))]
  );
}

/** 统计同一来源在最近 N 秒内的提交数（频率限制）。 */
export async function countRecentByIpHash(
  db: PluginDatabase,
  siteId: string,
  ipHash: string,
  withinSeconds: number
): Promise<number> {
  const rows = await db.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM rn_comments
      WHERE site_id = ? AND ip_hash = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)`,
    [siteId, ipHash, Math.max(1, withinSeconds)]
  );
  return Number(rows[0]?.total ?? 0);
}
