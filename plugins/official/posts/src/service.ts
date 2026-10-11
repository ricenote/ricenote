/**
 * `content.posts@1` 服务实现。
 *
 * 这是 posts 插件对外（以及其他插件、Core 后台）暴露的唯一数据入口，
 * 页面路由与管理 API 都复用这里，保证业务规则只有一份。
 */

import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  normalizeSlug,
  resolveContentTemplateKey,
  slugify,
  type ContentPostsService,
  type CoreThemeService,
  type PostDetail,
  type PostListQuery,
  type PostSaveRequest,
  type PostStatus,
  type PostSummary
} from '@ricenote/shared';
import { markdownToPlainText, renderMarkdown } from './markdown.js';
import * as repo from './repository.js';
import { loadAuthorNames, loadTerms, taxonomyInternalOf, type PostsRuntime } from './runtime.js';

const VALID_STATUS: PostStatus[] = ['draft', 'published', 'archived'];
const MAX_TITLE_LENGTH = 255;
const MAX_CONTENT_LENGTH = 500_000;

export interface PostsServiceDeps {
  runtime: PostsRuntime;
  /** 内容变更后失效 HTML 缓存（由 Core 的主题服务提供）。 */
  invalidate: (tags: string[]) => void;
  /** 发布事件（内容发布后通知搜索/SEO/通知插件）。 */
  emit: (event: string, payload: Record<string, unknown>) => Promise<void>;
  /** 记录日志。 */
  log: (message: string, meta?: Record<string, unknown>) => void;
}

function assertStatus(value: unknown): PostStatus {
  if (typeof value === 'string' && (VALID_STATUS as string[]).includes(value)) {
    return value as PostStatus;
  }
  throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `文章状态非法：${String(value)}`, {
    status: 400
  });
}

/** 从标题生成唯一 slug。 */
async function ensureUniqueSlug(
  runtime: PostsRuntime,
  desired: string,
  exceptId?: number
): Promise<string> {
  const base = normalizeSlug(desired, 'post');
  let candidate = base;
  for (let index = 2; index <= 50; index += 1) {
    if (!(await repo.slugExists(runtime.db, runtime.siteId, candidate, exceptId))) {
      return candidate;
    }
    candidate = `${base}-${index}`;
  }
  throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '无法生成唯一别名，请手动指定 slug', {
    status: 409
  });
}

/** 校验并规范化保存请求。 */
export async function buildSaveInput(
  runtime: PostsRuntime,
  payload: PostSaveRequest,
  authorId: number,
  exceptId?: number
): Promise<Parameters<typeof repo.insertPost>[1]> {
  const title = String(payload.title ?? '').trim();
  if (title.length === 0) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '标题不能为空', { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `标题不得超过 ${MAX_TITLE_LENGTH} 字`, {
      status: 400
    });
  }

  const content = String(payload.content ?? '');
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '正文长度超出上限', { status: 413 });
  }

  const status = assertStatus(payload.status ?? 'draft');
  const slug = await ensureUniqueSlug(runtime, payload.slug?.trim() || slugify(title, 'post'), exceptId);

  const rendered = await renderMarkdown(content);
  const sanitized = runtime.html.sanitize(rendered);
  const excerpt =
    String(payload.excerpt ?? '').trim() ||
    markdownToPlainText(content, runtime.excerptLength);

  // 模板键必须命中当前主题声明；主题插件未启用时跳过校验（渲染期仍会优雅回退）
  const theme = runtime.services.tryUse<CoreThemeService>(SERVICE_CONTRACTS.CORE_THEME);
  const template = theme
    ? resolveContentTemplateKey(payload.template, await theme.pageTemplates())
    : null;

  return {
    siteId: runtime.siteId,
    authorId,
    title,
    slug,
    excerpt: excerpt.slice(0, 500),
    content,
    contentHtml: sanitized.value,
    status,
    coverMediaId: payload.coverMediaId ?? null,
    template,
    ...(payload.seoTitle ? { seoTitle: String(payload.seoTitle).slice(0, 255) } : {}),
    ...(payload.seoDescription ? { seoDescription: String(payload.seoDescription).slice(0, 500) } : {})
  };
}

function toSummary(row: repo.PostRow, authorNames?: Record<number, string>): PostSummary {
  const publishedAt = row.published_at
    ? row.published_at instanceof Date
      ? row.published_at.toISOString()
      : new Date(row.published_at).toISOString()
    : undefined;

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status as PostStatus,
    excerpt: row.excerpt,
    ...(row.cover_media_id
      ? { coverUrl: `/media/${row.cover_media_id}`, coverMediaId: Number(row.cover_media_id) }
      : {}),
    authorId: row.author_id,
    ...(authorNames?.[row.author_id] ? { authorName: authorNames[row.author_id] } : {}),
    ...(row.template ? { template: row.template } : {}),
    terms: [],
    ...(publishedAt ? { publishedAt } : {}),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString()
  };
}

async function toDetail(runtime: PostsRuntime, row: repo.PostRow): Promise<PostDetail> {
  const authorNames = await loadAuthorNames(runtime, [row]);
  const terms = await loadTerms(runtime, row.id);
  return {
    ...toSummary(row, authorNames),
    content: row.content,
    html: row.content_html,
    ...(row.seo_title ? { seoTitle: row.seo_title } : {}),
    ...(row.seo_description ? { seoDescription: row.seo_description } : {}),
    terms
  };
}

/** 创建 `content.posts@1` 服务实现。 */
export function createPostsService(deps: PostsServiceDeps): ContentPostsService {
  const { runtime, invalidate, emit, log } = deps;

  const invalidateForPost = (postId: number): void => {
    invalidate(['home', 'posts', `post:${postId}`]);
  };

  return {
    async listPublished(input) {
      const result = await repo.listPublished(runtime.db, runtime.siteId, input);
      const authorNames = await loadAuthorNames(runtime, result.items);
      return { items: result.items.map((row) => toSummary(row, authorNames)), total: result.total };
    },

    async findPublishedBySlug(slug) {
      const row = await repo.findPublishedBySlug(runtime.db, runtime.siteId, slug);
      return row ? toDetail(runtime, row) : undefined;
    },

    async findPublishedById(id) {
      const row = await repo.findPublishedById(runtime.db, runtime.siteId, id);
      return row ? toDetail(runtime, row) : undefined;
    },

    async listPublishedByTerm(input) {
      const taxonomyInternal = taxonomyInternalOf(runtime);
      if (!taxonomyInternal) return { items: [], total: 0 };
      const postIds = await taxonomyInternal.postIdsOfTerm(input.termSlug);
      const result = await repo.listPublishedByIds(runtime.db, runtime.siteId, postIds, input);
      const authorNames = await loadAuthorNames(runtime, result.items);
      return { items: result.items.map((row) => toSummary(row, authorNames)), total: result.total };
    },

    async searchPublished(input) {
      const result = await repo.searchPublished(runtime.db, runtime.siteId, input.keyword, input);
      const authorNames = await loadAuthorNames(runtime, result.items);
      return { items: result.items.map((row) => toSummary(row, authorNames)), total: result.total };
    },

    async titlesOf(postIds) {
      return repo.titlesOf(runtime.db, runtime.siteId, postIds);
    },

    async publishedRefs(postIds) {
      // 上限防御：调用方（导航等）通常只有个位数，这里兜住异常输入
      const rows = await repo.publishedRefs(runtime.db, runtime.siteId, postIds.slice(0, 200));
      return rows.map((row) => ({ id: row.id, title: row.title, url: `/post/${row.slug}` }));
    },

    async listForAdmin(query: PostListQuery) {
      const result = await repo.listForAdmin(runtime.db, runtime.siteId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status === 'all' ? undefined : query.status,
        keyword: query.keyword
      });
      const authorNames = await loadAuthorNames(runtime, result.items);

      const items: PostSummary[] = [];
      for (const row of result.items) {
        items.push({ ...toSummary(row, authorNames), terms: await loadTerms(runtime, row.id) });
      }
      return { items, total: result.total };
    },

    async findForAdmin(id) {
      const row = await repo.findById(runtime.db, runtime.siteId, id);
      return row ? toDetail(runtime, row) : undefined;
    },

    async save(input) {
      const previous = input.id
        ? await repo.findById(runtime.db, runtime.siteId, input.id)
        : undefined;

      if (input.id && !previous) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `文章不存在：${input.id}`, { status: 404 });
      }

      const built = await buildSaveInput(
        runtime,
        input.payload,
        previous?.author_id ?? input.authorId,
        input.id
      );

      let postId: number;
      if (input.id) {
        await repo.updatePost(runtime.db, input.id, built);
        postId = input.id;
      } else {
        postId = await repo.insertPost(runtime.db, built);
      }

      const taxonomyInternal = taxonomyInternalOf(runtime);
      if (taxonomyInternal && input.payload.termIds) {
        await taxonomyInternal.setPostTerms(postId, input.payload.termIds);
      }

      invalidateForPost(postId);

      const wasPublished = previous?.status === 'published';
      const nowPublished = built.status === 'published';
      if (nowPublished && !wasPublished) {
        await emit('content.post.published.v1', {
          postId,
          slug: built.slug,
          title: built.title,
          authorId: built.authorId
        });
      }
      if (previous && !nowPublished && wasPublished) {
        await emit('content.post.unpublished.v1', { postId, slug: built.slug });
      }
      /*
       * 更新既有文章时再广播一次。
       *
       * published / unpublished 只表达"发布状态翻转"，改标题或改别名不会产生任何事件，
       * 而引用了文章的全局插槽（如导航栏，出现在每个页面上且被 HTML 缓存）必须能
       * 感知到这类变化才能准确失效缓存。新建文章不需要：它此前不可能被引用。
       */
      if (previous) {
        await emit('content.post.updated.v1', {
          postId,
          slug: built.slug,
          title: built.title,
          status: built.status
        });
      }

      log(input.id ? '文章已更新' : '文章已创建', {
        postId,
        status: built.status,
        slug: built.slug
      });

      return { id: postId };
    },

    async remove(id) {
      const row = await repo.findById(runtime.db, runtime.siteId, id);
      if (!row) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `文章不存在：${id}`, { status: 404 });
      }
      const taxonomyInternal = taxonomyInternalOf(runtime);
      if (taxonomyInternal) {
        await taxonomyInternal.clearPostTerms(id);
      }
      await repo.deletePost(runtime.db, id);
      invalidateForPost(id);
      await emit('content.post.deleted.v1', { postId: id, slug: row.slug });
      log('文章已删除', { postId: id });
    },

    async countByStatus() {
      const counts = await repo.countByStatus(runtime.db, runtime.siteId);
      return {
        total: counts.total ?? 0,
        published: counts.published ?? 0,
        draft: counts.draft ?? 0,
        archived: counts.archived ?? 0
      };
    },

    async recent(limit) {
      const rows = await repo.recentPosts(runtime.db, runtime.siteId, limit);
      const authorNames = await loadAuthorNames(runtime, rows);
      const items: PostSummary[] = [];
      for (const row of rows) {
        items.push({ ...toSummary(row, authorNames), terms: await loadTerms(runtime, row.id) });
      }
      return items;
    }
  };
}
