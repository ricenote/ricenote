/**
 * Fastify ↔ Plugin SDK 适配层。
 *
 * 插件只依赖 `HttpRequestLike` / `HttpResponseLike`（框架无关），
 * 由这里把 Fastify 的 request/reply 适配进去，从而避免框架锁定（ADR-004 的配套）。
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '@ricenote/shared';
import type { HttpRequestLike, HttpResponseLike } from '@ricenote/plugin-sdk';

/** 从出站 HTML 中提取原始文本（供统一发送）。 */
function payloadToString(payload: string | Buffer | undefined): string | Buffer {
  return payload ?? '';
}

export interface AdaptOptions {
  requestId: string;
  viewer?: { user: AuthUser };
}

/** 把 Fastify 请求适配为 SDK 请求。 */
export function adaptRequest(
  request: FastifyRequest,
  options: AdaptOptions
): HttpRequestLike {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    headers[key.toLowerCase()] = value as string | string[] | undefined;
  }

  return {
    method: request.method,
    url: request.url,
    params: (request.params ?? {}) as Record<string, string>,
    query: (request.query ?? {}) as Record<string, unknown>,
    body: request.body,
    headers,
    requestId: options.requestId,
    ...(options.viewer ? { viewer: options.viewer } : {}),
    async file() {
      if (typeof request.file !== 'function') return undefined;
      const uploaded = await request.file();
      if (!uploaded) return undefined;
      return {
        fileName: uploaded.filename,
        mimeType: uploaded.mimetype,
        buffer: await uploaded.toBuffer()
      };
    },
    raw: request
  };
}

/** 把 Fastify 响应适配为 SDK 响应。 */
export function adaptReply(reply: FastifyReply): HttpResponseLike {
  let statusCode = reply.statusCode;

  const facade: HttpResponseLike = {
    get statusCode(): number {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
      reply.code(value);
    },
    header(name: string, value: string): HttpResponseLike {
      reply.header(name, value);
      return facade;
    },
    send(payload?: string | Buffer): void {
      reply.code(statusCode).send(payloadToString(payload));
    },
    json(payload: unknown): void {
      reply.code(statusCode).type('application/json; charset=utf-8').send(payload);
    },
    html(markup: string): void {
      reply.code(statusCode).type('text/html; charset=utf-8').send(String(markup));
    },
    redirect(url: string, code = 302): void {
      reply.code(code).header('location', url).send();
    }
  };

  return facade;
}
