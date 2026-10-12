/**
 * pages 插件：独立页面。
 *
 * 职责边界：
 * - 拥有 `rn_pages` 表，提供 `content.pages@1` 契约；
 * - 注册公开页面路由 `/page/:slug`（页面类型 `page`）；
 * - 管理 API `/api/admin/pages*`（权限点 `page.view` / `page.manage`）。
 *
 * **不负责顶部导航栏**：页面只是"可作为导航项的一种来源"，
 * 是否出现在导航栏、排在第几位、显示什么文案由 `rice.navigation` 决定
 * （后者注册 `header.navigation` 插槽）。本插件只通过 `navItems()` 暴露
 * "有哪些已发布页面"，避免出现两个插件同时往同一个插槽写链接。
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
import { createPagesService, renderPreviewHtml } from './service.js';

export default definePlugin({
  async start(ctx: PluginContext) {
    const setup = ctx.services.use<CoreSetupService>(SERVICE_CONTRACTS.CORE_SETUP);
    const html = ctx.services.use<CoreHtmlService>(SERVICE_CONTRACTS.CORE_HTML);
    const theme = ctx.services.use<CoreThemeService>(SERVICE_CONTRACTS.CORE_THEME);

    const runtime: PagesRuntime = {
      db: ctx.db,
      siteId: setup.siteId(),
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
      /*
       * 页面写入后整体清缓存。
       *
       * 页面标题/别名会被导航栏引用（`rice.navigation` 的导航项解析目标标题），
       * 而导航插槽出现在**每个页面**上，按标签精确失效覆盖不到，
       * 因此这里保守地整体清空（写操作本就低频）。
       */
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
    registerAdminRoutes(ctx, {
      service,
      defaultPageSize: runtime.listPageSize,
      // 预览与保存共用同一条渲染 + 消毒管线（见 service.renderPreviewHtml）
      preview: (content) => renderPreviewHtml(runtime, content)
    });

    /*
     * 后台菜单与界面来自 manifest.admin.pages（声明式）：
     * Core 注册菜单、托管 ./admin/main.js 并计算前端入口 URL，插件无需注册代码。
     */

    /* 页面模板是否可用取决于主题声明，因此放到"全部插件启动完成"之后上报 */
    ctx.events.on('core.runtime.started.v1', () => {
      void (async () => {
        const templates = await theme.pageTemplates().catch(() => []);
        ctx.logger.info('pages 插件已就绪', {
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
