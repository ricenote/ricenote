/** posts 插件数据访问层。只操作 `rn_posts`。 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';
import type { PostStatus } from '@ricenote/shared';

export interface PostRow {
  id: number;
  site_id: string;
  author_id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  content_html: string;
  cover_media_id: number | null;
  status: string;
  /** 主题声明的模板键；NULL 表示使用主题默认文章模板。 */
  template: string | null;
  seo_title: string | null;
  seo_description: string | null;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = `id, site_id, author_id, title, slug, excerpt, content, content_html,
  cover_media_id, status, template, seo_title, seo_description, published_at, created_at, updated_at`;

export interface PageInput {
  page: number;
  pageSize: number;
}

function offsetOf(input: PageInput): number {
  const page = Math.max(1, input.page);
  const pageSize = Math.max(1, Math.min(input.pageSize, 50));
  return (page - 1) * pageSize;
}

function limitOf(input: PageInput): number {
  return Math.max(1, Math.min(input.pageSize, 50));
}

export async function findById(
  db: PluginDatabase,
  siteId: string,
  id: number
): Promise<PostRow | undefined> {
  const rows = await db.query<PostRow>(
    `SELECT ${COLUMNS} FROM rn_posts WHERE site_id = ? AND id = ? LIMIT 1`,
    [siteId, id]
  );
  return rows[0];
}

export async function findPublishedBySlug(
  db: PluginDatabase,
  siteId: string,
  slug: string
): Promise<PostRow | undefined> {
  const rows = await db.query<PostRow>(
    `SELECT ${COLUMNS} FROM rn_posts
      WHERE site_id = ? AND slug = ? AND status = 'published'
      LIMIT 1`,
    [siteId, slug]
  );
  return rows[0];
}

export async function findPublishedById(
  db: PluginDatabase,
  siteId: string,
  id: number
): Promise<PostRow | undefined> {
  const rows = await db.query<PostRow>(
    `SELECT ${COLUMNS} FROM rn_posts
      WHERE site_id = ? AND id = ? AND status = 'published'
      LIMIT 1`,
    [siteId, id]
  );
  return rows[0];
}

export async function listPublished(
  db: PluginDatabase,
  siteId: string,
  input: PageInput
): Promise<{ items: PostRow[]; total: number }> {
  const totalRows = await db.query<{ total: number }>(
    "SELECT COUNT(*) AS total FROM rn_posts WHERE site_id = ? AND status = 'published'",
    [siteId]
  );
  const items = await db.query<PostRow>(
    `SELECT ${COLUMNS} FROM rn_posts
      WHERE site_id = ? AND status = 'published'
      ORDER BY published_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [siteId, limitOf(input), offsetOf(input)]
  );
  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

/** 按文章 ID 集合分页（分类/标签归档使用，ID 由 taxonomy 服务提供）。 */
export async function listPublishedByIds(
  db: PluginDatabase,
  siteId: string,
  postIds: number[],
  input: PageInput
): Promise<{ items: PostRow[]; total: number }> {
  if (postIds.length === 0) return { items: [], total: 0 };
  const placeholders = postIds.map(() => '?').join(', ');

  const totalRows = await db.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM rn_posts
      WHERE site_id = ? AND status = 'published' AND id IN (${placeholders})`,
    [siteId, ...postIds]
  );
  const items = await db.query<PostRow>(
    `SELECT ${COLUMNS} FROM rn_posts
      WHERE site_id = ? AND status = 'published' AND id IN (${placeholders})
      ORDER BY published_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [siteId, ...postIds, limitOf(input), offsetOf(input)]
  );
  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

/**
 * 批量读取**已发布**文章的最小引用（id / 标题 / slug）。
 *
 * 供导航这类"出现在每个页面上的全局插槽"使用：只需要链接文案与地址，
 * 因此刻意不查作者与词条（`findPublishedById` 会连带查询，逐个调用即 N+1）。
 */
export async function publishedRefs(
  db: PluginDatabase,
  siteId: string,
  postIds: number[]
): Promise<Array<{ id: number; title: string; slug: string }>> {
  if (postIds.length === 0) return [];
  const placeholders = postIds.map(() => '?').join(', ');
  return db.query<{ id: number; title: string; slug: string }>(
    `SELECT id, title, slug FROM rn_posts
      WHERE site_id = ? AND status = 'published' AND id IN (${placeholders})`,
    [siteId, ...postIds]
  );
}

/**
 * 批量读取文章标题（**含草稿与归档**）。
 *
 * 供其他插件的后台列表展示使用（如评论审核台显示所属文章），
 * 目的是避免"每个 ID 一次查询"的 N+1 模式。
 */
export async function titlesOf(
  db: PluginDatabase,
  siteId: string,
  postIds: number[]
): Promise<Record<number, string>> {
  const output: Record<number, string> = {};
  const unique = [...new Set(postIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return output;

  const placeholders = unique.map(() => '?').join(', ');
  const rows = await db.query<{ id: number; title: string }>(
    `SELECT id, title FROM rn_posts WHERE site_id = ? AND id IN (${placeholders})`,
    [siteId, ...unique]
  );

  for (const row of rows) output[Number(row.id)] = row.title;
  return output;
}

export async function searchPublished(
  db: PluginDatabase,
  siteId: string,
  keyword: string,
  input: PageInput
): Promise<{ items: PostRow[]; total: number }> {
  const like = `%${keyword}%`;
  const totalRows = await db.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM rn_posts
      WHERE site_id = ? AND status = 'published'
        AND (title LIKE ? OR excerpt LIKE ? OR content LIKE ?)`,
    [siteId, like, like, like]
  );
  const items = await db.query<PostRow>(
    `SELECT ${COLUMNS} FROM rn_posts
      WHERE site_id = ? AND status = 'published'
        AND (title LIKE ? OR excerpt LIKE ? OR content LIKE ?)
      ORDER BY published_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [siteId, like, like, like, limitOf(input), offsetOf(input)]
  );
  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

/** FULLTEXT 检索表达式（列顺序必须与迁移 0002 创建的索引一致）。 */
const FULLTEXT_MATCH = `MATCH(title, excerpt, content) AGAINST (? IN BOOLEAN MODE)`;

/** ngram 解析器的最短分词长度。 */
const MIN_FULLTEXT_LENGTH = 2;

/** 布尔模式中具有特殊含义的字符，必须从用户输入中剔除。 */
const BOOLEAN_SPECIALS = /[+\-><()~*"@\\:]/g;

/**
 * 归一化全文检索关键词。
 *
 * 返回 `undefined` 表示应当回退到 {@link searchPublished}（LIKE）：
 * 关键词过短（ngram 最短分词为 2）或清洗后为空。
 */
export function normalizeFulltextKeyword(keyword: string): string | undefined {
  const cleaned = keyword.replace(BOOLEAN_SPECIALS, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length >= MIN_FULLTEXT_LENGTH ? cleaned : undefined;
}

/**
 * 全文检索（迁移 0002 创建的 ngram FULLTEXT 索引）。
 *
 * 为什么用**布尔模式短语**而不是自然语言模式：
 * ngram 会把拉丁词切成 2 字符片段（`Slot` → `Sl` / `lo` / `ot`），
 * 自然语言模式下命中任一片段即算匹配，实测会出现明显过匹配；
 * 加引号的短语要求片段按序相邻，语义等价于子串匹配，
 * 既精确又仍然走索引。
 *
 * 入参必须是 {@link normalizeFulltextKeyword} 的返回值。
 * 索引缺失时 MySQL 会直接报错，由调用方捕获后永久回退。
 */
export async function searchPublishedFulltext(
  db: PluginDatabase,
  siteId: string,
  normalizedKeyword: string,
  input: PageInput
): Promise<{ items: PostRow[]; total: number }> {
  const phrase = `"${normalizedKeyword}"`;

  const totalRows = await db.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM rn_posts
      WHERE site_id = ? AND status = 'published' AND ${FULLTEXT_MATCH}`,
    [siteId, phrase]
  );
  const items = await db.query<PostRow>(
    `SELECT ${COLUMNS}, ${FULLTEXT_MATCH} AS relevance FROM rn_posts
      WHERE site_id = ? AND status = 'published' AND ${FULLTEXT_MATCH}
      ORDER BY relevance DESC, published_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [phrase, siteId, phrase, limitOf(input), offsetOf(input)]
  );
  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

export async function listForAdmin(
  db: PluginDatabase,
  siteId: string,
  query: { page?: number; pageSize?: number; status?: string; keyword?: string }
): Promise<{ items: PostRow[]; total: number }> {
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
    `SELECT COUNT(*) AS total FROM rn_posts WHERE ${where}`,
    params
  );
  const items = await db.query<PostRow>(
    `SELECT ${COLUMNS} FROM rn_posts WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

export async function insertPost(
  db: PluginDatabase,
  input: {
    siteId: string;
    authorId: number;
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    contentHtml: string;
    status: PostStatus;
    coverMediaId?: number | null;
    template?: string | null;
    seoTitle?: string;
    seoDescription?: string;
  }
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO rn_posts
       (site_id, author_id, title, slug, excerpt, content, content_html, cover_media_id, status,
        template, seo_title, seo_description, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      input.siteId,
      input.authorId,
      input.title,
      input.slug,
      input.excerpt,
      input.content,
      input.contentHtml,
      input.coverMediaId ?? null,
      input.status,
      input.template ?? null,
      input.seoTitle ?? null,
      input.seoDescription ?? null,
      input.status === 'published' ? new Date() : null
    ]
  );
  return Number(result.insertId);
}

export async function updatePost(
  db: PluginDatabase,
  id: number,
  input: {
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    contentHtml: string;
    status: PostStatus;
    coverMediaId?: number | null;
    template?: string | null;
    seoTitle?: string;
    seoDescription?: string;
  }
): Promise<void> {
  // 从非发布态转为发布态时补写 published_at；已发布的文章保留原始发布时间
  await db.execute(
    `UPDATE rn_posts
        SET title = ?, slug = ?, excerpt = ?, content = ?, content_html = ?, status = ?,
            cover_media_id = ?, template = ?, seo_title = ?, seo_description = ?,
            published_at = CASE
              WHEN ? = 'published' AND published_at IS NULL THEN NOW()
              WHEN ? = 'published' THEN published_at
              ELSE NULL
            END,
            updated_at = NOW()
      WHERE id = ?`,
    [
      input.title,
      input.slug,
      input.excerpt,
      input.content,
      input.contentHtml,
      input.status,
      input.coverMediaId ?? null,
      input.template ?? null,
      input.seoTitle ?? null,
      input.seoDescription ?? null,
      input.status,
      input.status,
      id
    ]
  );
}

export async function deletePost(db: PluginDatabase, id: number): Promise<boolean> {
  const result = await db.execute('DELETE FROM rn_posts WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

export async function countByStatus(
  db: PluginDatabase,
  siteId: string
): Promise<Record<string, number>> {
  const rows = await db.query<{ status: string; total: number }>(
    'SELECT status, COUNT(*) AS total FROM rn_posts WHERE site_id = ? GROUP BY status',
    [siteId]
  );
  const output: Record<string, number> = { total: 0, published: 0, draft: 0, archived: 0 };
  for (const row of rows) {
    output[row.status] = Number(row.total);
    output.total = (output.total ?? 0) + Number(row.total);
  }
  return output;
}

export async function recentPosts(
  db: PluginDatabase,
  siteId: string,
  limit: number
): Promise<PostRow[]> {
  return db.query<PostRow>(
    `SELECT ${COLUMNS} FROM rn_posts WHERE site_id = ? ORDER BY updated_at DESC LIMIT ?`,
    [siteId, Math.max(1, Math.min(limit, 20))]
  );
}

export async function slugExists(
  db: PluginDatabase,
  siteId: string,
  slug: string,
  exceptId?: number
): Promise<boolean> {
  const params: unknown[] = [siteId, slug];
  let sql = 'SELECT id FROM rn_posts WHERE site_id = ? AND slug = ?';
  if (exceptId) {
    sql += ' AND id <> ?';
    params.push(exceptId);
  }
  const rows = await db.query<{ id: number }>(`${sql} LIMIT 1`, params);
  return rows.length > 0;
}
