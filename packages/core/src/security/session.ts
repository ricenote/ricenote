/**
 * 会话边界（安全控制面的一部分，见 ADR-005）。
 *
 * Core 负责：
 * - 生成/校验不透明会话令牌（HMAC 签名 + 过期时间），写入 HttpOnly Cookie；
 * - 提供 `AuthContext` 供网关与插件读取；
 *
 * Core **不负责**用户业务：用户表、密码校验、会话持久化由 identity 插件实现，
 * 通过 `SessionResolver` 注入到 Core（依赖倒置）。
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthUser } from '@ricenote/shared';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';

export const SESSION_COOKIE_NAME = 'ricenote_session';
export const CSRF_COOKIE_NAME = 'ricenote_csrf';

export interface SessionPayload {
  sessionId: string;
  userId: number;
  issuedAt: number;
  expiresAt: number;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  expiresAt: Date;
}

/**
 * 会话解析器：由 identity 插件实现并注册。
 * 返回 undefined 表示令牌无效或已过期。
 */
export type SessionResolver = (sessionId: string) => Promise<AuthContext | undefined>;

export interface SessionManagerOptions {
  secret: string;
  ttlSeconds: number;
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
}

/** 会话令牌的签发、校验与 Cookie 序列化。 */
export class SessionManager {
  private resolver: SessionResolver | undefined;

  constructor(private readonly options: SessionManagerOptions) {}

  /** 由 identity 插件注册会话解析器。 */
  setResolver(resolver: SessionResolver): void {
    this.resolver = resolver;
  }

  hasResolver(): boolean {
    return this.resolver !== undefined;
  }

  /** 生成新的不透明会话 ID。 */
  createSessionId(): string {
    return randomBytes(32).toString('base64url');
  }

  /** 把会话 ID 与过期时间签名成 Cookie 值。 */
  sign(sessionId: string, expiresAt: Date): string {
    const payload = `${sessionId}.${Math.floor(expiresAt.getTime() / 1000)}`;
    const signature = this.hmac(payload);
    return `${payload}.${signature}`;
  }

  /** 校验 Cookie 值并返回负载；签名错误或过期返回 undefined。 */
  verify(cookieValue: string | undefined): SessionPayload | undefined {
    if (!cookieValue) return undefined;

    const parts = cookieValue.split('.');
    if (parts.length !== 3) return undefined;
    const [sessionId, expiresText, signature] = parts as [string, string, string];

    const expected = this.hmac(`${sessionId}.${expiresText}`);
    if (!safeCompare(signature, expected)) return undefined;

    const expiresAt = Number.parseInt(expiresText, 10);
    if (!Number.isFinite(expiresAt)) return undefined;
    if (expiresAt * 1000 <= Date.now()) return undefined;

    return {
      sessionId,
      userId: 0,
      issuedAt: 0,
      expiresAt: expiresAt * 1000
    };
  }

  /** 解析 Cookie 为完整认证上下文（需要 identity 插件已注册解析器）。 */
  async authenticate(cookieValue: string | undefined): Promise<AuthContext | undefined> {
    const payload = this.verify(cookieValue);
    if (!payload) return undefined;
    if (!this.resolver) return undefined; // 插件缺失 → 一律视为未认证（fail-closed）
    return this.resolver(payload.sessionId);
  }

  /** 生成 Set-Cookie 头。 */
  buildCookie(sessionId: string, expiresAt: Date): string {
    const parts = [
      `${SESSION_COOKIE_NAME}=${this.sign(sessionId, expiresAt)}`,
      'Path=/',
      'HttpOnly',
      `SameSite=${capitalize(this.options.cookieSameSite)}`,
      `Expires=${expiresAt.toUTCString()}`
    ];
    if (this.options.cookieSecure) parts.push('Secure');
    return parts.join('; ');
  }

  /** 生成清除 Cookie 的头。 */
  buildClearCookie(): string {
    const parts = [
      `${SESSION_COOKIE_NAME}=`,
      'Path=/',
      'HttpOnly',
      `SameSite=${capitalize(this.options.cookieSameSite)}`,
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'Max-Age=0'
    ];
    if (this.options.cookieSecure) parts.push('Secure');
    return parts.join('; ');
  }

  /** 会话生存时间（秒）。 */
  get ttlSeconds(): number {
    return this.options.ttlSeconds;
  }

  private hmac(payload: string): string {
    return createHmac('sha256', this.options.secret).update(payload).digest('base64url');
  }
}

/** 常量时间比较，避免签名比对被计时攻击。 */
export function safeCompare(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** 会话不可用时的统一错误。 */
export function sessionUnavailable(): RiceNoteError {
  return new RiceNoteError(
    ErrorCode.UNAUTHENTICATED,
    '会话服务不可用（identity 插件未启用或加载失败）',
    { status: 401 }
  );
}
