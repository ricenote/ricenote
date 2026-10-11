/**
 * HTTP 服务装配与启动。
 *
 * 路由注册顺序很关键：
 *   1. 主题静态资源（独立前缀，不参与兜底）
 *   2. 公开站点路由（含恢复模式兜底 `setNotFoundHandler`）
 *   3. `/api/admin/*` 子树（Core 端点 + 插件贡献的管理 API）
 */

import type { FastifyInstance } from 'fastify';
import type { RiceNoteKernel } from '@ricenote/core';
import { adaptReply, adaptRequest } from './http/fastify-adapter.js';
import { createHttpServer, type CreateServerOptions } from './http/server.js';
import { registerAdminSpa, registerThemeAssets } from './http/theme-assets.js';
import { registerPublicRoutes } from './http/public-routes.js';
import { PreviewStore } from './http/preview-store.js';
import { registerSessionRoutes } from './http/admin/session-routes.js';
import { registerThemeRoutes } from './http/admin/themes-routes.js';
import { registerPluginRoutes } from './http/admin/plugins-routes.js';
import { registerProfileRoutes } from './http/admin/profile-routes.js';
import { registerSystemRoutes } from './http/admin/system-routes.js';
import { guard, isWriteMethod } from './http/admin/guard.js';

export interface RunningServer {
  app: FastifyInstance;
  previewStore: PreviewStore;
  close(): Promise<void>;
}

/** 创建并启动 HTTP 服务。 */
export async function startHttpServer(
  kernel: RiceNoteKernel,
  options: CreateServerOptions = {}
): Promise<RunningServer> {
  const app = await createHttpServer(kernel, options);
  const previewStore = new PreviewStore(kernel.config.preview.ttlSeconds);

  registerThemeAssets(app, kernel);
  await registerAdminSpa(app, kernel);
  registerPublicRoutes(app, kernel, { previewStore });

  await app.register(
    async (instance) => {
      registerSessionRoutes(instance, kernel);
      registerThemeRoutes(instance, kernel, { previewStore });
      registerPluginRoutes(instance, kernel);
      registerProfileRoutes(instance, kernel);
      registerSystemRoutes(instance, kernel);

      // 插件贡献的管理 API：统一套用认证、CSRF、权限与审计
      for (const route of kernel.router.adminRoutesList()) {
        instance.route({
          method: route.method,
          url: route.path,
          handler: guard(
            kernel,
            route.permission ? { permission: route.permission } : {},
            async ({ kernel: k, request, reply, auth, ip, requestId }) => {
              const httpRequest = adaptRequest(request, {
                requestId: request.id,
                viewer: { user: auth.user }
              });
              await route.handler(httpRequest, adaptReply(reply));

              if (isWriteMethod(request.method)) {
                await k.audit.record({
                  action: `${request.method.toLowerCase()} /api/admin${route.path}`,
                  actorId: auth.user.id,
                  actorName: auth.user.username,
                  targetType: 'api',
                  targetId: route.path,
                  ip,
                  requestId
                });
              }
            }
          )
        });
      }
    },
    { prefix: '/api/admin' }
  );

  await app.listen({ host: kernel.config.http.host, port: kernel.config.http.port });

  return {
    app,
    previewStore,
    async close(): Promise<void> {
      await app.close();
    }
  };
}

/** 数据库不可用时的最小 HTTP 服务（仅提供诊断页面）。 */
export async function startDiagnosticServer(input: {
  host: string;
  port: number;
  html: () => string;
}): Promise<{ close(): Promise<void> }> {
  const app = await createHttpServer(
    {
      config: { env: 'production' } as never
    } as unknown as RiceNoteKernel,
    { trustProxy: false }
  );

  app.setNotFoundHandler(async (_request, reply) => {
    reply.code(503).type('text/html; charset=utf-8').send(input.html());
  });
  app.get('/', async (_request, reply) => {
    reply.code(503).type('text/html; charset=utf-8').send(input.html());
  });
  app.get('/api/health', async (_request, reply) => {
    reply.code(503).send({ error: { code: 'RN_DB_UNAVAILABLE', message: '数据库不可用' } });
  });

  await app.listen({ host: input.host, port: input.port });
  return { close: () => app.close() };
}
