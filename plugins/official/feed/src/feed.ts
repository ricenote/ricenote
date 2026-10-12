/**
 * `GET /feed.xml`：标准 RSS 2.0 订阅源。
 *
 * 只取**已发布**文章（`listPublished`），草稿与归档不会出现在订阅里；
 * 输出是 XML 而非 HTML，因此走 `ctx.routes.raw` 自注册，
 * 由本插件自行控制 `content-type` 与 `cache-control`
 * （原始路由不经过主题渲染与 HTML 缓存）。
 */

import type { RawRouteSpec } from '@ricenote/plugin-sdk';
import { absoluteUrl, type ContentPostsService, type PostSummary } from '@ricenote/shared';
import type { FeedRuntimeLike } from './types.js';
import { clip, escapeXml, formatRfc822 } from './util.js';

/** 摘要截断长度：单条过长会把订阅源撑得很大，部分阅读器会截断解析。 */
const EXCERPT_MAX_LENGTH = 500;

export interface FeedDeps {
  runtime: FeedRuntimeLike;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

interface FeedItem {
  title: string;
  link: string;
  pubDate?: string;
  /** 已转义前的原文：摘要（纯文本）或正文（已消毒的 HTML 片段）。 */
  description: string;
  categories: string[];
}

export function createFeedRoute(deps: FeedDeps): RawRouteSpec {
  return {
    method: 'GET',
    path: '/feed.xml',
    handler: async (_request, reply) => {
      const { runtime } = deps;
      const items = await collectItems(deps);

      reply.statusCode = 200;
      reply
        .header('content-type', 'application/rss+xml; charset=utf-8')
        .header('cache-control', cacheControlOf(runtime.settings.cacheMaxAge));
      reply.send(renderChannel(runtime, items));
    }
  };
}

/** 采集订阅条目；posts 不可用时返回空列表（降级而非报错）。 */
async function collectItems(deps: FeedDeps): Promise<FeedItem[]> {
  const { runtime } = deps;
  const { settings, siteUrl } = runtime;

  const posts = runtime.posts();
  if (!posts) {
    deps.log('posts 插件未启用，订阅源降级为不含文章的列表');
    return [];
  }

  const { items } = await posts.listPublished({ page: 1, pageSize: settings.itemLimit });

  const output: FeedItem[] = [];
  for (const post of items.slice(0, settings.itemLimit)) {
    const link = absoluteUrl(siteUrl, `/post/${post.slug}`);
    const pubDate = formatRfc822(post.publishedAt ?? post.updatedAt ?? post.createdAt);

    output.push({
      title: post.title,
      link,
      ...(pubDate ? { pubDate } : {}),
      description: await descriptionOf(posts, post, settings.fullText),
      categories: post.terms.map((term) => term.name)
    });
  }

  return output;
}

/**
 * 条目正文：开启全文时取该文章的渲染结果，否则用摘要。
 *
 * 全文模式会对每条文章多查一次库，因此条数受 `itemLimit`（上限 100）约束。
 */
async function descriptionOf(
  posts: ContentPostsService,
  post: PostSummary,
  fullText: boolean
): Promise<string> {
  if (fullText) {
    const detail = await posts.findPublishedById(post.id);
    if (detail?.html) return detail.html;
  }
  return clip(post.excerpt ?? '', EXCERPT_MAX_LENGTH);
}

function renderChannel(runtime: FeedRuntimeLike, items: FeedItem[]): string {
  const selfUrl = absoluteUrl(runtime.siteUrl, '/feed.xml');
  const lastBuildDate = formatRfc822(new Date()) ?? '';
  const body = items.map(renderItem).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(runtime.siteTitle)}</title>
<link>${escapeXml(absoluteUrl(runtime.siteUrl, '/'))}</link>
<description>${escapeXml(runtime.siteDescription)}</description>
<language>${escapeXml(runtime.language)}</language>
<lastBuildDate>${lastBuildDate}</lastBuildDate>
<atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>
${body}
</channel>
</rss>
`;
}

function renderItem(item: FeedItem): string {
  const lines = [
    '  <item>',
    `    <title>${escapeXml(item.title)}</title>`,
    `    <link>${escapeXml(item.link)}</link>`,
    `    <guid isPermaLink="true">${escapeXml(item.link)}</guid>`
  ];

  if (item.pubDate) lines.push(`    <pubDate>${escapeXml(item.pubDate)}</pubDate>`);
  for (const category of item.categories) {
    lines.push(`    <category>${escapeXml(category)}</category>`);
  }
  lines.push(`    <description>${escapeXml(item.description)}</description>`, '  </item>');

  return lines.join('\n');
}

/** 缓存时间 ≤ 0 时明确禁用缓存，避免读者端长期拿到旧内容。 */
function cacheControlOf(maxAge: number): string {
  return maxAge > 0 ? `public, max-age=${maxAge}` : 'no-cache';
}
