/**
 * pages 插件注册的公开页面路由。
 *
 * 页面处理器只返回 ViewModel（kind + title + data），
 * 具体呈现交给主题；`template` 传的是**主题声明的模板键**，
 * 由 Core 渲染器解析为模板文件并在键失效时优雅回退到 `templates.page`。
 */

import type { PageRouteSpec, PluginContext } from '@ricenote/plugin-sdk';
import { normalizeSlug } from '@ricenote/shared';
import { findPublishedBySlug } from './repository.js';
import { toPageContentViewModel, type PagesRuntime } from './runtime.js';

export function registerPublicPages(ctx: PluginContext, runtime: PagesRuntime): void {
  const detail: PageRouteSpec = {
    name: 'page.show',
    path: '/page/:slug',
    kind: 'page',
    // 缓存开关来自插件设置：关闭后便于调试主题
    cacheable: runtime.cacheEnabled,
    handler: async (request) => {
      const raw = request.params.slug ?? '';
      const slug = normalizeSlug(raw, 'page');
      const row = await findPublishedBySlug(runtime.db, runtime.siteId, slug);

      if (!row) {
        return {
          kind: '404',
          title: '页面不存在',
          status: 404,
          data: { message: `未找到页面：${raw}` }
        };
      }

      const content = toPageContentViewModel(runtime, row, { withHtml: true });

      return {
        kind: 'page',
        title: row.seo_title ?? row.title,
        canonicalUrl: `/page/${row.slug}`,
        ...(row.template ? { template: row.template } : {}),
        data: {
          content,
          seoDescription: row.seo_description ?? ''
        },
        cacheTags: [`page:${row.id}`, 'pages']
      };
    }
  };

  ctx.routes.page(detail);
  runtime.logger.info('前台页面路由已注册', { routes: ['/page/:slug'] });
}
