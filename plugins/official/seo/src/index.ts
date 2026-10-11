/**
 * seo 插件：社交分享卡片、结构化数据、站点地图与爬虫协议。
 *
 * 职责边界：
 * - **不持有任何数据表**，也不写任何内容——完全基于其他插件提供的公开数据
 *   （`content.posts@1`）与页面 ViewModel 工作；
 * - 注入点是标准 Slot `head.end`，主题被禁用/替换时自动失效，不影响页面；
 * - 无站点的 slug/sitemap 状态存储，因此禁用后不留下任何残留。
 *
 * 可选依赖：`content.posts@1` 仅用于生成站点地图；
 * posts 被禁用时 `/sitemap.xml` 退化为"只收录首页"，其余功能不受影响。
 */

import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type ContentPostsService,
  type CoreHtmlService,
  type CoreThemeService
} from '@ricenote/shared';
import { createSeoMetaSlot } from './meta.js';
import { createRobotsRoute, createSitemapRoute, type SitemapDeps } from './sitemap.js';
import type { SeoSettings, SeoRuntimeLike } from './types.js';

export default definePlugin({
  async start(ctx) {
    const html = ctx.services.use<CoreHtmlService>(SERVICE_CONTRACTS.CORE_HTML);
    // core.theme@1 用于在内容变化时失效 HTML 缓存（meta 会随文章更新而变化）
    const theme = ctx.services.use<CoreThemeService>(SERVICE_CONTRACTS.CORE_THEME);
    const settings = readSettings(ctx);

    const runtime: SeoRuntimeLike = {
      siteId: ctx.site.id,
      siteTitle: ctx.site.title,
      siteDescription: ctx.site.description,
      siteUrl: ctx.site.url,
      language: ctx.site.language,
      logger: ctx.logger,
      settings,
      posts: () => ctx.services.tryUse<ContentPostsService>(SERVICE_CONTRACTS.CONTENT_POSTS)
    };

    ctx.slots.register('head.end', createSeoMetaSlot({ runtime, html, theme }));

    const sitemapDeps: SitemapDeps = {
      settings,
      siteUrl: runtime.siteUrl,
      posts: runtime.posts,
      log: (message, meta) => ctx.logger.info(message, meta)
    };

    if (settings.enableSitemap) {
      ctx.routes.raw(createSitemapRoute(sitemapDeps));
    }
    if (settings.enableRobots) {
      ctx.routes.raw(createRobotsRoute(sitemapDeps));
    }

    ctx.logger.info('seo 插件已就绪', {
      openGraph: settings.enableOpenGraph,
      twitterCard: settings.enableTwitterCard,
      jsonLd: settings.enableJsonLd,
      sitemap: settings.enableSitemap,
      robots: settings.enableRobots,
      sitemapMaxUrls: settings.sitemapMaxUrls
    });
  },

  async stop(ctx) {
    ctx.logger.info('seo 插件已停止（Slot 与公开路由已由 Core 注销）');
  }
});

/** 读取并收敛插件设置；非法值一律回退到安全默认值。 */
function readSettings(ctx: PluginContext): SeoSettings {
  const disallow = ctx.config.get<unknown>('robotsDisallow', ['/admin', '/api']);

  return {
    enableOpenGraph: ctx.config.get<boolean>('enableOpenGraph', true),
    enableTwitterCard: ctx.config.get<boolean>('enableTwitterCard', true),
    twitterSite: normalizeText(ctx.config.get<unknown>('twitterSite', ''), 64),
    enableJsonLd: ctx.config.get<boolean>('enableJsonLd', true),
    defaultOgImage: normalizeText(ctx.config.get<unknown>('defaultOgImage', ''), 300),
    enableSitemap: ctx.config.get<boolean>('enableSitemap', true),
    enableRobots: ctx.config.get<boolean>('enableRobots', true),
    sitemapMaxUrls: clampInt(ctx.config.get<unknown>('sitemapMaxUrls', 1000), 1, 50000, 1000),
    sitemapPageSize: clampInt(ctx.config.get<unknown>('sitemapPageSize', 50), 1, 100, 50),
    robotsDisallow: Array.isArray(disallow)
      ? disallow
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .slice(0, 20)
      : []
  };
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
