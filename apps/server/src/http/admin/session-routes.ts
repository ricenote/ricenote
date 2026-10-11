/**
 * 管理会话路由：登录、登出、当前身份。
 *
 * 认证业务由 identity 插件实现（`identity.auth@1`），
 * Core 只负责 Cookie 边界、CSRF、限流与审计（ADR-005）。
 */

import type { FastifyInstance } from 'fastify';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type RiceNoteKernel
} from '@ricenote/core';
import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  type IdentityAuthService,
  type LoginRequest,
  type LoginResponse,
  type AuthUser
} from '@ricenote/shared';
import { anonymousGuard, guard, requireService } from './guard.js';

const IDENTITY_HINT = '请确认 identity 插件已启用并成功启动（执行 pnpm migrate 后重启服务）。';

export function registerSessionRoutes(app: FastifyInstance, kernel: RiceNoteKernel): void {
  /** 当前身份；未登录返回 null（而不是 401，便于前端初始化）。 */
  app.get(
    '/session',
    anonymousGuard(kernel, async ({ kernel: k, request, reply, auth }) => {
      if (!auth) {
        return reply.send({ data: { user: null, csrfToken: null } });
      }
      const user = await k.gateway.describeUser(auth);
      const csrfToken = k.csrf.issue(auth.sessionId);
      reply.header(
        'set-cookie',
        buildCsrfCookie(csrfToken, k.config.env === 'production')
      );
      return reply.send({
        data: { user, csrfToken, expiresAt: auth.expiresAt.toISOString() }
      });
    })
  );

  /** 登录。 */
  app.post(
    '/session',
    anonymousGuard<LoginRequest>(kernel, async ({ kernel: k, request, reply, body, ip }) => {
      const payload = (body ?? {}) as Partial<LoginRequest>;
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';

      if (!username || !password) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '用户名与密码不能为空', { status: 400 });
      }

      const throttleKey = `${username}@${ip}`;
      if (k.throttle.isBlocked(throttleKey)) {
        throw new RiceNoteError(
          ErrorCode.RATE_LIMITED,
          '登录失败次数过多，请稍后再试',
          { status: 429 }
        );
      }

      const identity = requireService<IdentityAuthService>(k, SERVICE_CONTRACTS.IDENTITY_AUTH, IDENTITY_HINT);

      let result: Awaited<ReturnType<IdentityAuthService['login']>>;
      try {
        result = await identity.login({
          username,
          password,
          ip,
          userAgent: String(request.headers['user-agent'] ?? '')
        });
      } catch (error) {
        const outcome = k.throttle.recordFailure(throttleKey);
        await k.audit.record({
          action: 'auth.login.failed',
          targetType: 'user',
          targetId: username,
          ip,
          requestId: request.id,
          detail: { attemptsRemaining: outcome.remaining }
        });
        throw error;
      }

      k.throttle.reset(throttleKey);

      const expiresAt = new Date(result.expiresAt);
      const csrfToken = k.csrf.issue(result.sessionId);

      reply.header('set-cookie', [
        k.sessions.buildCookie(result.sessionId, expiresAt),
        buildCsrfCookie(csrfToken, k.config.env === 'production')
      ]);

      await k.audit.record({
        action: 'auth.login',
        actorId: result.user.id,
        actorName: result.user.username,
        targetType: 'user',
        targetId: String(result.user.id),
        ip,
        requestId: request.id
      });

      const user = await k.gateway.describeUser({
        user: result.user,
        sessionId: result.sessionId,
        expiresAt
      });

      const response: LoginResponse = {
        user,
        csrfToken,
        expiresAt: expiresAt.toISOString()
      };
      return reply.send({ data: response });
    })
  );

  /** 登出。 */
  app.delete(
    '/session',
    guard(kernel, {}, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const identity = k.services.tryUse<IdentityAuthService>(SERVICE_CONTRACTS.IDENTITY_AUTH);
      // 注意：即使 identity 不可用，也必须清除 Cookie，避免"无法登出"的困境
      if (identity) {
        await identity.logout(auth.sessionId).catch(() => undefined);
      }

      reply.header('set-cookie', [k.sessions.buildClearCookie(), clearCsrfCookie(k.config.env === 'production')]);

      await k.audit.record({
        action: 'auth.logout',
        actorId: auth.user.id,
        actorName: auth.user.username,
        ip,
        requestId
      });

      return reply.send({ data: { ok: true } });
    })
  );

  /** 当前用户的角色与权限（后台权限门控使用）。 */
  app.get(
    '/me',
    guard(kernel, {}, async ({ kernel: k, reply, auth }) => {
      const user: AuthUser = await k.gateway.describeUser(auth);
      return reply.send({ data: user });
    })
  );
}

/** CSRF Cookie 需要被前端 JS 读取，因此不设 HttpOnly。 */
function buildCsrfCookie(token: string, secure: boolean): string {
  const parts = [
    `${CSRF_COOKIE_NAME}=${token}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${8 * 3600}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCsrfCookie(secure: boolean): string {
  const parts = [`${CSRF_COOKIE_NAME}=`, 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
