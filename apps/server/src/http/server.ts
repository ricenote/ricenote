/**
 * Fastify 实例装配：Cookie、Multipart、请求 ID、结构化访问日志与统一错误处理。
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { ErrorCode, isRiceNoteError, RiceNoteError } from '@ricenote/shared';
import type { RiceNoteKernel } from '@ricenote/core';

/**
 * Multipart 传输层默认上限。
 *
 * 这里只设"传输层"的宽上限，**各业务端点必须再用更严格的限额**：
 * - media 插件：插件内 `maxFileBytes`（默认 8MB）；
 * - 主题安装：`DEFAULT_ZIP_GUARD.maxArchiveBytes`（32MB）；
 * - 插件安装：`PLUGIN_ZIP_GUARD.maxArchiveBytes`（16MB）；
 * - 备份恢复：`RESTORE_ZIP_GUARD.maxArchiveBytes`（128MB）。
 *
 * 之所以不把传输上限压到 8MB：备份恢复包天然可能超过它。
 */
export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export interface CreateServerOptions {
  /** 是否信任 X-Forwarded-* 头。 */
  trustProxy?: boolean;
}

/** 创建并配置 Fastify 实例（不含业务路由）。 */
export async function createHttpServer(
  kernel: RiceNoteKernel,
  options: CreateServerOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: options.trustProxy ?? kernel.config.env === 'production',
    bodyLimit: MAX_JSON_BODY_BYTES,
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined) ?? randomUUID()
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 12 }
  });

  // 允许"无 body"的 POST/PUT（例如主题激活、插件启停等动作型端点）。
  // 部分客户端会在没有 body 时仍发送 Content-Type，若没有对应解析器就会得到 415。
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, payload, done) => {
    done(null, payload.length > 0 ? payload : undefined);
  });

  const accessLogger = kernel.logger.child({ component: 'http' });

  app.addHook('onRequest', async (request, reply) => {
    (request as unknown as { startedAt: number }).startedAt = Date.now();

    /*
     * 软重启期间快速失败。
     *
     * 重启会关闭 HTTP 服务，但"收到重启请求 → 真正关闭"之间有几百毫秒的宽限期，
     * 期间进来的请求若不拦截就会在关停时被连接重置，客户端只能看到模糊的网络错误。
     * 这里返回结构化的 503，前端据此显示"服务重启中"而不是"网络异常"。
     */
    if (kernel.runtime?.state().restarting === true) {
      reply
        .code(503)
        .header('retry-after', '5')
        .send({
          error: {
            code: ErrorCode.RESTART_IN_PROGRESS,
            message: '服务正在重启，请稍候重试'
          }
        });
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = (request as unknown as { startedAt?: number }).startedAt ?? Date.now();
    accessLogger.info('请求完成', {
      requestId: request.id,
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      durationMs: Date.now() - startedAt,
      ip: request.ip
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = isRiceNoteError(error)
      ? error
      : normalizFastifyError(error as Error & { statusCode?: number; code?: string });

    if (normalized.status >= 500) {
      kernel.logger.error('请求处理失败', {
        requestId: request.id,
        method: request.method,
        url: request.url,
        code: normalized.code,
        error: normalized.message
      });
    }

    reply
      .code(normalized.status)
      .type('application/json; charset=utf-8')
      .send(normalized.toJSON());
  });

  return app;
}

/** 把 Fastify 内置错误（如 body 解析失败）归一化为 RiceNote 错误。 */
function normalizFastifyError(error: Error & { statusCode?: number; code?: string }): RiceNoteError {
  const status = error.statusCode ?? 500;
  const code =
    status === 400
      ? ErrorCode.VALIDATION_FAILED
      : status === 404
        ? ErrorCode.NOT_FOUND
        : status === 413
          ? ErrorCode.VALIDATION_FAILED
          : status >= 400 && status < 500
            ? ErrorCode.VALIDATION_FAILED
            : ErrorCode.INTERNAL;

  return new RiceNoteError(code, error.message || '请求处理失败', {
    status,
    details: error.code ? { frameworkCode: error.code } : {}
  });
}
