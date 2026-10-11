/**
 * `/search` 页面路由。
 *
 * 关键约束：路由名必须保持 `search`、kind 必须保持 `search`，
 * 且数据字段保持 `keyword / posts / pagination` —— 主题中的
 * `search.njk` 与 `url('search')` 依赖这些约定，因此换用本插件后
 * **两套主题无需任何改动**。
 *
 * 额外提供 `results`（带 type / sourceLabel 的原始命中）与 `sources`
 * （已注册数据源清单），供主题做更丰富的结果分组展示。
 */

import type { PageRouteSpec } from '@ricenote/plugin-sdk';
import type { SearchHit } from '@ricenote/shared';
import type { SearchSourceRegistry } from './registry.js';

export interface SearchPageDeps {
  registry: SearchSourceRegistry;
  siteTitle: string;
  /** 每页结果数。 */
  pageSize: number;
  /** 关键词最大长度（防止超长关键词带来的无谓匹配）。 */
  maxKeywordLength: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevUrl?: string;
  nextUrl?: string;
}

interface Collection<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function createSearchPage(deps: SearchPageDeps): PageRouteSpec {
  return {
    name: 'search',
    path: '/search',
    kind: 'search',
    // 搜索结果随内容变化且带查询参数，不参与 HTML 缓存
    cacheable: false,

    handler: async (request) => {
      const raw = request.query.q ?? request.query.keyword;
      const keyword = String(Array.isArray(raw) ? raw[0] : (raw ?? ''))
        .trim()
        .slice(0, deps.maxKeywordLength);
      const page = parsePage(request.query.page);
      const pageSize = deps.pageSize;

      const sources = deps.registry.list();
      const unavailable = !deps.registry.hasSources();

      if (keyword.length === 0) {
        return {
          kind: 'search',
          title: `搜索 · ${deps.siteTitle}`,
          data: {
            keyword: '',
            posts: collection<CardItem>([], 0, page, pageSize),
            results: collection<SearchHit>([], 0, page, pageSize),
            pagination: pagination(page, pageSize, 0, '/search'),
            sources,
            unavailable,
            empty: true
          }
        };
      }

      const { items, total } = await deps.registry.search({ keyword, page, pageSize });

      return {
        kind: 'search',
        title: `搜索「${keyword}」 · ${deps.siteTitle}`,
        canonicalUrl: `/search?q=${encodeURIComponent(keyword)}`,
        data: {
          keyword,
          // 兼容既有主题的卡片模板：把命中结果映射为与文章卡片同构的结构
          posts: collection(items.map(toCard), total, page, pageSize),
          results: collection(items, total, page, pageSize),
          pagination: pagination(page, pageSize, total, `/search?q=${encodeURIComponent(keyword)}`),
          sources,
          unavailable
        }
      };
    }
  };
}

/* ------------------------------ 内部工具 ------------------------------ */

/** 与主题 `partials/post-card.njk` 兼容的最小卡片结构。 */
interface CardItem {
  title: string;
  slug: string;
  url: string;
  excerpt: string;
  publishedAt?: string;
  authorName?: string;
  coverUrl?: string;
  terms: { id: number; name: string; slug: string; type: string }[];
}

function toCard(hit: SearchHit): CardItem {
  const segments = hit.url.split('/').filter((segment) => segment.length > 0);

  return {
    title: hit.title,
    // 卡片模板使用 url 跳转；slug 仅作为附带信息（来自形如 /post/<slug> 的路径）
    slug: segments[segments.length - 1] ?? hit.id,
    url: hit.url,
    excerpt: hit.excerpt,
    ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
    ...(hit.authorName ? { authorName: hit.authorName } : {}),
    ...(hit.coverUrl ? { coverUrl: hit.coverUrl } : {}),
    terms: hit.terms ?? []
  };
}

function collection<T>(items: T[], total: number, page: number, pageSize: number): Collection<T> {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return { items, total, page, pageSize, totalPages };
}

function pagination(
  page: number,
  pageSize: number,
  total: number,
  basePath: string
): Pagination {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const link = (target: number): string => {
    const separator = basePath.includes('?') ? '&' : '?';
    return target <= 1 ? basePath : `${basePath}${separator}page=${target}`;
  };

  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPrev,
    hasNext,
    ...(hasPrev ? { prevUrl: link(page - 1) } : {}),
    ...(hasNext ? { nextUrl: link(page + 1) } : {})
  };
}

function parsePage(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 1000);
}
