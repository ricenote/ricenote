/**
 * feed 插件：为站点提供标准 RSS 2.0 订阅源。
 *
 * 职责边界：
 * - **不持有任何数据表**，也不写任何内容——订阅内容完全来自 `content.posts@1`
 *   提供的已发布文章；
 * - 输出是 XML，因此用 `ctx.routes.raw` 注册 `/feed.xml` 并自行控制响应头；
 * - 通过标准插槽 `head.end` 注入自动发现链接，主题被替换时该链接自动失效，
 *   不影响页面其余部分；
 * - 禁用后不留任何残留：Slot 与公开路由都由 Core 在停用时注销。
 *
 * 可选依赖：posts 被禁用时 `/feed.xml` 退化为"只有站点信息的空订阅源"，不报错。
 */

import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type ContentPostsService,
  type CoreHtmlService
} from '@ricenote/shared';
import { createFeedDiscoverySlot } from './discovery.js';
import { createFeedRoute } from './feed.js';
import type { FeedRuntimeLike, FeedSettings } from './types.js';
import { clampInt } from './util.js';

export default definePlugin({
  async start(ctx) {
    const html = ctx.services.use<CoreHtmlService>(SERVICE_CONTRACTS.CORE_HTML);
    const settings = readSettings(ctx);

    const runtime: FeedRuntimeLike = {
      siteTitle: ctx.site.title,
      siteDescription: ctx.site.description,
      siteUrl: ctx.site.url,
      language: ctx.site.language,
      settings,
      posts: () => ctx.services.tryUse<ContentPostsService>(SERVICE_CONTRACTS.CONTENT_POSTS)
    };

    if (settings.enableFeed) {
      ctx.routes.raw(createFeedRoute({ runtime, log: (message, meta) => ctx.logger.info(message, meta) }));
      ctx.slots.register('head.end', createFeedDiscoverySlot({ runtime, html }));
    }

    ctx.logger.info('feed 插件已就绪', {
      enabled: settings.enableFeed,
      itemLimit: settings.itemLimit,
      fullText: settings.fullText,
      cacheMaxAge: settings.cacheMaxAge
    });
  },

  async stop(ctx) {
    ctx.logger.info('feed 插件已停止（Slot 与公开路由已由 Core 注销）');
  }
});

/** 读取并收敛插件设置；非法值一律回退到安全默认值。 */
function readSettings(ctx: PluginContext): FeedSettings {
  return {
    enableFeed: ctx.config.get<boolean>('enableFeed', true),
    itemLimit: clampInt(ctx.config.get<unknown>('itemLimit', 20), 1, 100, 20),
    fullText: ctx.config.get<boolean>('fullText', false),
    cacheMaxAge: clampInt(ctx.config.get<unknown>('cacheMaxAge', 1800), 0, 86400, 1800)
  };
}
