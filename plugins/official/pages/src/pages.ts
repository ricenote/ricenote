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

      // 内容字段声明来自当前主题；视图模型构造保持同步，因此在请求期（async）取好后传入
      const declaredFields = await runtime.theme.contentFields();
      const content = toPageContentViewModel(runtime, row, { withHtml: true, declaredFields });

      return {
        kind: 'page',
        title: row.seo_title ?? row.title,
        canonicalUrl: `/page/${row.slug}`,
        ...(row.template ? { template: row.template } : {}),
        data: {
          content,
          /*
           * 内容字段同时挂在 data 顶层：模板上下文会把 data 铺开进 `page.*`
           * （见 Core 的 buildTemplateContext），因此 `{{ page.fields.featuredImage }}`
           * 与 `{{ content.fields.featuredImage }}`（与 posts 的 `post.fields` 对齐）都能读到。
           * 复用同一个已按主题声明过滤的对象，不重复解析/过滤。
           */
          fields: content.fields,
          seoDescription: row.seo_description ?? ''
        },
        cacheTags: [`page:${row.id}`, 'pages']
      };
    }
  };

  ctx.routes.page(detail);
  runtime.logger.info('前台页面路由已注册', { routes: ['/page/:slug'] });
}
