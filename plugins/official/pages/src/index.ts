/**
 * pages 插件：独立页面。
 *
 * 职责边界：
 * - 拥有 `rn_pages` 表，提供 `content.pages@1` 契约；
 * - 注册公开页面路由 `/page/:slug`（页面类型 `page`）；
 * - 注册 `header.navigation` 插槽输出已发布页面链接 ——
 *   主题只需写 `{{ slot('header.navigation') }}`，禁用本插件后链接自动消失；
 * - 管理 API `/api/admin/pages*`（权限点 `page.view` / `page.manage`）。
 *
 * 依赖方向：Core 提供的 `core.html@1`（消毒）与 `core.theme@1`（模板清单与缓存失效）
 * 在插件启动时一定可用（Core 先于所有插件注册服务）。
 */

import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type ContentPagesService,
  type CoreHtmlService,
  type CoreSetupService,
  type CoreThemeService
} from '@ricenote/shared';
import { registerAdminRoutes } from './admin.js';
import { registerPublicPages } from './pages.js';
import type { PagesRuntime } from './runtime.js';
import { createPagesService } from './service.js';

export default definePlugin({
  async start(ctx: PluginContext) {
    const setup = ctx.services.use<CoreSetupService>(SERVICE_CONTRACTS.CORE_SETUP);
    const html = ctx.services.use<CoreHtmlService>(SERVICE_CONTRACTS.CORE_HTML);
    const theme = ctx.services.use<CoreThemeService>(SERVICE_CONTRACTS.CORE_THEME);

    const runtime: PagesRuntime = {
      db: ctx.db,
      siteId: setup.siteId(),
      navLimit: clampInt(ctx.config.get('navLimit', 20), 1, 100, 20),
      listPageSize: clampInt(ctx.config.get('listPageSize', 20), 1, 100, 20),
      cacheEnabled: resolveBool(ctx.config.get<unknown>('cacheEnabled', true)),
      html,
      theme,
      logger: ctx.logger,
      services: ctx.services
    };

    const service = createPagesService({
      runtime,
      invalidate: (tags) => theme.invalidate(tags),
      // 页面出现在全局导航插槽中，因此写入后必须整体清缓存（见 service.ts 的说明）
      clearCache: () => theme.clearCache(),
      emit: async (event, payload) => {
        await ctx.events.emit(event, payload);
      }
    });

    ctx.services.provide<ContentPagesService>({
      name: SERVICE_CONTRACTS.CONTENT_PAGES,
      version: ctx.manifest.version,
      implementation: service
    });

    registerPublicPages(ctx, runtime);
    registerAdminRoutes(ctx, { service, defaultPageSize: runtime.listPageSize });
    registerNavigationSlot(ctx, runtime, service);

    ctx.adminMenu.add({
      id: 'pages.list',
      label: '页面',
      path: '/pages',
      icon: 'FileStack',
      order: 15,
      permission: 'page.view'
    });

    /* 页面模板是否可用取决于主题声明，因此放到"全部插件启动完成"之后上报 */
    ctx.events.on('core.runtime.started.v1', () => {
      void (async () => {
        const templates = await theme.pageTemplates().catch(() => []);
        ctx.logger.info('pages 插件已就绪', {
          navLimit: runtime.navLimit,
          cacheEnabled: runtime.cacheEnabled,
          pageTemplates: templates.map((item) => item.key)
        });
        if (templates.length === 0) {
          ctx.logger.warn('当前主题未声明 pageTemplates，页面将统一使用 templates.page 模板', {
            hint: '在主题 theme.json 中声明 pageTemplates 即可让编辑者选择版式'
          });
        }
      })();
    });
  },

  async stop(ctx) {
    ctx.logger.info('pages 插件已停止（注册的路由/服务/插槽/菜单已由 Core 注销）');
  }
});

/**
 * 导航插槽：输出已发布页面链接。
 *
 * 这是"插件向主题注入展示"的第二个示例（第一个是 posts 的 `post.afterContent`）：
 * 主题无需知道 pages 插件的存在，也不需要改主题代码就能拿到页面导航。
 */
function registerNavigationSlot(
  ctx: PluginContext,
  runtime: PagesRuntime,
  service: ContentPagesService
): void {
  ctx.slots.register(
    'header.navigation',
    {
      name: 'pages.navigation',
      render: async (context) => {
        const items = await service.navItems();
        if (items.length === 0) return '';

        const currentPath = currentPathOf(context.request?.url);
        return items
          .map((item) => {
            const active = currentPath === item.url;
            const attrs = active ? ' class="rn-nav-link rn-nav-link--active" aria-current="page"' : ' class="rn-nav-link"';
            return `<a href="${runtime.html.escape(item.url)}"${attrs}>${runtime.html.escape(item.title)}</a>`;
          })
          .join('');
      }
    },
    { priority: 20 }
  );
}

/** 从请求 URL 中取出不含查询串的路径，用于判断当前导航项。 */
function currentPathOf(url: string | undefined): string {
  if (!url) return '';
  const path = url.split('#')[0]?.split('?')[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** 配置值可能是布尔或字符串（表单提交），这里统一判定。 */
function resolveBool(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}
