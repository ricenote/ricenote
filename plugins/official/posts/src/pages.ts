/**
 * posts 插件注册的公开页面路由。
 *
 * 页面处理器只返回 ViewModel（kind + title + data），
 * 具体呈现完全交给主题（ADR-002：插件提供数据、主题决定展示）。
 */

import type { PageRouteSpec, PluginContext } from '@ricenote/plugin-sdk';
import {
  buildCollection,
  loadAuthorNames,
  parsePage,
  taxonomyInternalOf,
  taxonomyOf,
  toPostViewModel,
  toPostViewModels,
  type PostsRuntime
} from './runtime.js';
import { findPublishedBySlug, listPublished, listPublishedByIds } from './repository.js';

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

function buildPagination(page: number, pageSize: number, total: number, basePath: string): Pagination {
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

export function registerPublicPages(ctx: PluginContext, runtime: PostsRuntime): void {
  const siteTitle = ctx.site.title;
  const siteDescription = ctx.site.description;
  const pageSize = runtime.pageSize;

  /* ----------------------------- 首页 ----------------------------- */
  const home: PageRouteSpec = {
    name: 'home',
    path: '/',
    kind: 'home',
    cacheable: true,
    handler: async (request) => {
      const page = parsePage(request.query.page);
      const { items, total } = await listPublished(runtime.db, runtime.siteId, { page, pageSize });
      const authorNames = await loadAuthorNames(runtime, items);
      const viewModels = await toPostViewModels(runtime, items, { withHtml: false, authorNames });

      return {
        kind: 'home',
        title: siteTitle,
        canonicalUrl: page > 1 ? `/?page=${page}` : '/',
        data: {
          siteDescription,
          posts: buildCollection(viewModels, total, page, pageSize),
          pagination: buildPagination(page, pageSize, total, '/')
        },
        cacheTags: ['home', 'posts']
      };
    }
  };

  /* ---------------------------- 文章详情 ---------------------------- */
  const postDetail: PageRouteSpec = {
    name: 'post.show',
    path: '/post/:slug',
    kind: 'post',
    cacheable: true,
    handler: async (request) => {
      const slug = request.params.slug ?? '';
      const row = await findPublishedBySlug(runtime.db, runtime.siteId, slug);

      if (!row) {
        return {
          kind: '404',
          title: '文章不存在',
          status: 404,
          data: { message: `未找到文章：${slug}` }
        };
      }

      const authorNames = await loadAuthorNames(runtime, [row]);
      const post = await toPostViewModel(runtime, row, {
        withHtml: true,
        ...(authorNames[row.author_id] ? { authorName: authorNames[row.author_id] } : {})
      });

      return {
        kind: 'post',
        title: row.seo_title ?? row.title,
        canonicalUrl: `/post/${row.slug}`,
        // 文章自选的模板键：由 Core 渲染器解析为模板文件，键失效时回退到 templates.post
        ...(row.template ? { template: row.template } : {}),
        data: {
          post,
          seoDescription: row.seo_description ?? row.excerpt
        },
        cacheTags: [`post:${row.id}`, 'home', 'posts']
      };
    }
  };

  /* ------------------------ 分类 / 标签归档 ------------------------ */
  const archiveFor = (
    name: string,
    path: string,
    termType: 'category' | 'tag'
  ): PageRouteSpec => ({
    name,
    path,
    kind: 'archive',
    cacheable: true,
    handler: async (request) => {
      const slug = request.params.slug ?? '';
      const page = parsePage(request.query.page);
      const taxonomy = taxonomyOf(runtime);
      const taxonomyInternal = taxonomyInternalOf(runtime);

      if (!taxonomy || !taxonomyInternal) {
        return {
          kind: 'archive',
          title: termType === 'category' ? '分类' : '标签',
          data: {
            term: { name: slug, slug, type: termType },
            posts: buildCollection([], 0, page, pageSize),
            pagination: buildPagination(page, pageSize, 0, path.replace(':slug', slug)),
            unavailable: true
          }
        };
      }

      const term = await taxonomy.findBySlug(slug);
      if (!term || term.type !== termType) {
        return {
          kind: '404',
          title: '归档不存在',
          status: 404,
          data: { message: `未找到${termType === 'category' ? '分类' : '标签'}：${slug}` }
        };
      }

      const postIds = await taxonomyInternal.postIdsOfTerm(slug);
      const { items, total } = await listPublishedByIds(runtime.db, runtime.siteId, postIds, {
        page,
        pageSize
      });
      const authorNames = await loadAuthorNames(runtime, items);
      const viewModels = await toPostViewModels(runtime, items, { withHtml: false, authorNames });
      const canonical = `/post/${slug}`;

      return {
        kind: 'archive',
        title: `${term.name} · ${siteTitle}`,
        canonicalUrl: canonical,
        data: {
          term: { id: term.id, name: term.name, slug: term.slug, type: term.type },
          posts: buildCollection(viewModels, total, page, pageSize),
          pagination: buildPagination(page, pageSize, total, path.replace(':slug', slug))
        },
        cacheTags: [`term:${term.id}`, 'posts']
      };
    }
  });

  /*
   * 搜索页面不在本插件注册。
   *
   * `/search` 路由名与路径由 `rice.search` 插件提供（它负责跨内容类型聚合），
   * posts 只通过 `content.search@1` 注册自身的可搜索数据源。
   * 这样 search 插件可以被独立启停，posts 无需感知。
   */

  ctx.routes.page(home);
  ctx.routes.page(postDetail);
  ctx.routes.page(archiveFor('term.category', '/category/:slug', 'category'));
  ctx.routes.page(archiveFor('term.tag', '/tag/:slug', 'tag'));

  runtime.logger.info('前台页面路由已注册', {
    routes: ['/', '/post/:slug', '/category/:slug', '/tag/:slug']
  });
}
