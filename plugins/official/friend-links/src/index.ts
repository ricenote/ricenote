/**
 * friend-links 插件：友情链接管理与前台展示页。
 *
 * 职责边界：
 * - 拥有 `rn_friend_links` 表，管理 API `/api/admin/friend-links*`
 *   （权限点 `link.view` / `link.manage`）与后台菜单「友情链接」；
 * - 注册前台页面 `/links`，把友链列表放进 `data.friendLinks` 交给主题渲染 ——
 *   这是本插件**唯一**的主题接口（主题读不到服务契约，页面 `data` 才是取数通道）；
 * - **不提供任何跨插件服务契约**：友链不属于其他插件需要编程消费的数据。
 *
 * 依赖方向：Core 的 `core.setup@1`（站点标识）与 `core.theme@1`（缓存失效）
 * 在 `start()` 中一次性取用，没有可选依赖。
 *
 * **不订阅任何事件**：本插件的能力面刻意保持最小（数据库 + 两个 Core 服务 + 两类路由），
 * 一条启动统计日志不值得多换一个 `events:subscribe`。
 */

import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type CoreSetupService,
  type CoreThemeService
} from '@ricenote/shared';
import { registerAdminRoutes } from './admin.js';
import { LINKS_PAGE_PATH, registerLinksPage } from './page.js';
import { createFriendLinksService } from './service.js';
import type { FriendLinksRuntime } from './types.js';

export default definePlugin({
  async start(ctx: PluginContext) {
    const setup = ctx.services.use<CoreSetupService>(SERVICE_CONTRACTS.CORE_SETUP);
    const theme = ctx.services.use<CoreThemeService>(SERVICE_CONTRACTS.CORE_THEME);

    const runtime: FriendLinksRuntime = {
      db: ctx.db,
      siteId: setup.siteId(),
      theme,
      logger: ctx.logger
    };

    const service = createFriendLinksService({
      runtime,
      log: (message, meta) => ctx.logger.info(message, meta)
    });

    registerLinksPage(ctx, { service });
    registerAdminRoutes(ctx, { service });

    /*
     * 后台菜单与界面来自 manifest.admin.pages（声明式）：
     * Core 负责注册菜单、托管 `admin/main.js` 并计算前端入口 URL，
     * 因此这里不再调用 ctx.adminMenu.add，也不需要 admin:menu 能力。
     */

    /*
     * 启动统计直接在 `start()` 里记，**不订阅 `core.runtime.started.v1`**：
     * 订阅事件需要 `events:subscribe` 能力，而这条日志并不依赖别的插件就绪 ——
     * 迁移早于 `start()` 完成，这里读到的就是真实数据。
     */
    try {
      const items = await service.listForAdmin();
      ctx.logger.info('friend-links 插件已就绪', {
        links: items.length,
        enabled: items.filter((item) => item.enabled).length,
        page: LINKS_PAGE_PATH
      });
    } catch (error) {
      ctx.logger.warn('友链统计失败', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  },

  async stop(ctx) {
    ctx.logger.info('friend-links 插件已停止（注册的路由/菜单已由 Core 注销）');
  }
});
