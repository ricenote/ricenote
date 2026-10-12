/**
 * authorization 插件的数据访问层。
 *
 * 只操作 `rn_authz_*` 表；用户信息通过服务契约获取，不做跨表联查。
 */

import type { PluginDatabase } from '@ricenote/plugin-sdk';
import type { RoleDefinition } from '@ricenote/shared';
import { BUILTIN_ROLES } from './permissions.js';

export interface RoleRow {
  id: number;
  name: string;
  description: string | null;
  builtin: number;
}

/**
 * 确保内置角色存在。
 *
 * 内置角色现在**只有一个** `administrator`，且它的权限恒为 `*`：
 * - 角色记录幂等写入（`builtin = 1`，不可删除，`description` 会被补齐）；
 * - 权限只做"确保 `*` 在"，**不再重写**该角色已授予的其它权限点 ——
 *   历史上"每次启动 DELETE 后重写"的语义会让管理员在后台做的调整在重启后消失
 *   （对内置角色尤其致命），本轮把它改掉；
 * - 自定义角色与其它已有角色完全不被触碰。
 */
export async function ensureBuiltinRoles(db: PluginDatabase): Promise<void> {
  for (const role of BUILTIN_ROLES) {
    await db.execute(
      `INSERT INTO rn_authz_roles (name, description, builtin, created_at)
       VALUES (?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE description = VALUES(description), builtin = 1`,
      [role.name, role.description]
    );

    const rows = await db.query<{ id: number }>(
      'SELECT id FROM rn_authz_roles WHERE name = ? LIMIT 1',
      [role.name]
    );
    const roleId = rows[0]?.id;
    if (!roleId) continue;

    for (const permission of role.permissions) {
      await db.execute(
        `INSERT INTO rn_authz_role_permissions (role_id, permission)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE permission = permission`,
        [roleId, permission]
      );
    }
  }
}

export async function permissionsOf(db: PluginDatabase, userId: number): Promise<string[]> {
  const rows = await db.query<{ permission: string }>(
    `SELECT DISTINCT rp.permission AS permission
       FROM rn_authz_user_roles ur
       JOIN rn_authz_role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?`,
    [userId]
  );
  return rows.map((row) => row.permission).sort();
}

export async function rolesOf(db: PluginDatabase, userId: number): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    `SELECT r.name AS name
       FROM rn_authz_user_roles ur
       JOIN rn_authz_roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.name ASC`,
    [userId]
  );
  return rows.map((row) => row.name);
}

export async function findRoleByName(
  db: PluginDatabase,
  name: string
): Promise<RoleRow | undefined> {
  const rows = await db.query<RoleRow>(
    'SELECT id, name, description, builtin FROM rn_authz_roles WHERE name = ? LIMIT 1',
    [name]
  );
  return rows[0];
}

export async function listRoles(db: PluginDatabase): Promise<RoleDefinition[]> {
  const roles = await db.query<RoleRow>(
    'SELECT id, name, description, builtin FROM rn_authz_roles ORDER BY builtin DESC, name ASC'
  );

  const output: RoleDefinition[] = [];
  for (const role of roles) {
    const permissions = await db.query<{ permission: string }>(
      'SELECT permission FROM rn_authz_role_permissions WHERE role_id = ? ORDER BY permission ASC',
      [role.id]
    );
    output.push({
      id: role.id,
      name: role.name,
      ...(role.description ? { description: role.description } : {}),
      permissions: permissions.map((row) => row.permission),
      builtin: role.builtin === 1
    });
  }
  return output;
}

export async function assignRole(db: PluginDatabase, userId: number, roleId: number): Promise<void> {
  await db.execute(
    `INSERT INTO rn_authz_user_roles (user_id, role_id, created_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE created_at = created_at`,
    [userId, roleId]
  );
}

export async function revokeRole(db: PluginDatabase, userId: number, roleId: number): Promise<number> {
  const result = await db.execute('DELETE FROM rn_authz_user_roles WHERE user_id = ? AND role_id = ?', [
    userId,
    roleId
  ]);
  return result.affectedRows;
}

/** 判断用户是否已拥有某角色。 */
export async function hasRole(db: PluginDatabase, userId: number, roleId: number): Promise<boolean> {
  const rows = await db.query<{ total: number }>(
    'SELECT COUNT(*) AS total FROM rn_authz_user_roles WHERE user_id = ? AND role_id = ?',
    [userId, roleId]
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

/** 统计拥有管理员角色的用户数（用于防止把最后一个管理员降级）。 */
export async function countAdministrators(db: PluginDatabase): Promise<number> {
  const rows = await db.query<{ total: number }>(
    `SELECT COUNT(DISTINCT ur.user_id) AS total
       FROM rn_authz_user_roles ur
       JOIN rn_authz_roles r ON r.id = ur.role_id
      WHERE r.name = 'administrator'`
  );
  return Number(rows[0]?.total ?? 0);
}
