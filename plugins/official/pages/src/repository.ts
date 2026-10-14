/** pages 插件数据访问层（只操作 `rn_pages`，不触碰其他插件的表）。 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';
import type { PageDetail, PageListQuery, PageStatus, PageSummary } from '@ricenote/shared';

export interface PageRow {
  id: number;
  site_id: string;
  title: string;
  slug: string;
  content: string;
  content_html: string;
  status: string;
  template: string | null;
  /** 内容自定义字段的 JSON 列：驱动可能返回 JSON 字符串或已解析对象。 */
  fields: string | Record<string, unknown> | null;
  sort_order: number;
  seo_title: string | null;
  seo_description: string | null;
  created_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  published_at: Date | string | null;
}

const COLUMNS = `id, site_id, title, slug, content, content_html, status, template, fields, sort_order,
  seo_title, seo_description, created_by, created_at, updated_at, published_at`;

function toIso(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toOptionalIso(value: Date | string | null): string | undefined {
  if (value === null) return undefined;
  return toIso(value);
}

/** 内容字段的落库表示：空对象写 NULL（= 未填写，与历史行一致；读取侧统一归一化为 `{}`）。 */
function toFieldsJson(fields: Record<string, unknown> | undefined): string | null {
  return fields && Object.keys(fields).length > 0 ? JSON.stringify(fields) : null;
}

/**
 * 把数据库行映射为列表项。
 *
 * `fields` 与 `url` 由调用方传入：前者已按当前主题声明过滤，后者由固定链接方案
 * 生成（本模块不依赖任何服务，保持纯映射）。
 */
export function toPageSummary(
  row: PageRow,
  fields?: Record<string, unknown>,
  url?: string
): PageSummary {
  const publishedAt = toOptionalIso(row.published_at);
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status as PageStatus,
    ...(row.template ? { template: row.template } : {}),
    ...(fields ? { fields } : {}),
    sortOrder: Number(row.sort_order),
    ...(row.seo_title ? { seoTitle: row.seo_title } : {}),
    ...(row.seo_description ? { seoDescription: row.seo_description } : {}),
    ...(url ? { url } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    ...(publishedAt ? { publishedAt } : {})
  };
}

export function toPageDetail(
  row: PageRow,
  fields?: Record<string, unknown>,
  url?: string
): PageDetail {
  return {
    ...toPageSummary(row, fields, url),
    content: row.content,
    html: row.content_html
  };
}

export interface PageWriteInput {
  siteId: string;
  title: string;
  slug: string;
  content: string;
  contentHtml: string;
  status: PageStatus;
  template: string | null;
  /**
   * 内容字段值（已按主题声明校验并归一化）。
   *
   * 省略表示"本次写入不涉及内容字段"：更新时保留既有值、插入时写 NULL。
   * 旧版后台界面不含内容字段控件，若无条件覆盖，一次普通编辑就会清空已填写的字段。
   */
  fields?: Record<string, unknown>;
  sortOrder: number;
  seoTitle?: string;
  seoDescription?: string;
  authorId?: number;
}

export async function insertPage(db: PluginDatabase, input: PageWriteInput): Promise<number> {
  const result = await db.execute(
    `INSERT INTO rn_pages
       (site_id, title, slug, content, content_html, status, template, fields, sort_order,
        seo_title, seo_description, created_by, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, NOW(), NOW(), ?)`,
    [
      input.siteId,
      input.title,
      input.slug,
      input.content,
      input.contentHtml,
      input.status,
      input.template,
      toFieldsJson(input.fields),
      input.sortOrder,
      input.seoTitle ?? null,
      input.seoDescription ?? null,
      input.authorId ?? null,
      input.status === 'published' ? new Date() : null
    ]
  );
  return Number(result.insertId);
}

export async function updatePage(
  db: PluginDatabase,
  id: number,
  input: PageWriteInput
): Promise<boolean> {
  /*
   * published_at 只在"首次发布"时写入：
   * 使用 COALESCE 保留既有值，避免反复编辑导致发布时间漂移；
   * 由发布退回草稿时保留原发布时间（再次发布不重置）。
   */
  // fields 可选：未提交时**不动该列**（旧版后台界面没有内容字段控件，
  // 无条件覆盖会让一次普通编辑清空已填写的字段）。
  const setFields = input.fields === undefined ? '' : ', fields = CAST(? AS JSON)';
  const params: unknown[] = [
    input.title, input.slug, input.content, input.contentHtml, input.status, input.template,
    input.sortOrder, input.seoTitle ?? null, input.seoDescription ?? null
  ];
  if (input.fields !== undefined) params.push(toFieldsJson(input.fields));
  params.push(input.status, id);

  const result = await db.execute(
    `UPDATE rn_pages SET
      title = ?, slug = ?, content = ?, content_html = ?, status = ?, template = ?,
      sort_order = ?, seo_title = ?, seo_description = ?${setFields}, updated_at = NOW(),
      published_at = CASE
        WHEN ? = 'published' THEN COALESCE(published_at, NOW())
        ELSE published_at
      END
    WHERE id = ?`,
    params
  );
  return result.affectedRows > 0;
}

export async function findPageById(db: PluginDatabase, id: number): Promise<PageRow | undefined> {
  const rows = await db.query<PageRow>(`SELECT ${COLUMNS} FROM rn_pages WHERE id = ? LIMIT 1`, [id]);
  return rows[0];
}

export async function findPageBySlug(
  db: PluginDatabase,
  siteId: string,
  slug: string
): Promise<PageRow | undefined> {
  const rows = await db.query<PageRow>(
    `SELECT ${COLUMNS} FROM rn_pages WHERE site_id = ? AND slug = ? LIMIT 1`,
    [siteId, slug]
  );
  return rows[0];
}

export async function findPublishedBySlug(
  db: PluginDatabase,
  siteId: string,
  slug: string
): Promise<PageRow | undefined> {
  const rows = await db.query<PageRow>(
    `SELECT ${COLUMNS} FROM rn_pages
     WHERE site_id = ? AND slug = ? AND status = 'published'
     LIMIT 1`,
    [siteId, slug]
  );
  return rows[0];
}

/** 按 ID 读取已发布页面（固定链接模板使用 `{cid}` 时前台走这条路径）。 */
export async function findPublishedById(
  db: PluginDatabase,
  siteId: string,
  id: number
): Promise<PageRow | undefined> {
  const rows = await db.query<PageRow>(
    `SELECT ${COLUMNS} FROM rn_pages
     WHERE site_id = ? AND id = ? AND status = 'published'
     LIMIT 1`,
    [siteId, id]
  );
  return rows[0];
}

export async function slugTaken(
  db: PluginDatabase,
  siteId: string,
  slug: string,
  exceptId?: number
): Promise<boolean> {
  const rows = await db.query<{ id: number }>(
    `SELECT id FROM rn_pages WHERE site_id = ? AND slug = ?${exceptId ? ' AND id <> ?' : ''} LIMIT 1`,
    exceptId ? [siteId, slug, exceptId] : [siteId, slug]
  );
  return rows.length > 0;
}

export async function listPages(
  db: PluginDatabase,
  siteId: string,
  query: PageListQuery
): Promise<{ items: PageRow[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, Math.min(query.pageSize ?? 20, 100));

  const conditions = ['site_id = ?'];
  const params: unknown[] = [siteId];
  if (query.status && query.status !== 'all') {
    conditions.push('status = ?');
    params.push(query.status);
  }
  if (query.keyword) {
    conditions.push('(title LIKE ? OR slug LIKE ?)');
    params.push(`%${query.keyword}%`, `%${query.keyword}%`);
  }
  const where = conditions.join(' AND ');

  const totalRows = await db.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM rn_pages WHERE ${where}`,
    params
  );
  const items = await db.query<PageRow>(
    `SELECT ${COLUMNS} FROM rn_pages WHERE ${where}
     ORDER BY sort_order ASC, updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

export async function listPublished(
  db: PluginDatabase,
  siteId: string,
  input: { page: number; pageSize: number }
): Promise<{ items: PageRow[]; total: number }> {
  const page = Math.max(1, input.page);
  const pageSize = Math.max(1, Math.min(input.pageSize, 100));
  const totalRows = await db.query<{ total: number }>(
    "SELECT COUNT(*) AS total FROM rn_pages WHERE site_id = ? AND status = 'published'",
    [siteId]
  );
  const items = await db.query<PageRow>(
    `SELECT ${COLUMNS} FROM rn_pages
     WHERE site_id = ? AND status = 'published'
     ORDER BY sort_order ASC, title ASC
     LIMIT ? OFFSET ?`,
    [siteId, pageSize, (page - 1) * pageSize]
  );
  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

/** 导航/引用用的轻量列表（只取必要列，已发布页面）。 */
export async function listNav(
  db: PluginDatabase,
  siteId: string,
  limit: number
): Promise<Array<{ id: number; title: string; slug: string }>> {
  return db.query<{ id: number; title: string; slug: string }>(
    `SELECT id, title, slug FROM rn_pages
     WHERE site_id = ? AND status = 'published'
     ORDER BY sort_order ASC, title ASC
     LIMIT ?`,
    [siteId, Math.max(1, Math.min(limit, 500))]
  );
}

export async function deletePageById(db: PluginDatabase, id: number): Promise<boolean> {
  const result = await db.execute('DELETE FROM rn_pages WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

export async function countPages(
  db: PluginDatabase,
  siteId: string
): Promise<Record<PageStatus | 'total', number>> {
  const rows = await db.query<{ status: string; total: number }>(
    'SELECT status, COUNT(*) AS total FROM rn_pages WHERE site_id = ? GROUP BY status',
    [siteId]
  );
  const output: Record<PageStatus | 'total', number> = { draft: 0, published: 0, total: 0 };
  for (const row of rows) {
    const count = Number(row.total);
    if (row.status === 'draft' || row.status === 'published') output[row.status] = count;
    output.total += count;
  }
  return output;
}
