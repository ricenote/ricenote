/** media 插件数据访问层。 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';
import type { MediaSummary } from '@ricenote/shared';

export interface MediaRow {
  id: number;
  site_id: string;
  file_name: string;
  stored_path: string;
  mime_type: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  created_at: Date | string;
}

export function toMediaSummary(row: MediaRow): MediaSummary {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: Number(row.size),
    ...(row.width !== null ? { width: Number(row.width) } : {}),
    ...(row.height !== null ? { height: Number(row.height) } : {}),
    url: `/media/${row.id}`,
    ...(row.alt ? { alt: row.alt } : {}),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  };
}

const COLUMNS = 'id, site_id, file_name, stored_path, mime_type, size, width, height, alt, created_at';

export async function insertMedia(
  db: PluginDatabase,
  input: {
    siteId: string;
    fileName: string;
    storedPath: string;
    mimeType: string;
    size: number;
    alt?: string;
    uploaderId?: number;
  }
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO rn_media
       (site_id, file_name, stored_path, mime_type, size, alt, uploader_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      input.siteId,
      input.fileName,
      input.storedPath,
      input.mimeType,
      input.size,
      input.alt ?? null,
      input.uploaderId ?? null
    ]
  );
  return Number(result.insertId);
}

export async function findMediaById(db: PluginDatabase, id: number): Promise<MediaRow | undefined> {
  const rows = await db.query<MediaRow>(`SELECT ${COLUMNS} FROM rn_media WHERE id = ? LIMIT 1`, [id]);
  return rows[0];
}

export async function listMedia(
  db: PluginDatabase,
  siteId: string,
  query: { page?: number; pageSize?: number; keyword?: string }
): Promise<{ items: MediaRow[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, Math.min(query.pageSize ?? 24, 100));

  const conditions = ['site_id = ?'];
  const params: unknown[] = [siteId];
  if (query.keyword) {
    conditions.push('file_name LIKE ?');
    params.push(`%${query.keyword}%`);
  }
  const where = conditions.join(' AND ');

  const totalRows = await db.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM rn_media WHERE ${where}`,
    params
  );
  const items = await db.query<MediaRow>(
    `SELECT ${COLUMNS} FROM rn_media WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

export async function deleteMediaById(db: PluginDatabase, id: number): Promise<boolean> {
  const result = await db.execute('DELETE FROM rn_media WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

export async function countMedia(
  db: PluginDatabase,
  siteId: string
): Promise<{ total: number; totalSize: number }> {
  const rows = await db.query<{ total: number; total_size: number | null }>(
    'SELECT COUNT(*) AS total, SUM(size) AS total_size FROM rn_media WHERE site_id = ?',
    [siteId]
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    totalSize: Number(rows[0]?.total_size ?? 0)
  };
}

/** 统计某媒体被引用次数（posts 的封面字段），用于删除前提示。 */
export async function findMediaIds(db: PluginDatabase, ids: number[]): Promise<MediaRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db.query<MediaRow>(`SELECT ${COLUMNS} FROM rn_media WHERE id IN (${placeholders})`, ids);
}
