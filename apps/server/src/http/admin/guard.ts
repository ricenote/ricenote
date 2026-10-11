/**
 * 管理 API 的统一守卫。
 *
 * 所有 `/api/admin/*` 路由都经此包装，确保：
 * - 认证与权限校验不可绕过（fail-closed，见 ADR-005）；
 * - 写操作强制 CSRF 校验；
 * - 审计信息（操作者、IP、请求 ID）随上下文一并提供。
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext, RiceNoteKernel } from '@ricenote/core';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';

export interface AdminRequestContext<Body = unknown> {
  kernel: RiceNoteKernel;
  request: FastifyRequest;
  reply: FastifyReply;
  auth: AuthContext;
  body: Body;
  ip: string;
  requestId: string;
}

export interface GuardOptions {
  /** 权限点；为空表示仅需登录。 */
  permission?: string;
  /** 是否跳过认证（仅登录接口使用）。 */
  anonymous?: boolean;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

/**
 * 创建受守卫的管理路由处理器。
 *
 * @example
 * app.get('/plugins', guard(kernel, { permission: 'plugin.manage' }, async (ctx) => ctx.reply.send(...)))
 */
export function guard<Body = unknown>(
  kernel: RiceNoteKernel,
  options: GuardOptions,
  handle: (context: AdminRequestContext<Body>) => Promise<unknown> | unknown
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = kernel.gateway.clientIp(request.headers, request.ip);

    if (options.anonymous) {
      return handle({
        kernel,
        request,
        reply,
        auth: { user: { id: 0, username: '', displayName: '', email: '', roles: [], permissions: [] }, sessionId: '', expiresAt: new Date(0) },
        body: request.body as Body,
        ip,
        requestId: request.id
      });
    }

    const auth = await kernel.gateway.authenticate(request.headers);
    kernel.gateway.requireAuth(auth);

    if (isWriteMethod(request.method)) {
      kernel.gateway.enforceCsrf({ method: request.method, headers: request.headers, auth });
    }

    await kernel.gateway.requirePermission(auth, options.permission);

    return handle({
      kernel,
      request,
      reply,
      auth: auth as AuthContext,
      body: request.body as Body,
      ip,
      requestId: request.id
    });
  };
}

/** 关闭 CSRF 校验的守卫（用于登录等尚无会话的写接口）。 */
export function anonymousGuard<Body = unknown>(
  kernel: RiceNoteKernel,
  handle: (context: Omit<AdminRequestContext<Body>, 'auth'> & { auth?: AuthContext }) => Promise<unknown> | unknown
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (request, reply) => {
    const ip = kernel.gateway.clientIp(request.headers, request.ip);
    const auth = await kernel.gateway.authenticate(request.headers);
    return handle({
      kernel,
      request,
      reply,
      ...(auth ? { auth } : {}),
      body: request.body as Body,
      ip,
      requestId: request.id
    });
  };
}

/** 读取已注册的服务，缺失时给出可操作的错误提示。 */
export function requireService<T>(kernel: RiceNoteKernel, contract: string, hint: string): T {
  const service = kernel.services.tryUse<T>(contract);
  if (!service) {
    throw new RiceNoteError(
      ErrorCode.SERVICE_NOT_FOUND,
      `依赖的服务不可用：${contract}。${hint}`,
      { status: 503, details: { contract, available: kernel.services.list() } }
    );
  }
  return service;
}
