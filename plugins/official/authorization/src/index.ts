/**
 * authorization 插件：角色、权限与分派。
 *
 * 关键设计：
 * - 通过 `core.security@1` 注册**权限解析器**，Core 网关据此执行 fail-closed 鉴权；
 * - 权限点的**声明**由各方自己负责（插件写在自己的 manifest、Core 写在内核），
 *   本插件只从 `core.security@1` 取聚合结果组装展示目录 —— 因此新增插件无需改动本插件；
 * - 订阅 `identity.user.created.v1` 事件完成角色分派，从而**不产生对 identity 的数据依赖**；
 * - 内置角色只有 `administrator`（`*`）：插件不替站点决定"谁该有什么权限"，
 *   其余角色由管理员在后台自建并显式授权。
 */

import { definePlugin } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  type AuthorizationService,
  type CoreSecurityService,
  type RoleDefinition
} from '@ricenote/shared';
import { ADMINISTRATOR_ROLE, BUILTIN_ROLES, buildPermissionCatalog } from './permissions.js';
import {
  assignRole,
  countAdministrators,
  ensureBuiltinRoles,
  findRoleByName,
  hasRole,
  listRoles,
  permissionsOf,
  revokeRole,
  rolesOf
} from './repository.js';

export default definePlugin({
  async start(ctx) {
    const db = ctx.db;

    await ensureBuiltinRoles(db);
    const security = ctx.services.use<CoreSecurityService>(SERVICE_CONTRACTS.CORE_SECURITY);

    ctx.logger.info('内置角色已就绪', {
      roles: BUILTIN_ROLES.length,
      names: BUILTIN_ROLES.map((role) => role.name)
    });

    const service: AuthorizationService = {
      permissionsOf: (userId) => permissionsOf(db, userId),
      rolesOf: (userId) => rolesOf(db, userId),
      listRoles: () => listRoles(db),
      /*
       * 权限目录来自 Core 的聚合视图（各插件声明 + Core 控制面权限点 + 实际使用点），
       * 这里只做本地化。未登记的权限点会以「未登记」分组出现，仍然可以分配给角色。
       */
      listPermissions: async () =>
        buildPermissionCatalog(security.listDeclaredPermissions(), ctx.site.language),
      assignRole: async (userId, roleName) => {
        const role = await findRoleByName(db, roleName);
        if (!role) {
          throw new RiceNoteError(ErrorCode.NOT_FOUND, `角色不存在：${roleName}`, { status: 404 });
        }
        await assignRole(db, userId, role.id);
        await ctx.events.emit('identity.authorization.role.assigned.v1', { userId, role: roleName });
      },
      revokeRole: async (userId, roleName) => {
        const role = await findRoleByName(db, roleName);
        if (!role) {
          throw new RiceNoteError(ErrorCode.NOT_FOUND, `角色不存在：${roleName}`, { status: 404 });
        }
        if (role.name === ADMINISTRATOR_ROLE) {
          const admins = await countAdministrators(db);
          const isAdmin = await hasRole(db, userId, role.id);
          if (isAdmin && admins <= 1) {
            throw new RiceNoteError(
              ErrorCode.VALIDATION_FAILED,
              '不能移除最后一个管理员的管理员角色',
              { status: 409 }
            );
          }
        }
        await revokeRole(db, userId, role.id);
        await ctx.events.emit('identity.authorization.role.revoked.v1', { userId, role: roleName });
      }
    };

    ctx.services.provide<AuthorizationService>({
      name: SERVICE_CONTRACTS.IDENTITY_AUTHORIZATION,
      version: ctx.manifest.version,
      implementation: service
    });

    /* ---------- 向 Core 注册权限解析器 ---------- */
    security.registerAuthorizationResolver({
      permissionsOf: (userId) => permissionsOf(db, userId),
      rolesOf: (userId) => rolesOf(db, userId)
    });

    /* ---------- 事件驱动：首个用户成为管理员，其余用户默认不分配角色 ---------- */
    ctx.events.on<{ userId: number; username?: string; isFirstUser?: boolean; role?: string }>(
      'identity.user.created.v1',
      async (payload) => {
        /*
         * 没有"默认角色"了：新用户该有什么权限是**站点管理员**的决定，不是插件的决定。
         * 首个用户仍然自动成为 administrator —— 否则全新站点会没有任何人能进后台。
         * 后台新建用户时若显式指定了角色，则按指定分派。
         */
        const roleName = payload.isFirstUser ? ADMINISTRATOR_ROLE : payload.role;

        if (!roleName) {
          ctx.logger.info('新用户未分配角色（请在后台「角色与权限」中显式授权）', {
            userId: payload.userId
          });
          return;
        }

        const role = await findRoleByName(db, roleName);
        if (!role) {
          ctx.logger.warn('指定角色不存在，跳过角色分派', { role: roleName, userId: payload.userId });
          return;
        }

        await assignRole(db, payload.userId, role.id);
        ctx.logger.info('已为用户分派角色', {
          userId: payload.userId,
          role: roleName,
          reason: payload.isFirstUser ? '首个用户自动成为管理员' : '按创建时指定'
        });

        if (payload.isFirstUser) {
          await ctx.events.emit('identity.authorization.bootstrap.completed.v1', {
            userId: payload.userId
          });
        }
      },
      { priority: 10 }
    );

    /* ---------- 管理 API ---------- */
    ctx.routes.adminApi({
      method: 'GET',
      path: '/roles',
      permission: 'user.manage',
      handler: async (_request, reply) => {
        const roles: RoleDefinition[] = await service.listRoles();
        reply.json({ data: roles });
      }
    });

    ctx.routes.adminApi({
      method: 'GET',
      path: '/permissions',
      permission: 'user.manage',
      handler: async (_request, reply) => {
        reply.json({ data: await service.listPermissions() });
      }
    });

    ctx.routes.adminApi({
      method: 'POST',
      path: '/users/:userId/roles',
      permission: 'user.manage',
      handler: async (request, reply) => {
        const { userId } = request.params;
        const body = (request.body ?? {}) as { role?: string };
        const roleName = String(body.role ?? '');
        if (!roleName) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '缺少 role 参数', { status: 400 });
        }
        await service.assignRole(Number(userId), roleName);
        reply.json({ data: { userId: Number(userId), role: roleName } });
      }
    });

    ctx.routes.adminApi({
      method: 'DELETE',
      path: '/users/:userId/roles/:role',
      permission: 'user.manage',
      handler: async (request, reply) => {
        const { userId, role } = request.params as { userId: string; role: string };
        await service.revokeRole(Number(userId), role);
        reply.json({ data: { userId: Number(userId), role, revoked: true } });
      }
    });

    /*
     * 后台菜单与界面来自 manifest.admin.pages（声明式）：
     * Core 负责注册菜单、托管 `admin/main.js` 并计算前端入口 URL，
     * 因此这里不再调用 ctx.adminMenu.add，也不需要 admin:menu 能力。
     */

    ctx.logger.info('authorization 插件已就绪', {
      declaredPermissions: security.listDeclaredPermissions().length
    });
  },

  async stop(ctx) {
    ctx.logger.info('authorization 插件已停止');
  }
});
