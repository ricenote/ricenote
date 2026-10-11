/**
 * identity 插件的数据访问层。
 *
 * 只操作 `rn_identity_*` 表，禁止跨插件联表（说明书第 8 章）。
 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';
import type { AdminUserSummary } from '@ricenote/shared';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  email: string;
  password_hash: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

export interface SessionRow {
  session_id: string;
  user_id: number;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function countUsers(db: PluginDatabase): Promise<number> {
  const rows = await db.query<{ total: number }>('SELECT COUNT(*) AS total FROM rn_identity_users');
  return Number(rows[0]?.total ?? 0);
}

export async function findUserByUsername(
  db: PluginDatabase,
  username: string
): Promise<UserRow | undefined> {
  const rows = await db.query<UserRow>(
    'SELECT * FROM rn_identity_users WHERE username = ? LIMIT 1',
    [username]
  );
  return rows[0];
}

export async function findUserById(db: PluginDatabase, id: number): Promise<UserRow | undefined> {
  const rows = await db.query<UserRow>('SELECT * FROM rn_identity_users WHERE id = ? LIMIT 1', [id]);
  return rows[0];
}

export async function insertUser(
  db: PluginDatabase,
  input: {
    username: string;
    displayName: string;
    email: string;
    passwordHash: string;
    status?: string;
  }
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO rn_identity_users
       (username, display_name, email, password_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      input.username,
      input.displayName,
      input.email,
      input.passwordHash,
      input.status ?? 'active'
    ]
  );
  return Number(result.insertId);
}

export async function updateLastLogin(db: PluginDatabase, userId: number): Promise<void> {
  await db.execute('UPDATE rn_identity_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = ?', [
    userId
  ]);
}

export async function updatePassword(
  db: PluginDatabase,
  userId: number,
  passwordHash: string
): Promise<void> {
  await db.execute(
    'UPDATE rn_identity_users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
    [passwordHash, userId]
  );
}

/** 更新资料（显示名与邮箱）；未提供的字段保持原值。 */
export async function updateProfile(
  db: PluginDatabase,
  userId: number,
  input: { displayName?: string; email?: string }
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];
  if (input.displayName !== undefined) {
    assignments.push('display_name = ?');
    params.push(input.displayName);
  }
  if (input.email !== undefined) {
    assignments.push('email = ?');
    params.push(input.email);
  }
  if (assignments.length === 0) return;

  params.push(userId);
  await db.execute(
    `UPDATE rn_identity_users SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = ?`,
    params
  );
}

/** 判断邮箱是否已被其他账号占用。 */
export async function emailTaken(
  db: PluginDatabase,
  email: string,
  exceptUserId: number
): Promise<boolean> {
  const rows = await db.query<{ id: number }>(
    'SELECT id FROM rn_identity_users WHERE email = ? AND id <> ? LIMIT 1',
    [email, exceptUserId]
  );
  return rows.length > 0;
}

export async function createSession(
  db: PluginDatabase,
  input: {
    sessionId: string;
    userId: number;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
  }
): Promise<void> {
  await db.execute(
    `INSERT INTO rn_identity_sessions
       (session_id, user_id, ip, user_agent, created_at, expires_at)
     VALUES (?, ?, ?, ?, NOW(), ?)`,
    [
      input.sessionId,
      input.userId,
      input.ip ?? null,
      input.userAgent ? input.userAgent.slice(0, 255) : null,
      input.expiresAt
    ]
  );
}

export async function findActiveSession(
  db: PluginDatabase,
  sessionId: string
): Promise<SessionRow | undefined> {
  const rows = await db.query<SessionRow>(
    `SELECT session_id, user_id, expires_at, revoked_at
       FROM rn_identity_sessions
      WHERE session_id = ? AND revoked_at IS NULL AND expires_at > NOW()
      LIMIT 1`,
    [sessionId]
  );
  return rows[0];
}

export async function revokeSession(db: PluginDatabase, sessionId: string): Promise<void> {
  await db.execute(
    'UPDATE rn_identity_sessions SET revoked_at = NOW() WHERE session_id = ? AND revoked_at IS NULL',
    [sessionId]
  );
}

export async function revokeUserSessions(db: PluginDatabase, userId: number): Promise<number> {
  const result = await db.execute(
    'UPDATE rn_identity_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
  return result.affectedRows;
}

export async function pruneExpiredSessions(db: PluginDatabase): Promise<number> {
  const result = await db.execute(
    'DELETE FROM rn_identity_sessions WHERE expires_at < DATE_SUB(NOW(), INTERVAL 7 DAY)'
  );
  return result.affectedRows;
}

export async function countActiveSessions(db: PluginDatabase): Promise<number> {
  const rows = await db.query<{ total: number }>(
    'SELECT COUNT(*) AS total FROM rn_identity_sessions WHERE revoked_at IS NULL AND expires_at > NOW()'
  );
  return Number(rows[0]?.total ?? 0);
}

export async function listUsers(
  db: PluginDatabase,
  query: { page?: number; pageSize?: number; keyword?: string }
): Promise<{ items: UserRow[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, Math.min(query.pageSize ?? 20, 100));

  const conditions: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (query.keyword) {
    conditions.push('(username LIKE ? OR display_name LIKE ? OR email LIKE ?)');
    const like = `%${query.keyword}%`;
    params.push(like, like, like);
  }
  const where = conditions.join(' AND ');

  const totalRows = await db.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM rn_identity_users WHERE ${where}`,
    params
  );
  const items = await db.query<UserRow>(
    `SELECT * FROM rn_identity_users WHERE ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

/** 把数据库行转换为后台 DTO（roles 稍后由 authorization 服务补齐）。 */
export function toAdminUserSummary(row: UserRow, roles: string[] = []): AdminUserSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    roles,
    status: row.status === 'active' ? 'active' : 'disabled',
    createdAt: toIso(row.created_at),
    ...(row.last_login_at ? { lastLoginAt: toIso(row.last_login_at) } : {})
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
