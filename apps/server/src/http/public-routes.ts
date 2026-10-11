/**
 * 公开站点路由。
 *
 * 组成：
 * 1. `/api/health` 健康检查（不受恢复模式影响）；
 * 2. `/preview/:token` 主题设置预览（后台 iframe 使用，不写公开配置）；
 * 3. 插件注册的页面路由（插件产出 ViewModel，Core 套主题渲染）；
 * 4. 插件注册的公开原始路由（RSS / sitemap 等）；
 * 5. 兜底：无任何页面提供者时展示恢复模式界面。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PageViewModel } from '@ricenote/plugin-sdk';
import { APP_VERSION, type RiceNoteKernel, type RegisteredPageRoute } from '@ricenote/core';
import { ErrorCode, isRiceNoteError, RiceNoteError } from '@ricenote/shared';
import { adaptReply, adaptRequest } from './fastify-adapter.js';
import { renderRecoveryPage } from '../recovery/recovery-mode.js';
import type { PreviewStore } from './preview-store.js';

export interface PublicRouteDeps {
  previewStore: PreviewStore;
}

/** 注册公开站点路由。 */
export function registerPublicRoutes(
  app: FastifyInstance,
  kernel: RiceNoteKernel,
  deps: PublicRouteDeps
): void {
  app.get('/api/health', async () => kernel.health());

  registerPreviewRoute(app, kernel, deps);

  const pageRoutes = kernel.router.pages();
  for (const page of pageRoutes) {
    app.get(page.path, async (request, reply) => {
      const response = await renderPageRoute(kernel, page, request);
      return reply.code(response.status).type('text/html; charset=utf-8').send(response.html);
    });
  }

  for (const route of kernel.router.rawRoutesList()) {
    if (route.capability !== 'routes:public') continue;
    app.route({
      method: route.method,
      url: route.path,
      handler: async (request, reply) => {
        const auth = await kernel.gateway.authenticate(request.headers).catch(() => undefined);
        const httpRequest = adaptRequest(request, {
          requestId: request.id,
          ...(auth ? { viewer: { user: auth.user } } : {})
        });
        await route.handler(httpRequest, adaptReply(reply));
      }
    });
  }

  // 兜底：所有未命中的请求
  app.setNotFoundHandler(async (request, reply) => {
    // 无页面提供者 → 恢复模式
    if (pageRoutes.length === 0) {
      return reply
        .code(503)
        .type('text/html; charset=utf-8')
        .send(buildRecoveryHtml(kernel, '当前没有任何内容插件注册页面路由，站点尚未就绪。'));
    }

    // 有页面提供者时，交给主题渲染 404 页面
    try {
      const httpRequest = adaptRequest(request, { requestId: request.id });
      const output = await kernel.renderer.render({
        kind: '404',
        title: '页面不存在',
        canonicalUrl: kernel.renderer.absolute(request.url),
        data: { message: '你访问的页面不存在或已被移除。' },
        status: 404,
        request: httpRequest
      });
      return reply.code(404).type('text/html; charset=utf-8').send(output.html);
    } catch (error) {
      kernel.logger.warn('404 页面渲染失败，回退到纯文本响应', {
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return reply.code(404).type('text/plain; charset=utf-8').send('404 Not Found');
    }
  });
}

/** 渲染单个页面路由。 */
async function renderPageRoute(
  kernel: RiceNoteKernel,
  page: RegisteredPageRoute,
  request: FastifyRequest
): Promise<{ html: string; status: number }> {
  const auth = await kernel.gateway.authenticate(request.headers).catch(() => undefined);
  const httpRequest = adaptRequest(request, {
    requestId: request.id,
    ...(auth ? { viewer: { user: auth.user } } : {})
  });

  let viewModel: PageViewModel;
  try {
    viewModel = await page.handler(httpRequest);
  } catch (error) {
    if (isRiceNoteError(error) && error.status === 404) {
      return renderFallback404(kernel, request, httpRequest, error.message);
    }
    kernel.logger.error('页面处理器执行失败', {
      requestId: request.id,
      route: page.name,
      plugin: page.pluginId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new RiceNoteError(
      ErrorCode.INTERNAL,
      `页面处理器执行失败（${page.name}）：${error instanceof Error ? error.message : String(error)}`,
      { status: 500 }
    );
  }

  const template = viewModel.template ?? page.template;

  const output = await kernel.renderer.render({
    kind: viewModel.kind,
    title: viewModel.title,
    canonicalUrl: viewModel.canonicalUrl
      ? kernel.renderer.absolute(viewModel.canonicalUrl)
      : kernel.renderer.absolute(request.url),
    data: viewModel.data,
    ...(template ? { template } : {}),
    ...(viewModel.status ? { status: viewModel.status } : {}),
    ...(viewModel.cacheTags ? { cacheTags: viewModel.cacheTags } : {}),
    cacheable: page.cacheable,
    request: httpRequest
  });

  return { html: output.html, status: viewModel.status ?? output.status };
}

/** 页面处理器明确返回 404 时，走主题的 404 模板。 */
async function renderFallback404(
  kernel: RiceNoteKernel,
  request: FastifyRequest,
  httpRequest: ReturnType<typeof adaptRequest>,
  message: string
): Promise<{ html: string; status: number }> {
  const output = await kernel.renderer.render({
    kind: '404',
    title: '页面不存在',
    canonicalUrl: kernel.renderer.absolute(request.url),
    data: { message },
    status: 404,
    request: httpRequest
  });
  return { html: output.html, status: 404 };
}

/** 预览路由：用草稿设置渲染首页，不写公开配置。 */
function registerPreviewRoute(
  app: FastifyInstance,
  kernel: RiceNoteKernel,
  deps: PublicRouteDeps
): void {
  app.get('/preview/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const entry = deps.previewStore.get(token);
    if (!entry) {
      return reply
        .code(410)
        .type('text/html; charset=utf-8')
        .send(
          '<!doctype html><meta charset="utf-8"><title>预览已过期</title>' +
            '<p style="font-family:system-ui;padding:2rem">预览链接已过期，请回到后台重新发起预览。</p>'
        );
    }

    const homePage =
      kernel.router.pages().find((page) => page.kind === 'home') ?? kernel.router.pages()[0];

    if (!homePage) {
      return reply
        .code(503)
        .type('text/html; charset=utf-8')
        .send(buildRecoveryHtml(kernel, '没有可预览的页面（缺少内容插件）。'));
    }

    const httpRequest = adaptRequest(request, { requestId: request.id });
    const viewModel = await homePage.handler(httpRequest);

    const output = await kernel.renderer.render({
      kind: viewModel.kind,
      title: viewModel.title,
      canonicalUrl: kernel.renderer.absolute('/'),
      data: viewModel.data,
      status: viewModel.status ?? 200,
      request: httpRequest,
      draftSettings: entry.values,
      cacheable: false
    });

    reply
      .code(output.status)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex, nofollow');

    return reply.send(output.html);
  });
}

/** 组装恢复模式页面。 */
export function buildRecoveryHtml(kernel: RiceNoteKernel, reason: string): string {
  let themeAvailable = false;
  try {
    themeAvailable = kernel.themeManager.listLoaded().length > 0;
  } catch {
    themeAvailable = false;
  }

  return renderRecoveryPage({
    siteTitle: kernel.config.site.title,
    siteUrl: kernel.config.http.siteUrl,
    version: APP_VERSION,
    reason,
    databaseReachable: true,
    themeAvailable,
    pluginReport: {
      started: kernel.pluginReport?.started ?? [],
      failed: kernel.pluginReport?.failed ?? [],
      invalid: kernel.pluginReport?.invalid ?? [],
      dependencyProblems: kernel.pluginReport?.dependencyProblems ?? []
    }
  });
}
