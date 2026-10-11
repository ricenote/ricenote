/**
 * identity 插件：用户账号、会话与登录。
 *
 * 与 Core 的协作方式（ADR-005 依赖倒置）：
 * - 插件通过 `core.security@1` 注册**会话解析器**，Core 只负责 Cookie 边界与签名；
 * - 插件通过 `core.setup@1` 获取首次启动的管理员凭据；
 * - 用户创建后发布 `identity.user.created.v1` 事件，由 authorization 插件订阅并分派角色，
 *   从而避免 identity 直接依赖 authorization（否则会形成循环依赖）。
 */

import { randomBytes } from 'node:crypto';
import { definePlugin, type RouteHandler } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  type AdminUserSummary,
  type AuthUser,
  type AuthorizationService,
  type CoreSecurityService,
  type CoreSetupService,
  type IdentityAuthService
} from '@ricenote/shared';
import { hashPassword, validatePasswordStrength, verifyPassword } from './password.js';
import {
  countActiveSessions,
  countUsers,
  createSession,
  emailTaken,
  findActiveSession,
  findUserById,
  findUserByUsername,
  insertUser,
  listUsers,
  pruneExpiredSessions,
  revokeSession,
  revokeUserSessions,
  updateLastLogin,
  updatePassword,
  updateProfile,
  toAdminUserSummary,
  type UserRow
} from './repository.js';

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    roles: [],
    permissions: []
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** 取整并收敛到 [min, max]；非法值回退到 fallback。 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export default definePlugin({
  async start(ctx) {
    const db = ctx.db;
    // 与 manifest.settingsSchema 的范围声明一致：
    // 会话有效期 5 分钟 ~ 30 天，并发会话 1 ~ 100
    const sessionTtlSeconds = clampInt(ctx.config.get('sessionTtlSeconds', 7200), 300, 2592000, 7200);
    const maxSessionsPerUser = clampInt(ctx.config.get('maxSessionsPerUser', 10), 1, 100, 10);

    const loginFailed = (): RiceNoteError =>
      new RiceNoteError(ErrorCode.UNAUTHENTICATED, '用户名或密码错误', { status: 401 });

    const service: IdentityAuthService = {
      async login(input) {
        const user = await findUserByUsername(db, input.username);
        if (!user) {
          // 与存在用户时的耗时对齐，降低用户名枚举的可观测差异
          await hashPassword(input.password);
          throw loginFailed();
        }
        if (user.status !== 'active') {
          throw new RiceNoteError(ErrorCode.FORBIDDEN, '该账号已被禁用', { status: 403 });
        }

        const valid = await verifyPassword(input.password, user.password_hash);
        if (!valid) throw loginFailed();

        const sessionId = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);

        await createSession(db, {
          sessionId,
          userId: user.id,
          expiresAt,
          ...(input.ip ? { ip: input.ip } : {}),
          ...(input.userAgent ? { userAgent: input.userAgent } : {})
        });
        await updateLastLogin(db, user.id);
        await enforceSessionLimit(db, user.id, maxSessionsPerUser);
        await ctx.events.emit('identity.session.created.v1', {
          userId: user.id,
          sessionId,
          ip: input.ip ?? null
        });

        return {
          user: toAuthUser(user),
          sessionId,
          expiresAt: expiresAt.toISOString()
        };
      },

      async resolveSession(sessionId) {
        const session = await findActiveSession(db, sessionId);
        if (!session) return undefined;

        const user = await findUserById(db, session.user_id);
        if (!user || user.status !== 'active') return undefined;

        return {
          user: toAuthUser(user),
          sessionId,
          expiresAt: toIso(session.expires_at)
        };
      },

      async logout(sessionId) {
        await revokeSession(db, sessionId);
      },

      async ensureBootstrapAdmin(input) {
        const total = await countUsers(db);
        if (total > 0) return { created: false };

        const strengthError = validatePasswordStrength(input.password, input.username);
        if (strengthError) {
          throw new RiceNoteError(
            ErrorCode.VALIDATION_FAILED,
            `初始管理员密码不符合要求：${strengthError}`,
            { status: 400 }
          );
        }

        const passwordHash = await hashPassword(input.password);
        const userId = await insertUser(db, {
          username: input.username,
          displayName: input.username,
          email: input.email,
          passwordHash
        });

        // 交由 authorization 插件分配内置管理员角色（事件驱动，避免循环依赖）
        await ctx.events.emit('identity.user.created.v1', {
          userId,
          username: input.username,
          isFirstUser: true
        });

        return { created: true, userId };
      },

      async changePassword(input) {
        const user = await findUserById(db, input.userId);
        if (!user) {
          throw new RiceNoteError(ErrorCode.NOT_FOUND, '用户不存在', { status: 404 });
        }
        const valid = await verifyPassword(input.currentPassword, user.password_hash);
        if (!valid) {
          throw new RiceNoteError(ErrorCode.UNAUTHENTICATED, '当前密码不正确', { status: 401 });
        }
        const strengthError = validatePasswordStrength(input.nextPassword, user.username);
        if (strengthError) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, strengthError, { status: 400 });
        }

        await updatePassword(db, user.id, await hashPassword(input.nextPassword));
        // 改密后强制其他会话失效
        await revokeUserSessions(db, user.id);
        await ctx.events.emit('identity.user.password.changed.v1', { userId: user.id });
      },

      /**
       * 修改本人资料（显示名与邮箱）。
       *
       * 与改密的差别：资料修改属于低风险操作，调用方已通过会话认证，
       * 因此不再要求原密码；但邮箱必须唯一，否则会出现"两个账号同一邮箱"
       * 导致后续找回/通知行为不可预期。
       */
      async updateProfile(input) {
        const user = await findUserById(db, input.userId);
        if (!user) {
          throw new RiceNoteError(ErrorCode.NOT_FOUND, '用户不存在', { status: 404 });
        }

        const displayName =
          input.displayName === undefined ? undefined : String(input.displayName).trim();
        const email = input.email === undefined ? undefined : String(input.email).trim();

        if (displayName !== undefined) {
          if (displayName.length === 0) {
            throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '显示名不能为空', { status: 400 });
          }
          if (displayName.length > 120) {
            throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '显示名不得超过 120 字', { status: 400 });
          }
        }
        if (email !== undefined) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
            throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '邮箱格式不正确', { status: 400 });
          }
          if (await emailTaken(db, email, user.id)) {
            throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `邮箱已被占用：${email}`, {
              status: 409
            });
          }
        }

        await updateProfile(db, user.id, {
          ...(displayName === undefined ? {} : { displayName }),
          ...(email === undefined ? {} : { email })
        });

        const updated = await findUserById(db, user.id);
        await ctx.events.emit('identity.user.profile.updated.v1', { userId: user.id });
        return toAuthUser(updated ?? user);
      },

      /**
       * 管理员重置他人密码。
       *
       * 语义：不需要原密码（管理员代操作），重置后强制该用户**全部会话**失效。
       * 这也是"不能借重置接口改自己密码"的原因 —— 本人改密必须走
       * `changePassword`（校验原密码），避免管理员会话被滥用后无声接管账号。
       */
      async resetPassword(input) {
        const user = await findUserById(db, input.userId);
        if (!user) {
          throw new RiceNoteError(ErrorCode.NOT_FOUND, '用户不存在', { status: 404 });
        }

        const strengthError = validatePasswordStrength(input.newPassword, user.username);
        if (strengthError) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, strengthError, { status: 400 });
        }

        await updatePassword(db, user.id, await hashPassword(input.newPassword));
        const revoked = await revokeUserSessions(db, user.id);
        await ctx.events.emit('identity.user.password.changed.v1', {
          userId: user.id,
          byAdmin: true
        });
        ctx.logger.warn('管理员重置了用户密码', { userId: user.id, revokedSessions: revoked });
      },

      async listUsers(query) {
        const result = await listUsers(db, query);
        const authorization = ctx.services.tryUse<AuthorizationService>(
          SERVICE_CONTRACTS.IDENTITY_AUTHORIZATION
        );

        const items: AdminUserSummary[] = [];
        for (const row of result.items) {
          const roles = authorization ? await authorization.rolesOf(row.id).catch(() => []) : [];
          items.push(toAdminUserSummary(row, roles));
        }
        return { items, total: result.total };
      },

      async countUsers() {
        return { total: await countUsers(db) };
      },

      async countActiveSessions() {
        return countActiveSessions(db);
      }
    };

    ctx.services.provide<IdentityAuthService>({
      name: SERVICE_CONTRACTS.IDENTITY_AUTH,
      version: ctx.manifest.version,
      implementation: service
    });

    /* ---------- 用户查询服务（供 posts 等插件获取作者信息） ---------- */
    ctx.services.provide({
      name: 'identity.users@1',
      version: ctx.manifest.version,
      implementation: {
        findById: async (userId: number) => {
          const row = await findUserById(db, userId);
          return row
            ? { id: row.id, username: row.username, displayName: row.display_name, email: row.email }
            : undefined;
        },
        displayNames: async (userIds: number[]) => {
          const output: Record<number, string> = {};
          for (const userId of [...new Set(userIds)]) {
            const row = await findUserById(db, userId);
            if (row) output[row.id] = row.display_name || row.username;
          }
          return output;
        }
      }
    });

    /* ---------- 向 Core 注册会话解析器（依赖倒置） ---------- */
    const security = ctx.services.use<CoreSecurityService>(SERVICE_CONTRACTS.CORE_SECURITY);
    security.registerSessionResolver((sessionId) => service.resolveSession(sessionId));

    /* ---------- 首次启动创建管理员 ----------
     *
     * 挂在 `core.runtime.started.v1` 之后执行，而不是直接写在 start() 中：
     * 因为 authorization 插件依赖本插件、启动更晚，若在 start() 里创建用户并发出
     * `identity.user.created.v1`，authorization 尚未订阅，会导致管理员拿不到角色。
     */
    const setup = ctx.services.use<CoreSetupService>(SERVICE_CONTRACTS.CORE_SETUP);

    ctx.events.on('core.runtime.started.v1', async () => {
      try {
        const result = await service.ensureBootstrapAdmin(setup.bootstrapAdmin());
        if (result.created) {
          ctx.logger.info('已创建初始管理员账号', {
            username: setup.bootstrapAdmin().username,
            hint: '请登录后立即修改密码'
          });
        }
      } catch (error) {
        ctx.logger.error('创建初始管理员失败', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    /* ---------- 日常维护 ---------- */
    try {
      const pruned = await pruneExpiredSessions(db);
      if (pruned > 0) ctx.logger.info('已清理过期会话', { count: pruned });
    } catch (error) {
      ctx.logger.warn('清理过期会话失败', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    /* ---------- 管理 API ---------- */
    ctx.routes.adminApi({
      method: 'GET',
      path: '/users',
      permission: 'user.manage',
      handler: async (request, reply) => {
        const query = request.query as { page?: string; pageSize?: string; keyword?: string };
        const result = await service.listUsers({
          page: query.page ? Number(query.page) : 1,
          pageSize: query.pageSize ? Number(query.pageSize) : 20,
          ...(query.keyword ? { keyword: query.keyword } : {})
        });
        reply.json({
          data: result.items,
          total: result.total,
          page: query.page ? Number(query.page) : 1,
          pageSize: query.pageSize ? Number(query.pageSize) : 20
        });
      }
    });

    ctx.routes.adminApi({
      method: 'POST',
      path: '/users',
      permission: 'user.manage',
      handler: async (request, reply) => {
        const body = (request.body ?? {}) as {
          username?: string;
          displayName?: string;
          email?: string;
          password?: string;
          role?: string;
        };

        const username = String(body.username ?? '').trim();
        const email = String(body.email ?? '').trim();
        const password = String(body.password ?? '');

        if (!username || !email || !password) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '用户名、邮箱与密码均为必填项', {
            status: 400
          });
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_.-]{2,63}$/.test(username)) {
          throw new RiceNoteError(
            ErrorCode.VALIDATION_FAILED,
            '用户名需以字母开头，仅含字母、数字、下划线、点或短横线，长度 3-64',
            { status: 400 }
          );
        }
        const strengthError = validatePasswordStrength(password, username);
        if (strengthError) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, strengthError, { status: 400 });
        }
        if (await findUserByUsername(db, username)) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `用户名已存在：${username}`, {
            status: 409
          });
        }

        const userId = await insertUser(db, {
          username,
          displayName: String(body.displayName ?? '').trim() || username,
          email,
          passwordHash: await hashPassword(password)
        });

        await ctx.events.emit('identity.user.created.v1', {
          userId,
          username,
          isFirstUser: false,
          ...(body.role ? { role: String(body.role) } : {})
        });

        reply.statusCode = 201;
        reply.json({ data: { id: userId, username } });
      }
    });

    /**
     * 管理员重置他人密码。
     *
     * 刻意拒绝"重置自己"：本人改密必须走 `/me/password` 并校验原密码，
     * 否则一个被盗用的管理员会话可以无声地把账号密码换掉。
     */
    ctx.routes.adminApi({
      method: 'POST',
      path: '/users/:userId/password',
      permission: 'user.manage',
      handler: async (request, reply) => {
        const target = Number((request.params as { userId?: string }).userId);
        if (!Number.isInteger(target) || target <= 0) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '用户 ID 非法', { status: 400 });
        }
        if (request.viewer?.user.id === target) {
          throw new RiceNoteError(
            ErrorCode.VALIDATION_FAILED,
            '不能通过重置接口修改自己的密码，请使用「个人资料 → 修改密码」（需要校验原密码）',
            { status: 400 }
          );
        }

        const body = (request.body ?? {}) as { newPassword?: string };
        await service.resetPassword({
          userId: target,
          newPassword: String(body.newPassword ?? '')
        });
        reply.json({ data: { id: target, reset: true } });
      }
    });

    ctx.routes.adminApi({
      method: 'POST',
      path: '/me/password',
      handler: async (request, reply) => {
        const body = (request.body ?? {}) as { currentPassword?: string; nextPassword?: string };
        const userId = request.viewer?.user.id ?? 0;
        if (!userId) {
          throw new RiceNoteError(ErrorCode.UNAUTHENTICATED, '未登录', { status: 401 });
        }
        await service.changePassword({
          userId,
          currentPassword: String(body.currentPassword ?? ''),
          nextPassword: String(body.nextPassword ?? '')
        });
        reply.json({ data: { ok: true } });
      }
    });

    /*
     * 后台菜单与界面来自 manifest.admin.pages（声明式）：
     * Core 负责注册菜单、托管 `admin/main.js` 并计算前端入口 URL，
     * 因此这里不再调用 ctx.adminMenu.add，也不需要 admin:menu 能力。
     */

    ctx.logger.info('identity 插件已就绪', {
      provides: ctx.manifest.provides,
      sessionTtlSeconds
    });
  },

  async stop(ctx) {
    // 服务与路由句柄由 Core 统一注销
    ctx.logger.info('identity 插件已停止');
  }
});

/** 限制单用户并发会话数：超出的最旧会话被吊销。 */
async function enforceSessionLimit(
  db: { query: <T>(sql: string, params?: readonly unknown[]) => Promise<T[]>; execute: (sql: string, params?: readonly unknown[]) => Promise<unknown> },
  userId: number,
  limit: number
): Promise<void> {
  const rows = await db.query<{ session_id: string }>(
    `SELECT session_id FROM rn_identity_sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 200`,
    [userId]
  );
  if (rows.length <= limit) return;

  const stale = rows.slice(limit).map((row) => row.session_id);
  for (const sessionId of stale) {
    await db.execute(
      'UPDATE rn_identity_sessions SET revoked_at = NOW() WHERE session_id = ?',
      [sessionId]
    );
  }
}
