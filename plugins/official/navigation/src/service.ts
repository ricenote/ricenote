/**
 * `content.navigation@1` 的实现。
 *
 * 核心约定：
 * 1. **引用而非快照**：`page` / `post` 类型的项只保存内容 ID，
 *    标题与地址在读取时解析。页面改名、改别名后导航自动跟随。
 * 2. **解析失败是一等公民**：目标被删除或未发布时，前台**跳过该项**（绝不输出死链），
 *    后台则把 `exists` / `published` 原样告诉调用方，由界面提示用户处理。
 * 3. **可选依赖**：pages / posts 未启用时，引用类项全部视为"未解析"，
 *    自定义链接照常工作；服务本身不因缺少插件而启动失败。
 */

import {
  ErrorCode,
  RiceNoteError,
  type ContentNavigationService,
  type NavItemSaveRequest,
  type NavItemSummary,
  type NavItemType,
  type NavRenderItem,
  type NavTargetOption,
  type NavTargetState
} from '@ricenote/shared';
import { moveInOrder, normalizeNavHref, normalizeNavLabel } from './nav.js';
import {
  deleteItem,
  findItemById,
  insertItem,
  listItems,
  nextSortOrder,
  renumberItems,
  updateItem,
  type NavItemRow
} from './repository.js';
import { pagesOf, postsOf, type NavigationRuntime, type ResolvedTarget } from './runtime.js';

const VALID_TYPES: readonly NavItemType[] = ['custom', 'page', 'post'];
/** 目标选择器单次返回的候选上限（后台下拉，不需要分页）。 */
const TARGET_PAGE_SIZE = 200;

export interface NavigationServiceDeps {
  runtime: NavigationRuntime;
  /** 清空整个 HTML 缓存：导航插槽出现在每个页面上，按标签失效覆盖不到。 */
  clearCache: () => void;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

export function createNavigationService(deps: NavigationServiceDeps): ContentNavigationService {
  const { runtime } = deps;
  const { db, siteId } = runtime;

  /** 解析"已发布"目标：前台渲染与后台判断 `published` 都以此为权威。 */
  async function resolvePublished(rows: NavItemRow[]): Promise<Map<string, ResolvedTarget>> {
    const resolved = new Map<string, ResolvedTarget>();
    const pageIds = uniqueIds(rows, 'page');
    const postIds = uniqueIds(rows, 'post');

    const pages = pagesOf(runtime);
    if (pages && pageIds.length > 0) {
      const wanted = new Set(pageIds);
      // navItems() 一次查询即可拿到"已发布页面"的 id / 标题 / 地址
      for (const item of await pages.navItems()) {
        if (wanted.has(item.id)) resolved.set(`page:${item.id}`, { title: item.title, url: item.url });
      }
    }

    const posts = postsOf(runtime);
    if (posts && postIds.length > 0) {
      for (const ref of await posts.publishedRefs(postIds)) {
        resolved.set(`post:${ref.id}`, { title: ref.title, url: ref.url });
      }
    }

    return resolved;
  }

  /** 后台用的目标状态：区分"仍存在但未发布"与"已被删除"。 */
  async function resolveTargetStates(rows: NavItemRow[]): Promise<Map<string, NavTargetState>> {
    const states = new Map<string, NavTargetState>();
    const pageIds = uniqueIds(rows, 'page');
    const postIds = uniqueIds(rows, 'post');

    if (pageIds.length > 0) {
      const pages = pagesOf(runtime);
      const published = new Map(
        pages ? (await pages.navItems()).map((item) => [item.id, item]) : []
      );
      for (const id of pageIds) {
        const hit = published.get(id);
        if (hit) {
          states.set(`page:${id}`, {
            type: 'page',
            id,
            exists: true,
            published: true,
            title: hit.title,
            url: hit.url
          });
          continue;
        }
        // 未发布或已删除：逐个确认（数量极少，且只在后台列表里发生）
        const detail = pages ? await pages.findForAdmin(id).catch(() => undefined) : undefined;
        states.set(
          `page:${id}`,
          detail
            ? { type: 'page', id, exists: true, published: false, title: detail.title }
            : { type: 'page', id, exists: false, published: false }
        );
      }
    }

    if (postIds.length > 0) {
      const posts = postsOf(runtime);
      const published = new Map(
        posts ? (await posts.publishedRefs(postIds)).map((ref) => [ref.id, ref]) : []
      );
      // titlesOf 含草稿与归档，用来判断"存在但未发布"
      const titles = posts ? await posts.titlesOf(postIds) : {};
      for (const id of postIds) {
        const hit = published.get(id);
        if (hit) {
          states.set(`post:${id}`, {
            type: 'post',
            id,
            exists: true,
            published: true,
            title: hit.title,
            url: hit.url
          });
          continue;
        }
        const title = titles[id];
        states.set(
          `post:${id}`,
          title === undefined
            ? { type: 'post', id, exists: false, published: false }
            : { type: 'post', id, exists: true, published: false, title }
        );
      }
    }

    return states;
  }

  function toSummary(row: NavItemRow, states: Map<string, NavTargetState>): NavItemSummary {
    const type = row.item_type as NavItemType;
    const label = normalizeNavLabel(row.label ?? '');
    const base = {
      id: row.id,
      type,
      label,
      newTab: toBool(row.new_tab),
      enabled: toBool(row.enabled),
      sortOrder: Number(row.sort_order),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at)
    };

    if (type === 'custom') {
      return { ...base, displayLabel: label, href: normalizeNavHref(row.href) ?? null };
    }

    const refId = Number(row.ref_id ?? 0);
    const target: NavTargetState =
      states.get(`${type}:${refId}`) ?? { type, id: refId, exists: false, published: false };
    // 未发布的目标不给出地址：后台界面据此显示"前台不会展示"
    const href = target.published && target.url ? target.url : null;
    return {
      ...base,
      displayLabel: label || target.title || '',
      href,
      ...(refId > 0 ? { refId } : {}),
      target
    };
  }

  /** 引用目标是否存在（被引用的内容插件未启用时视为"无法校验"，放行）。 */
  async function targetExists(type: 'page' | 'post', refId: number): Promise<boolean> {
    if (type === 'page') {
      const pages = pagesOf(runtime);
      if (!pages) {
        deps.log('pages 插件未启用，跳过页面引用校验', { pageId: refId });
        return true;
      }
      return (await pages.findForAdmin(refId)) !== undefined;
    }

    const posts = postsOf(runtime);
    if (!posts) {
      deps.log('posts 插件未启用，跳过文章引用校验', { postId: refId });
      return true;
    }
    return (await posts.titlesOf([refId]))[refId] !== undefined;
  }

  async function listForAdmin(): Promise<NavItemSummary[]> {
    const rows = await listItems(db, siteId);
    if (rows.length === 0) return [];
    const states = await resolveTargetStates(rows);
    return rows.map((row) => toSummary(row, states));
  }

  return {
    async listRenderable() {
      const rows = await listItems(db, siteId);
      if (rows.length === 0) return [];
      const enabled = rows.filter((row) => toBool(row.enabled));
      if (enabled.length === 0) return [];

      const published = await resolvePublished(enabled);
      const output: NavRenderItem[] = [];

      for (const row of enabled) {
        // 先在内存里按顺序取足 maxItems，再跳过解析失败项，避免"渲染为空但后面还有有效项"
        if (output.length >= runtime.maxItems) break;

        const type = row.item_type as NavItemType;
        const newTab = toBool(row.new_tab);

        if (type === 'custom') {
          const href = normalizeNavHref(row.href);
          const label = normalizeNavLabel(row.label ?? '');
          // 地址非法或缺少文案的历史数据：跳过而不是输出坏链接
          if (!href || label.length === 0) continue;
          output.push({ id: row.id, label, href, newTab });
          continue;
        }

        const target = published.get(`${type}:${row.ref_id}`);
        // 目标未发布或已删除 → 前台不渲染，避免死链
        if (!target) continue;
        output.push({
          id: row.id,
          label: normalizeNavLabel(row.label ?? '') || target.title,
          href: target.url,
          newTab
        });
      }

      return output;
    },

    listForAdmin,

    async save({ id, payload }) {
      const type = readType(payload.type);
      const label = normalizeNavLabel(payload.label ?? '');
      const newTab = payload.newTab === undefined ? false : toBool(payload.newTab);
      const enabled = payload.enabled === undefined ? true : toBool(payload.enabled);

      let href: string | null = null;
      let refId: number | null = null;

      if (type === 'custom') {
        if (label.length === 0) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '自定义链接必须填写文案', {
            status: 400,
            details: { field: 'label' }
          });
        }
        const normalized = normalizeNavHref(payload.href);
        if (!normalized) {
          throw new RiceNoteError(
            ErrorCode.VALIDATION_FAILED,
            '自定义链接地址必须以 / 开头（站内）或为 http(s):// 完整地址',
            { status: 400, details: { field: 'href' } }
          );
        }
        href = normalized;
      } else {
        refId = readRefId(payload.refId);
        if (!(await targetExists(type, refId))) {
          throw new RiceNoteError(
            ErrorCode.VALIDATION_FAILED,
            `引用的${type === 'page' ? '页面' : '文章'}不存在：${refId}`,
            { status: 400, details: { field: 'refId' } }
          );
        }
      }

      if (id === undefined) {
        const created = await insertItem(db, {
          siteId,
          label: label || null,
          type,
          href,
          refId,
          newTab,
          enabled,
          sortOrder: await nextSortOrder(db, siteId)
        });
        deps.clearCache();
        deps.log('导航项已创建', { navItemId: created, type });
        return { id: created };
      }

      const existing = await findItemById(db, siteId, id);
      if (!existing) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `导航项不存在：${id}`, { status: 404 });
      }
      await updateItem(db, siteId, id, { label: label || null, type, href, refId, newTab, enabled });
      deps.clearCache();
      deps.log('导航项已更新', { navItemId: id, type });
      return { id };
    },

    async remove(id) {
      const removed = await deleteItem(db, siteId, id);
      if (!removed) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `导航项不存在：${id}`, { status: 404 });
      }
      deps.clearCache();
      deps.log('导航项已删除', { navItemId: id });
    },

    async move({ id, direction }) {
      const rows = await listItems(db, siteId);
      const ordered = rows.map((row) => row.id);
      if (!ordered.includes(id)) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `导航项不存在：${id}`, { status: 404 });
      }

      const next = moveInOrder(ordered, id, direction);
      // 到达边界时顺序不变，此时不必写库也不必清缓存
      if (next.some((value, index) => value !== ordered[index])) {
        await renumberItems(db, siteId, next);
        deps.clearCache();
        deps.log('导航项顺序已调整', { navItemId: id, direction });
      }
      return listForAdmin();
    },

    async targets({ type, keyword }): Promise<NavTargetOption[]> {
      // 只列出已发布内容：未发布的目标在前台不会渲染，列出来只会让人选了个"看不见"的项
      const trimmed = keyword?.trim();

      if (type === 'page') {
        const pages = pagesOf(runtime);
        if (!pages) return [];
        const result = await pages.listForAdmin({
          page: 1,
          pageSize: TARGET_PAGE_SIZE,
          status: 'published',
          ...(trimmed ? { keyword: trimmed } : {})
        });
        return result.items.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.slug
        }));
      }

      const posts = postsOf(runtime);
      if (!posts) return [];
      const result = trimmed
        ? await posts.searchPublished({ keyword: trimmed, page: 1, pageSize: TARGET_PAGE_SIZE })
        : await posts.listPublished({ page: 1, pageSize: TARGET_PAGE_SIZE });
      return result.items.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.slug
      }));
    }
  };
}

/* ------------------------------ 工具函数 ------------------------------ */

function uniqueIds(rows: NavItemRow[], type: NavItemType): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.item_type !== type) continue;
    const id = Number(row.ref_id ?? 0);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

function readType(raw: unknown): NavItemType {
  const type = String(raw ?? '') as NavItemType;
  if (!VALID_TYPES.includes(type)) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `导航项类型非法：${String(raw)}`, {
      status: 400,
      details: { allowed: VALID_TYPES }
    });
  }
  return type;
}

function readRefId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '引用目标 ID 非法', {
      status: 400,
      details: { field: 'refId' }
    });
  }
  return id;
}

function toBool(value: number | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  return Number(value ?? 0) === 1;
}

function toIso(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
