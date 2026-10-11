/**
 * CSRF 防护：双重提交 Cookie + 会话绑定签名。
 *
 * 策略：
 * - 登录成功后签发一个与会话 ID 绑定的 CSRF Token，写入非 HttpOnly Cookie 与登录响应体；
 * - 管理端所有**写操作**必须携带 `x-csrf-token` 头，值与 Cookie 一致且签名有效；
 * - GET/HEAD/OPTIONS 等安全方法不校验。
 */

import { createHmac, randomBytes } from 'node:crypto';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import { safeCompare } from './session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfManagerOptions {
  secret: string;
  enabled: boolean;
}

export class CsrfManager {
  constructor(private readonly options: CsrfManagerOptions) {}

  get enabled(): boolean {
    return this.options.enabled;
  }

  /** 为会话签发 CSRF Token。 */
  issue(sessionId: string): string {
    const nonce = randomBytes(16).toString('base64url');
    const signature = this.hmac(`${sessionId}.${nonce}`);
    return `${nonce}.${signature}`;
  }

  /** 校验请求头中的 Token 是否与 Cookie 匹配且签名有效。 */
  verify(input: {
    method: string;
    sessionId: string | undefined;
    headerToken: string | undefined;
    cookieToken: string | undefined;
  }): void {
    if (!this.options.enabled) return;
    if (SAFE_METHODS.has(input.method.toUpperCase())) return;

    if (!input.sessionId) {
      throw new RiceNoteError(ErrorCode.CSRF_INVALID, '缺少会话，无法校验 CSRF Token', {
        status: 403
      });
    }

    const headerToken = input.headerToken;
    const cookieToken = input.cookieToken;

    if (!headerToken || !cookieToken) {
      throw new RiceNoteError(ErrorCode.CSRF_INVALID, '缺少 CSRF Token', { status: 403 });
    }
    if (!safeCompare(headerToken, cookieToken)) {
      throw new RiceNoteError(ErrorCode.CSRF_INVALID, 'CSRF Token 与 Cookie 不一致', { status: 403 });
    }

    const separator = headerToken.indexOf('.');
    if (separator <= 0) {
      throw new RiceNoteError(ErrorCode.CSRF_INVALID, 'CSRF Token 格式非法', { status: 403 });
    }
    const nonce = headerToken.slice(0, separator);
    const signature = headerToken.slice(separator + 1);
    if (!safeCompare(signature, this.hmac(`${input.sessionId}.${nonce}`))) {
      throw new RiceNoteError(ErrorCode.CSRF_INVALID, 'CSRF Token 签名校验失败', { status: 403 });
    }
  }

  private hmac(payload: string): string {
    return createHmac('sha256', this.options.secret).update(`csrf:${payload}`).digest('base64url');
  }
}

/** 轻量登录失败限流（防暴力破解，按用户名 + IP 维度）。 */
export class LoginThrottle {
  private readonly attempts = new Map<string, { count: number; firstAt: number; blockedUntil?: number }>();

  constructor(
    private readonly options: { maxAttempts: number; windowSeconds: number; blockSeconds: number },
    private readonly now: () => number = () => Date.now()
  ) {}

  /** 记录一次失败；返回是否已被锁定。 */
  recordFailure(key: string): { blocked: boolean; remaining: number } {
    const now = this.now();
    const entry = this.attempts.get(key);
    const windowMs = this.options.windowSeconds * 1000;

    if (!entry || now - entry.firstAt > windowMs) {
      this.attempts.set(key, { count: 1, firstAt: now });
      return { blocked: false, remaining: this.options.maxAttempts - 1 };
    }

    entry.count += 1;
    if (entry.count >= this.options.maxAttempts) {
      entry.blockedUntil = now + this.options.blockSeconds * 1000;
      return { blocked: true, remaining: 0 };
    }
    return { blocked: false, remaining: this.options.maxAttempts - entry.count };
  }

  /** 判断是否处于锁定状态。 */
  isBlocked(key: string): boolean {
    const entry = this.attempts.get(key);
    if (!entry?.blockedUntil) return false;
    if (entry.blockedUntil <= this.now()) {
      this.attempts.delete(key);
      return false;
    }
    return true;
  }

  /** 登录成功后清除计数。 */
  reset(key: string): void {
    this.attempts.delete(key);
  }
}
