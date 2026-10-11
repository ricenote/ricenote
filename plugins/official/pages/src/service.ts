/**
 * pages 插件业务层：校验、Markdown 渲染与消毒、缓存失效与事件广播。
 *
 * 所有写入都经过"渲染 → 消毒 → 落库"三步，消毒失败即拒绝写入：
 * 页面正文会以"不转义"的方式输出到前台，任何绕过消毒的路径都是 XSS。
 */

import {
  ErrorCode,
  RiceNoteError,
  normalizeSlug,
  slugify,
  type ContentPagesService,
  type PageDetail,
  type PageListQuery,
  type PageQueryResult,
  type PageSaveRequest,
  type PageStatus,
  type PageSummary
} from '@ricenote/shared';
import { markdownToPlainText, renderMarkdown } from './markdown.js';
import {
  countPages,
  deletePageById,
  findPageById,
  findPublishedBySlug,
  insertPage,
  listNav,
  listPages,
  listPublished,
  slugTaken,
  toPageDetail,
  toPageSummary,
  updatePage,
  type PageWriteInput
} from './repository.js';
import { resolveTemplateKey, type PagesRuntime } from './runtime.js';

const VALID_STATUS: PageStatus[] = ['draft', 'published'];
const MAX_TITLE = 255;
const MAX_CONTENT = 500_000;
/** `navItems()` 单次返回的页面数上限（内存保护，非用户可见配置）。 */
const MAX_NAV_ITEMS = 500;

export interface PagesServiceDeps {
  runtime: PagesRuntime;
  /** 按标签失效 HTML 缓存（由 Core 的主题服务提供）。 */
  invalidate: (tags: string[]) => number;
  /**
   * 清空整个 HTML 缓存。
   *
   * 必需：页面会出现在 `header.navigation` 全局插槽里，而该插槽被**每一个页面**渲染，
   * 因此增删一个页面会让所有已缓存页面变旧，按标签精确失效覆盖不到。
   */
  clearCache: () => void;
  /** 广播内容变更事件（供其他插件订阅）。 */
  emit: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export function createPagesService(deps: PagesServiceDeps): ContentPagesService {
  const { runtime } = deps;
  const { db, siteId } = runtime;

  return {
    async listPublished(input): Promise<PageQueryResult> {
      const result = await listPublished(db, siteId, {
        page: input.page,
        pageSize: input.pageSize || runtime.listPageSize
      });
      return { items: result.items.map(toPageSummary), total: result.total };
    },

    async findPublishedBySlug(slug): Promise<PageDetail | undefined> {
      const row = await findPublishedBySlug(db, siteId, normalizeSlug(slug, 'page'));
      return row ? toPageDetail(row) : undefined;
    },

    async navItems() {
      // 上限由消费方（导航插件）按自己的设置收敛，这里只做内存保护
      const rows = await listNav(db, siteId, MAX_NAV_ITEMS);
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        url: `/page/${row.slug}`
      }));
    },

    async listForAdmin(query: PageListQuery): Promise<PageQueryResult> {
      const result = await listPages(db, siteId, {
        ...query,
        pageSize: query.pageSize ?? runtime.listPageSize
      });
      return { items: result.items.map(toPageSummary), total: result.total };
    },

    async findForAdmin(id): Promise<PageDetail | undefined> {
      const row = await findPageById(db, id);
      return row ? toPageDetail(row) : undefined;
    },

    async save(input: { id?: number; authorId?: number; payload: PageSaveRequest }) {
      const prepared = await prepareWrite(runtime, input.id, input.payload, input.authorId);

      if (input.id) {
        const existing = await findPageById(db, input.id);
        if (!existing) {
          throw new RiceNoteError(ErrorCode.PAGE_NOT_FOUND, `页面不存在：${input.id}`, { status: 404 });
        }
        await updatePage(db, input.id, prepared);
        await afterWrite(deps, input.id, prepared.slug, prepared.status);
        runtime.logger.info('页面已更新', { id: input.id, slug: prepared.slug, status: prepared.status });
        return { id: input.id };
      }

      const id = await insertPage(db, prepared);
      await afterWrite(deps, id, prepared.slug, prepared.status);
      runtime.logger.info('页面已创建', { id, slug: prepared.slug, status: prepared.status });
      return { id };
    },

    async remove(id): Promise<void> {
      const existing = await findPageById(db, id);
      if (!existing) {
        throw new RiceNoteError(ErrorCode.PAGE_NOT_FOUND, `页面不存在：${id}`, { status: 404 });
      }
      await deletePageById(db, id);

      invalidateForPage(deps, id);
      await deps.emit('content.pages.deleted.v1', { pageId: id, slug: existing.slug });
      runtime.logger.info('页面已删除', { id, slug: existing.slug });
    },

    async countByStatus() {
      return countPages(db, siteId);
    }
  };
}

/** 校验 + 渲染 + 消毒，产出可直接落库的写入载荷。 */
async function prepareWrite(
  runtime: PagesRuntime,
  id: number | undefined,
  payload: PageSaveRequest,
  authorId?: number
): Promise<PageWriteInput> {
  const invalid = (message: string, details?: Record<string, unknown>): RiceNoteError =>
    new RiceNoteError(ErrorCode.VALIDATION_FAILED, message, { status: 400, ...(details ? { details } : {}) });

  const title = String(payload.title ?? '').trim();
  if (title.length === 0) throw invalid('页面标题不能为空');
  if (title.length > MAX_TITLE) throw invalid(`页面标题不得超过 ${MAX_TITLE} 个字符`);

  const content = String(payload.content ?? '');
  if (content.length > MAX_CONTENT) throw invalid('正文过长（超过 50 万字符）');

  const status = assertStatus(payload.status);
  const slug = normalizeSlug(payload.slug?.trim() || slugify(title, 'page'), 'page');
  if (await slugTaken(runtime.db, runtime.siteId, slug, id)) {
    throw new RiceNoteError(ErrorCode.PAGE_SLUG_CONFLICT, `地址已被占用：${slug}`, {
      status: 409,
      details: { slug }
    });
  }

  // 模板键必须命中当前主题声明，否则拒绝保存（避免静默回退到 fallback）
  const template = await resolveTemplateKey(runtime, payload.template);

  const rendered = await renderMarkdown(content);
  const sanitized = runtime.html.sanitize(rendered);

  const sortOrder = Number.isFinite(Number(payload.sortOrder))
    ? Math.trunc(Number(payload.sortOrder))
    : 0;
  const seoDescription = String(payload.seoDescription ?? '').trim() || markdownToPlainText(content, 200);

  return {
    siteId: runtime.siteId,
    title,
    slug,
    content,
    contentHtml: sanitized.value,
    status,
    template,
    sortOrder,
    ...(payload.seoTitle ? { seoTitle: String(payload.seoTitle).slice(0, MAX_TITLE) } : {}),
    ...(seoDescription ? { seoDescription: seoDescription.slice(0, 500) } : {}),
    ...(authorId ? { authorId } : {})
  };
}

/**
 * 写入后统一失效缓存。
 *
 * 先按标签精确失效（针对该页自身），再整体清空（针对全局导航插槽）。
 */
function invalidateForPage(deps: PagesServiceDeps, id: number): void {
  deps.invalidate([`page:${id}`, 'pages', 'home']);
  deps.clearCache();
}

/** 写入后统一处理缓存与事件。 */
async function afterWrite(
  deps: PagesServiceDeps,
  id: number,
  slug: string,
  status: PageStatus
): Promise<void> {
  invalidateForPage(deps, id);
  await deps.emit('content.pages.changed.v1', { pageId: id, slug, status });
}

function assertStatus(value: unknown): PageStatus {
  const status = String(value ?? 'draft') as PageStatus;
  if (!VALID_STATUS.includes(status)) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `页面状态非法：${String(value)}`, {
      status: 400,
      details: { allowed: VALID_STATUS }
    });
  }
  return status;
}
