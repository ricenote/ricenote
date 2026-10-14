/** taxonomy 插件数据访问层。 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';
import type { TermSummary, TermType } from '@ricenote/shared';

export interface TermRow {
  id: number;
  site_id: string;
  type: string;
  name: string;
  slug: string;
  description: string | null;
}

const SELECT_COLUMNS = 'id, site_id, type, name, slug, description';

export function toTermSummary(row: TermRow, count?: number): TermSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.type as TermType,
    ...(count !== undefined ? { count } : {})
  };
}

export async function listTerms(
  db: PluginDatabase,
  siteId: string,
  type?: TermType
): Promise<TermSummary[]> {
  const params: unknown[] = [siteId];
  let where = 'site_id = ?';
  if (type) {
    where += ' AND type = ?';
    params.push(type);
  }

  const rows = await db.query<TermRow>(
    `SELECT ${SELECT_COLUMNS} FROM rn_terms WHERE ${where} ORDER BY name ASC`,
    params
  );
  return rows.map((row) => toTermSummary(row));
}

/** 列出词条并附带已发布文章数量（数量由 posts 侧数据驱动，这里返回关联总数）。 */
export async function listTermsWithCounts(
  db: PluginDatabase,
  siteId: string
): Promise<TermSummary[]> {
  const rows = await db.query<TermRow & { post_count: number }>(
    `SELECT t.id, t.site_id, t.type, t.name, t.slug, t.description,
            (SELECT COUNT(*) FROM rn_term_relations r WHERE r.term_id = t.id) AS post_count
       FROM rn_terms t
      WHERE t.site_id = ?
      ORDER BY t.type ASC, t.name ASC`,
    [siteId]
  );
  return rows.map((row) => toTermSummary(row, Number(row.post_count ?? 0)));
}

export async function findTermBySlug(
  db: PluginDatabase,
  siteId: string,
  slug: string
): Promise<TermSummary | undefined> {
  const rows = await db.query<TermRow>(
    `SELECT ${SELECT_COLUMNS} FROM rn_terms WHERE site_id = ? AND slug = ? LIMIT 1`,
    [siteId, slug]
  );
  return rows[0] ? toTermSummary(rows[0]) : undefined;
}

export async function findTermById(
  db: PluginDatabase,
  id: number
): Promise<TermSummary | undefined> {
  const rows = await db.query<TermRow>(`SELECT ${SELECT_COLUMNS} FROM rn_terms WHERE id = ? LIMIT 1`, [
    id
  ]);
  return rows[0] ? toTermSummary(rows[0]) : undefined;
}

export async function insertTerm(
  db: PluginDatabase,
  input: { siteId: string; type: TermType; name: string; slug: string; description?: string }
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO rn_terms (site_id, type, name, slug, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [input.siteId, input.type, input.name, input.slug, input.description ?? null]
  );
  return Number(result.insertId);
}

export async function updateTerm(
  db: PluginDatabase,
  id: number,
  input: { name: string; slug: string; description?: string }
): Promise<void> {
  await db.execute(
    'UPDATE rn_terms SET name = ?, slug = ?, description = ?, updated_at = NOW() WHERE id = ?',
    [input.name, input.slug, input.description ?? null, id]
  );
}

export async function deleteTerm(db: PluginDatabase, id: number): Promise<void> {
  await db.execute('DELETE FROM rn_term_relations WHERE term_id = ?', [id]);
  await db.execute('DELETE FROM rn_terms WHERE id = ?', [id]);
}

/** 查询文章关联的词条（posts 插件通过服务调用）。 */
export async function termsOfPost(db: PluginDatabase, postId: number): Promise<TermSummary[]> {
  const rows = await db.query<TermRow>(
    `SELECT t.id, t.site_id, t.type, t.name, t.slug, t.description
       FROM rn_term_relations r
       JOIN rn_terms t ON t.id = r.term_id
      WHERE r.post_id = ?
      ORDER BY t.type ASC, t.name ASC`,
    [postId]
  );
  return rows.map((row) => toTermSummary(row));
}

/**
 * 批量读取多篇文章的词条（列表页拼地址时避免 N+1）。
 *
 * 返回的键只包含确实有关联的文章；`postIds` 为空时直接返回空对象，不发查询。
 */
export async function termsOfPosts(
  db: PluginDatabase,
  postIds: readonly number[]
): Promise<Record<number, TermSummary[]>> {
  const ids = [...new Set(postIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return {};

  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.query<TermRow & { post_id: number }>(
    `SELECT r.post_id, t.id, t.site_id, t.type, t.name, t.slug, t.description
       FROM rn_term_relations r
       JOIN rn_terms t ON t.id = r.term_id
      WHERE r.post_id IN (${placeholders})
      ORDER BY t.type ASC, t.name ASC`,
    ids
  );

  const grouped: Record<number, TermSummary[]> = {};
  for (const row of rows) {
    const postId = Number(row.post_id);
    (grouped[postId] ??= []).push(toTermSummary(row));
  }
  return grouped;
}

export async function termIdsOfPost(db: PluginDatabase, postId: number): Promise<number[]> {
  const rows = await db.query<{ term_id: number }>(
    'SELECT term_id FROM rn_term_relations WHERE post_id = ?',
    [postId]
  );
  return rows.map((row) => Number(row.term_id));
}

/** 覆盖式设置文章词条（先删后插，事务内调用）。 */
export async function setPostTerms(
  db: PluginDatabase,
  postId: number,
  termIds: number[]
): Promise<void> {
  await db.execute('DELETE FROM rn_term_relations WHERE post_id = ?', [postId]);
  for (const termId of [...new Set(termIds)]) {
    await db.execute(
      'INSERT INTO rn_term_relations (term_id, post_id, created_at) VALUES (?, ?, NOW())',
      [termId, postId]
    );
  }
}

/** 删除文章的关联（文章被删除时由 posts 插件调用）。 */
export async function clearPostTerms(db: PluginDatabase, postId: number): Promise<void> {
  await db.execute('DELETE FROM rn_term_relations WHERE post_id = ?', [postId]);
}

/** 查询某词条下的文章 ID（供 posts 插件做分类归档）。 */
export async function postIdsOfTerm(
  db: PluginDatabase,
  termSlug: string,
  siteId: string
): Promise<number[]> {
  const rows = await db.query<{ post_id: number }>(
    `SELECT r.post_id
       FROM rn_term_relations r
       JOIN rn_terms t ON t.id = r.term_id
      WHERE t.slug = ? AND t.site_id = ?`,
    [termSlug, siteId]
  );
  return rows.map((row) => Number(row.post_id));
}
