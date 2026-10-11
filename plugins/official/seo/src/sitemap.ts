/**
 * 站点地图与爬虫协议。
 *
 * 两者都是**公开路由**，由主题无关的纯文本/XML 响应构成：
 * - `GET /sitemap.xml`：首页 + 全部已发布文章（经 `content.posts@1` 契约获取）；
 * - `GET /robots.txt`：放行全站、屏蔽管理端与 API，并声明 sitemap 地址。
 *
 * 说明：这里只收录文章。分类/标签归档页与搜索页不收录——
 * 前者价值有限，后者本身已是 `noindex`。
 */

import type { RawRouteSpec } from '@ricenote/plugin-sdk';
import { absoluteUrl, type ContentPostsService } from '@ricenote/shared';
import type { SeoSettings } from './types.js';
import { escapeXml } from './util.js';

export interface SitemapDeps {
  settings: SeoSettings;
  siteUrl: string;
  posts(): ContentPostsService | undefined;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

/** 采集待收录 URL。 */
async function collectEntries(deps: SitemapDeps): Promise<{ entries: SitemapEntry[]; truncated: boolean }> {
  const { settings, siteUrl } = deps;
  const entries: SitemapEntry[] = [{ loc: absoluteUrl(siteUrl, '/') }];

  const posts = deps.posts();
  if (!posts) return { entries, truncated: false };

  const pageSize = Math.max(1, settings.sitemapPageSize);
  let truncated = false;

  for (let page = 1; entries.length < settings.sitemapMaxUrls; page += 1) {
    const { items, total } = await posts.listPublished({ page, pageSize });

    for (const post of items) {
      if (entries.length >= settings.sitemapMaxUrls) {
        truncated = true;
        break;
      }
      entries.push({
        // PostSummary 不携带 url，按前台约定路径拼接
        loc: absoluteUrl(siteUrl, `/post/${post.slug}`),
        ...(post.updatedAt ? { lastmod: post.updatedAt } : {})
      });
    }

    if (truncated || items.length === 0 || page * pageSize >= total) break;
  }

  return { entries, truncated };
}

export function createSitemapRoute(deps: SitemapDeps): RawRouteSpec {
  return {
    method: 'GET',
    path: '/sitemap.xml',
    handler: async (_request, reply) => {
      const { entries, truncated } = await collectEntries(deps);
      if (truncated) {
        deps.log('站点地图达到收录上限，已截断', {
          limit: deps.settings.sitemapMaxUrls,
          included: entries.length
        });
      }

      const body = entries
        .map((entry) => {
          const lastmod = entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '';
          return `  <url><loc>${escapeXml(entry.loc)}</loc>${lastmod}</url>`;
        })
        .join('\n');

      reply.statusCode = 200;
      reply
        .header('content-type', 'application/xml; charset=utf-8')
        .header('cache-control', 'public, max-age=1800');
      reply.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`);
    }
  };
}

export function createRobotsRoute(deps: SitemapDeps): RawRouteSpec {
  return {
    method: 'GET',
    path: '/robots.txt',
    handler: async (_request, reply) => {
      const lines = ['User-agent: *', 'Allow: /'];

      for (const prefix of deps.settings.robotsDisallow) {
        const value = prefix.trim();
        if (value.length > 0) lines.push(`Disallow: ${value}`);
      }

      if (deps.settings.enableSitemap) {
        lines.push(`Sitemap: ${absoluteUrl(deps.siteUrl, '/sitemap.xml')}`);
      }

      reply.statusCode = 200;
      reply.header('content-type', 'text/plain; charset=utf-8').header('cache-control', 'public, max-age=1800');
      reply.send(`${lines.join('\n')}\n`);
    }
  };
}
