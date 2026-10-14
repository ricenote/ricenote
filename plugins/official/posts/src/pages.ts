/**
 * posts 插件注册的公开页面路由。
 *
 * 页面处理器只返回 ViewModel（kind + title + data），
 * 具体呈现完全交给主题（ADR-002：插件提供数据、主题决定展示）。
 */

import type { PageRouteSpec, PluginContext } from '@ricenote/plugin-sdk';
import type { TaxonomyService, TermSummary } from '@ricenote/shared';
import {
  buildCollection,
  loadAuthorNames,
  loadContentFields,
  loadTerms,
  parsePage,
  taxonomyInternalOf,
  taxonomyOf,
  toPostViewModel,
  toPostViewModels,
  type PostsRuntime
} from './runtime.js';
import {
  findPublishedById,
  findPublishedBySlug,
  listPublished,
  listPublishedByIds
} from './repository.js';
import {
  categoriesOf,
  categoryUrl,
  categoryUrlBySlug,
  matchesPostLookup,
  postUrl,
  readCategoryLookup,
  readPostLookup,
  tagUrl
} from './permalink.js';

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
      // 内容自定义字段声明在请求期读取（不缓存），随主题切换即时生效
      const viewModels = await toPostViewModels(runtime, items, {
        withHtml: false,
        authorNames,
        request,
        fields: await loadContentFields(runtime)
      });

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
    /*
     * 路径可被「固定链接」插件按站点配置接管：它只把 `/post/:slug` 换成编译后的模板，
     * 命中解析与渲染仍在这里（见 ./permalink.js）。
     */
    overridable: true,
    handler: async (request) => {
      const params = request.params as Record<string, string>;
      const lookup = readPostLookup(runtime, params);

      if (!lookup) {
        return {
          kind: '404',
          title: '文章不存在',
          status: 404,
          data: { message: '文章地址不合法' }
        };
      }

      const row =
        lookup.byId !== undefined
          ? await findPublishedById(runtime.db, runtime.siteId, lookup.byId)
          : await findPublishedBySlug(runtime.db, runtime.siteId, lookup.bySlug ?? '');

      // 词条同时用于"主分类"与视图模型，读一次即可（详情页本来就要读）
      const terms = row ? await loadTerms(runtime, row.id) : [];
      const categories = categoriesOf(terms);

      // 地址里带的年/月/日或分类必须与内容一致，否则那是"另一个地址"→ 404
      if (!row || !matchesPostLookup(lookup, row, categories)) {
        return {
          kind: '404',
          title: '文章不存在',
          status: 404,
          data: { message: `未找到文章：${lookup.bySlug ?? lookup.byId ?? ''}` }
        };
      }

      const authorNames = await loadAuthorNames(runtime, [row]);
      const post = await toPostViewModel(runtime, row, {
        withHtml: true,
        terms,
        request,
        fields: await loadContentFields(runtime),
        ...(authorNames[row.author_id] ? { authorName: authorNames[row.author_id] } : {})
      });

      return {
        kind: 'post',
        title: row.seo_title ?? row.title,
        canonicalUrl: postUrl(
          runtime,
          {
            id: row.id,
            slug: row.slug,
            publishedAt: row.published_at,
            createdAt: row.created_at,
            categories
          },
          { request }
        ),
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
    // 分类归档的路径可被「固定链接」插件接管；标签不纳入本次方案，保持内建形式
    ...(termType === 'category' ? { overridable: true } : {}),
    handler: async (request) => {
      const params = request.params as Record<string, string>;
      const slug = params.slug ?? '';
      const page = parsePage(request.query.page);
      const taxonomy = taxonomyOf(runtime);
      const taxonomyInternal = taxonomyInternalOf(runtime);
      const typeLabel = termType === 'category' ? '分类' : '标签';

      if (!taxonomy || !taxonomyInternal) {
        const fallbackBase =
          termType === 'category' ? categoryUrlBySlug(runtime, slug) : tagUrl({ slug });
        return {
          kind: 'archive',
          title: typeLabel,
          data: {
            term: { name: slug, slug, type: termType },
            posts: buildCollection([], 0, page, pageSize),
            pagination: buildPagination(page, pageSize, 0, fallbackBase),
            unavailable: true
          }
        };
      }

      // 模板含 `{mid}` 时按分类 ID 命中，否则按缩略名
      const term =
        termType === 'category'
          ? await findCategoryByLookup(taxonomy, readCategoryLookup(runtime, params))
          : await taxonomy.findBySlug(slug);

      if (!term || term.type !== termType) {
        return {
          kind: '404',
          title: '归档不存在',
          status: 404,
          data: { message: `未找到${typeLabel}：${slug}` }
        };
      }

      // 归档自身的地址：由固定链接方案生成（此前 canonical 写死成详情页的
      // `/post/:slug`，导致分类页的规范地址一直指向错误的位置）
      const basePath =
        termType === 'category'
          ? categoryUrl(runtime, { id: term.id, slug: term.slug }, { request })
          : tagUrl({ slug: term.slug });

      const postIds = await taxonomyInternal.postIdsOfTerm(term.slug);
      const { items, total } = await listPublishedByIds(runtime.db, runtime.siteId, postIds, {
        page,
        pageSize
      });
      const authorNames = await loadAuthorNames(runtime, items);
      const viewModels = await toPostViewModels(runtime, items, {
        withHtml: false,
        authorNames,
        request,
        fields: await loadContentFields(runtime)
      });

      return {
        kind: 'archive',
        title: `${term.name} · ${siteTitle}`,
        canonicalUrl: basePath,
        data: {
          term: { id: term.id, name: term.name, slug: term.slug, type: term.type },
          posts: buildCollection(viewModels, total, page, pageSize),
          pagination: buildPagination(page, pageSize, total, basePath)
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
    routes: ['/', '/post/:slug', '/category/:slug', '/tag/:slug'],
    permalinkOverridable: ['post.show', 'term.category']
  });
}

/** 按模板还原出的查询条件读词条（`{mid}` 走 ID，否则走缩略名）。 */
async function findCategoryByLookup(
  taxonomy: TaxonomyService,
  lookup: { byId?: number; bySlug?: string } | undefined
): Promise<TermSummary | undefined> {
  if (!lookup) return undefined;
  if (lookup.byId !== undefined) return taxonomy.findById(lookup.byId);
  return taxonomy.findBySlug(lookup.bySlug ?? '');
}
