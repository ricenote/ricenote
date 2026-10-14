/**
 * pages 插件注册的公开页面路由。
 *
 * 页面处理器只返回 ViewModel（kind + title + data），
 * 具体呈现交给主题；`template` 传的是**主题声明的模板键**，
 * 由 Core 渲染器解析为模板文件并在键失效时优雅回退到 `templates.page`。
 */

import type { PageRouteSpec, PluginContext } from '@ricenote/plugin-sdk';
import { normalizeSlug } from '@ricenote/shared';
import { pageUrl, readPageLookup } from './permalink.js';
import { findPublishedById, findPublishedBySlug } from './repository.js';
import { toPageContentViewModel, type PagesRuntime } from './runtime.js';

export function registerPublicPages(ctx: PluginContext, runtime: PagesRuntime): void {
  const detail: PageRouteSpec = {
    name: 'page.show',
    path: '/page/:slug',
    kind: 'page',
    // 缓存开关来自插件设置：关闭后便于调试主题
    cacheable: runtime.cacheEnabled,
    /*
     * 路径可被「固定链接」插件按站点配置接管：它只把 `/page/:slug` 换成编译后的模板，
     * 命中解析与渲染仍在这里（见 ./permalink.js）。
     */
    overridable: true,
    handler: async (request) => {
      const params = request.params as Record<string, string>;
      const lookup = readPageLookup(runtime, params);

      if (!lookup) {
        return {
          kind: '404',
          title: '页面不存在',
          status: 404,
          data: { message: '页面地址不合法' }
        };
      }

      // 模板含 `{cid}` 时按 ID 查，否则按缩略名查（与 posts 同一套约定）
      const row =
        lookup.byId !== undefined
          ? await findPublishedById(runtime.db, runtime.siteId, lookup.byId)
          : await findPublishedBySlug(
              runtime.db,
              runtime.siteId,
              normalizeSlug(lookup.bySlug ?? '', 'page')
            );

      if (!row) {
        return {
          kind: '404',
          title: '页面不存在',
          status: 404,
          data: { message: `未找到页面：${lookup.bySlug ?? lookup.byId ?? ''}` }
        };
      }

      // 内容字段声明来自当前主题；视图模型构造保持同步，因此在请求期（async）取好后传入
      const declaredFields = await runtime.theme.contentFields();
      const content = toPageContentViewModel(runtime, row, { withHtml: true, declaredFields });

      return {
        kind: 'page',
        title: row.seo_title ?? row.title,
        canonicalUrl: pageUrl(runtime, { id: row.id, slug: row.slug, request }),
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
  runtime.logger.info('前台页面路由已注册', {
    routes: ['/page/:slug'],
    permalinkOverridable: ['page.show']
  });
}
