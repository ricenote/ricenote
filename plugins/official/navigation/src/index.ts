/**
 * navigation 插件：顶部导航栏。
 *
 * 职责边界：
 * - 拥有 `rn_nav_items` 表，提供 `content.navigation@1` 契约；
 * - 注册 `header.navigation` 插槽输出导航链接 —— 主题只需写
 *   `{{ slot('header.navigation') }}`，禁用本插件后导航栏自动为空；
 * - 管理 API `/api/admin/navigation*`（权限点 `nav.view` / `nav.manage`）
 *   与后台菜单「导航栏」。
 *
 * 与 content 插件的关系：本插件**不复制**任何内容，只引用 ID。
 * 页面与文章仍由各自插件负责（`content.pages@1` / `content.posts@1`），
 * 因此"页面是否出现在导航栏"由本插件决定，而不是页面插件自行往插槽里塞链接。
 *
 * 依赖方向：Core 的 `core.html@1`（转义）、`core.theme@1`（缓存失效）与
 * `core.setup@1`（站点标识）在 `start()` 中一次性取用；pages / posts 是**可选**依赖，
 * 在请求期惰性解析（见 runtime.ts 的说明）。
 */

import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type ContentNavigationService,
  type CoreHtmlService,
  type CoreSetupService,
  type CoreThemeService
} from '@ricenote/shared';
import { registerAdminRoutes } from './admin.js';
import { referencesContent } from './repository.js';
import type { NavigationRuntime } from './runtime.js';
import { createNavigationService } from './service.js';
import { registerNavigationSlot } from './slot.js';

/**
 * 需要"内容变化 → 失效导航缓存"的事件。
 *
 * 导航插槽出现在**每个页面**上，而 HTML 缓存是按页面存的，
 * 因此被引用的内容一变，所有缓存页面都可能变旧。
 * 但只有**被引用**的内容才需要清缓存（见 `referencesContent`），
 * 否则每次保存文章都会清空全站缓存。
 */
const CONTENT_EVENTS: ReadonlyArray<{
  event: string;
  type: 'page' | 'post';
  idField: string;
}> = [
  { event: 'content.pages.changed.v1', type: 'page', idField: 'pageId' },
  { event: 'content.pages.deleted.v1', type: 'page', idField: 'pageId' },
  { event: 'content.post.published.v1', type: 'post', idField: 'postId' },
  { event: 'content.post.updated.v1', type: 'post', idField: 'postId' },
  { event: 'content.post.unpublished.v1', type: 'post', idField: 'postId' },
  { event: 'content.post.deleted.v1', type: 'post', idField: 'postId' }
];

export default definePlugin({
  async start(ctx: PluginContext) {
    const setup = ctx.services.use<CoreSetupService>(SERVICE_CONTRACTS.CORE_SETUP);
    const html = ctx.services.use<CoreHtmlService>(SERVICE_CONTRACTS.CORE_HTML);
    const theme = ctx.services.use<CoreThemeService>(SERVICE_CONTRACTS.CORE_THEME);
    const siteId = setup.siteId();

    const runtime: NavigationRuntime = {
      db: ctx.db,
      siteId,
      maxItems: clampInt(ctx.config.get('maxItems', 10), 1, 50, 10),
      html,
      theme,
      logger: ctx.logger,
      services: ctx.services
    };

    const service = createNavigationService({
      runtime,
      // 导航出现在全局插槽里，任何顺序/内容变化都必须整体清缓存
      clearCache: () => theme.clearCache(),
      log: (message, meta) => ctx.logger.info(message, meta)
    });

    ctx.services.provide<ContentNavigationService>({
      name: SERVICE_CONTRACTS.CONTENT_NAVIGATION,
      version: ctx.manifest.version,
      implementation: service
    });

    registerNavigationSlot(ctx, runtime, service);
    registerAdminRoutes(ctx, { service });

    /*
     * 后台菜单与界面来自 manifest.admin.pages（声明式）：
     * Core 负责注册菜单、托管 `admin/main.js` 并计算前端入口 URL，
     * 因此这里不再调用 ctx.adminMenu.add，也不需要 admin:menu 能力。
     */

    /* 内容变化：仅在"该内容确实被导航引用"时清缓存 */
    for (const spec of CONTENT_EVENTS) {
      ctx.events.on(spec.event, (payload) => {
        const refId = readId(payload, spec.idField);
        if (refId === undefined) return;

        void (async () => {
          try {
            if (!(await referencesContent(ctx.db, siteId, spec.type, refId))) return;
            theme.clearCache();
            ctx.logger.info('导航引用的内容已变化，已清空 HTML 缓存', {
              type: spec.type,
              refId,
              event: spec.event
            });
          } catch (error) {
            // 缓存失效失败不应影响内容写入方，但要留下痕迹
            ctx.logger.warn('导航相关的缓存失效失败', {
              type: spec.type,
              refId,
              event: spec.event,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        })();
      });
    }

    /* 依赖可用性在"全部插件启动完成"之后上报，日志才反映真实状态 */
    ctx.events.on('core.runtime.started.v1', () => {
      void (async () => {
        const items = await service.listForAdmin().catch(() => []);
        const renderable = items.filter((item) => item.enabled && item.href !== null);

        ctx.logger.info('navigation 插件已就绪', {
          items: items.length,
          renderable: renderable.length,
          maxItems: runtime.maxItems,
          pages: ctx.services.has(SERVICE_CONTRACTS.CONTENT_PAGES),
          posts: ctx.services.has(SERVICE_CONTRACTS.CONTENT_POSTS)
        });

        const broken = items.filter(
          (item) => item.enabled && item.type !== 'custom' && item.target?.published !== true
        );
        if (broken.length > 0) {
          ctx.logger.warn('存在无法展示的导航项（目标未发布或已删除）', {
            navItemIds: broken.map((item) => item.id),
            hint: '在后台「导航栏」中重新选择目标，或将其停用'
          });
        }
      })();
    });
  },

  async stop(ctx) {
    ctx.logger.info('navigation 插件已停止（注册的路由/服务/插槽/菜单已由 Core 注销）');
  }
});

/** 从事件载荷中取正整数 ID（事件载荷是 unknown，必须自证类型）。 */
function readId(payload: unknown, field: string): number | undefined {
  const value = (payload as Record<string, unknown> | undefined)?.[field];
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
