/**
 * 安全网关：认证、CSRF、能力校验与审计的统一入口（ADR-005）。
 *
 * Fail-closed 原则：当无法确定用户权限时（authorization 插件未启用、
 * 解析器未注册、查询失败），一律**拒绝**，绝不默认放行。
 */

import type { AuthUser } from '@ricenote/shared';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import type { Logger } from '../logger.js';
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, type AuthContext, type SessionManager } from './session.js';
import type { CsrfManager } from './csrf.js';
import type { AuditLogger, AuditInput } from './audit.js';

/** 由 authorization 插件实现的权限解析器。 */
export interface AuthorizationResolver {
  /** 返回用户拥有的权限点集合。 */
  permissionsOf(userId: number): Promise<string[]>;
  /** 返回用户拥有的角色。 */
  rolesOf(userId: number): Promise<string[]>;
}

export interface GatewayDeps {
  sessionManager: SessionManager;
  csrfManager: CsrfManager;
  audit: AuditLogger;
  logger: Logger;
  /** 是否信任反向代理传来的 X-Forwarded-For。 */
  trustProxy: boolean;
}

/** 请求头读取辅助（兼容 string / string[] / undefined）。 */
function headerOf(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/** 解析 Cookie 头中的指定键。 */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

export class SecurityGateway {
  private authorization: AuthorizationResolver | undefined;

  constructor(private readonly deps: GatewayDeps) {}

  /** 由 authorization 插件注册权限解析器。 */
  setAuthorizationResolver(resolver: AuthorizationResolver): void {
    this.authorization = resolver;
    this.deps.logger.info('权限解析器已注册', { source: 'authorization 插件' });
  }

  hasAuthorization(): boolean {
    return this.authorization !== undefined;
  }

  /* --------------------------- 认证 --------------------------- */

  /** 依据 Cookie 头解析认证上下文。 */
  async authenticate(
    headers: Record<string, string | string[] | undefined>
  ): Promise<AuthContext | undefined> {
    const cookie = readCookie(headerOf(headers, 'cookie'), SESSION_COOKIE_NAME);
    return this.deps.sessionManager.authenticate(cookie);
  }

  /** 要求已认证，否则抛 401。 */
  requireAuth(context: AuthContext | undefined): AuthContext {
    if (!context) {
      throw new RiceNoteError(ErrorCode.UNAUTHENTICATED, '未登录或会话已失效', { status: 401 });
    }
    return context;
  }

  /** 要求具备指定权限点；无解析器时 fail-closed。 */
  async requirePermission(
    context: AuthContext | undefined,
    permission: string | undefined
  ): Promise<AuthContext> {
    const auth = this.requireAuth(context);
    if (!permission) return auth;

    const resolver = this.authorization;
    if (!resolver) {
      throw new RiceNoteError(
        ErrorCode.FORBIDDEN,
        '权限服务不可用（authorization 插件未启用），已按最小权限原则拒绝该操作',
        { status: 403, details: { permission } }
      );
    }

    let granted: string[];
    try {
      granted = await resolver.permissionsOf(auth.user.id);
    } catch (error) {
      throw new RiceNoteError(ErrorCode.FORBIDDEN, '权限校验失败，已拒绝该操作', {
        status: 403,
        details: { permission, reason: error instanceof Error ? error.message : String(error) }
      });
    }

    if (!granted.includes(permission) && !granted.includes('*')) {
      throw new RiceNoteError(ErrorCode.FORBIDDEN, `缺少所需权限：${permission}`, {
        status: 403,
        details: { permission, granted }
      });
    }

    return auth;
  }

  /** 为已登录用户补齐角色与权限（供 /api/admin/me 使用）。 */
  async describeUser(auth: AuthContext): Promise<AuthUser> {
    const resolver = this.authorization;
    if (!resolver) {
      return { ...auth.user, roles: [], permissions: [] };
    }
    const [roles, permissions] = await Promise.all([
      resolver.rolesOf(auth.user.id).catch(() => [] as string[]),
      resolver.permissionsOf(auth.user.id).catch(() => [] as string[])
    ]);
    return { ...auth.user, roles, permissions };
  }

  /* --------------------------- CSRF --------------------------- */

  /** 校验写操作的 CSRF Token。 */
  enforceCsrf(input: {
    method: string;
    headers: Record<string, string | string[] | undefined>;
    auth: AuthContext | undefined;
  }): void {
    const cookieHeader = headerOf(input.headers, 'cookie');
    this.deps.csrfManager.verify({
      method: input.method,
      sessionId: input.auth?.sessionId,
      headerToken: headerOf(input.headers, 'x-csrf-token'),
      cookieToken: readCookie(cookieHeader, CSRF_COOKIE_NAME)
    });
  }

  /* --------------------------- 审计 --------------------------- */

  async audit(input: AuditInput): Promise<void> {
    await this.deps.audit.record(input);
  }

  /** 从不透明请求对象中提取客户端 IP。 */
  clientIp(headers: Record<string, string | string[] | undefined>, remoteAddress?: string): string {
    if (this.deps.trustProxy) {
      const forwarded = headerOf(headers, 'x-forwarded-for');
      if (forwarded) return forwarded.split(',')[0]?.trim() ?? remoteAddress ?? '';
    }
    return remoteAddress ?? '';
  }
}
