/**
 * pages 插件业务层：校验、Markdown 渲染与消毒、缓存失效与事件广播。
 *
 * 所有写入都经过"渲染 → 消毒 → 落库"三步，消毒失败即拒绝写入：
 * 页面正文会以"不转义"的方式输出到前台，任何绕过消毒的路径都是 XSS。
 */

import {
  ErrorCode,
  RiceNoteError,
  assertContentFieldValues,
  normalizeSlug,
  slugify,
  type ContentPagesService,
  type PageDetail,
  type PageListQuery,
  type PageQueryResult,
  type PageSaveRequest,
  type PageStatus
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
import { readContentFields, resolveTemplateKey, type PagesRuntime } from './runtime.js';

const VALID_STATUS: PageStatus[] = ['draft', 'published'];
const MAX_TITLE = 255;
/** 正文长度上限（保存与预览共用，避免"预览能过、保存 500"的分裂口径）。 */
export const MAX_CONTENT = 500_000;
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

/**
 * 渲染预览 HTML：与保存/发布**完全同一条管线**（Markdown 渲染 → 消毒）。
 *
 * 单独导出是为了让后台上传编辑器复用它，而不是再写一套 —— 编辑器自带的预览
 * 与前台渲染有差异时，作者会怀疑"保存后变了样"，这类问题最难排查。
 */
export async function renderPreviewHtml(runtime: PagesRuntime, content: string): Promise<string> {
  const rendered = await renderMarkdown(content);
  return runtime.html.sanitize(rendered).value;
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
      return { items: result.items.map((row) => toPageSummary(row)), total: result.total };
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
      // 内容字段按**当前主题声明**过滤：换主题后旧键仍在库里，但不再出现在后台响应里
      const declared = await runtime.theme.contentFields();
      return {
        items: result.items.map((row) => toPageSummary(row, readContentFields(runtime, row, declared))),
        total: result.total
      };
    },

    async findForAdmin(id): Promise<PageDetail | undefined> {
      const row = await findPageById(db, id);
      if (!row) return undefined;
      const declared = await runtime.theme.contentFields();
      return toPageDetail(row, readContentFields(runtime, row, declared));
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

  /*
   * 内容自定义字段的声明同样来自主题（与 pageTemplates 共用同一个 `core.theme@1` 句柄）：
   * - 提交了就**必须**通过声明白名单，未声明的键 / 类型不符 / 越界一律拒绝保存（fail-closed）；
   * - 未提交（旧版后台界面不含字段控件）时不传，更新时保留既有值，避免普通编辑清空字段。
   */
  const fields =
    payload.fields === undefined
      ? undefined
      : assertContentFieldValues(await runtime.theme.contentFields(), payload.fields);

  // 与预览接口同一条管线：渲染 → 消毒（消毒失败即拒绝写入）
  const contentHtml = await renderPreviewHtml(runtime, content);

  const sortOrder = Number.isFinite(Number(payload.sortOrder))
    ? Math.trunc(Number(payload.sortOrder))
    : 0;
  const seoDescription = String(payload.seoDescription ?? '').trim() || markdownToPlainText(content, 200);

  return {
    siteId: runtime.siteId,
    title,
    slug,
    content,
    contentHtml,
    status,
    template,
    ...(fields ? { fields } : {}),
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
