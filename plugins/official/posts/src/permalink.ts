/**
 * posts 侧对固定链接方案的使用。
 *
 * 两条职责：
 * 1. **生成**：文章与分类归档的前台地址统一由 `permalink.routes@1` 产出，
 *    本插件不再自己拼 `/post/:slug`（该约定一旦被复制就会与设置漂移）；
 * 2. **命中**：把路由参数按当前生效模板还原成查询条件（按 ID 还是按缩略名），
 *    并校验年/月/日与分类是否与内容实际一致 —— 不一致判 404，避免同一篇文章
 *    出现多个可访问地址。
 *
 * 固定链接插件未启用（或它自己不认识本方案）时，全部回退到内建默认路径
 * `/post/:slug`、`/category/:slug`，行为与启用前完全一致。
 */

import {
  PERMALINK_SCHEME_IDS,
  PERMALINK_UNCATEGORIZED_SEGMENT,
  SERVICE_CONTRACTS,
  type PermalinkRoutesService,
  type TermSummary
} from '@ricenote/shared';
import type { PostRow } from './repository.js';
import type { PostsRuntime } from './runtime.js';

/** 请求期惰性解析固定链接服务（与其它可选依赖同一约定）。 */
export function permalinkOf(runtime: PostsRuntime): PermalinkRoutesService | undefined {
  return runtime.services.tryUse<PermalinkRoutesService>(SERVICE_CONTRACTS.PERMALINK);
}

/** 文章路径是否用到了 `{category}`（决定列表页要不要为每篇加载词条）。 */
export function postTemplateUsesCategory(runtime: PostsRuntime): boolean {
  return permalinkOf(runtime)?.uses(PERMALINK_SCHEME_IDS.POST, 'category') ?? false;
}

/** 生成文章地址所需的最小数据。 */
export interface PostUrlInput {
  id: number;
  slug: string;
  /** 发布时间（缺省时用 `createdAt` 兜底，保证 `{year}` 一类参数有值）。 */
  publishedAt?: Date | string | null;
  createdAt?: Date | string | null;
  /** 文章的分类（只用于 `{category}`）；缺省表示没有分类。 */
  categories?: readonly { id: number; slug: string }[];
}

/** 取"主分类"：分类中 id 最小者（最早创建），无分类时返回 undefined。 */
export function primaryCategorySlug(
  categories: readonly { id: number; slug: string }[]
): string | undefined {
  let best: { id: number; slug: string } | undefined;
  for (const category of categories) {
    if (!best || category.id < best.id) best = category;
  }
  return best?.slug;
}

/** 文章的分类（按 id 升序），供生成与命中校验共用。 */
export function categoriesOf(terms: readonly TermSummary[]): { id: number; slug: string }[] {
  return terms
    .filter((term) => term.type === 'category')
    .map((term) => ({ id: term.id, slug: term.slug }))
    .sort((left, right) => left.id - right.id);
}

/**
 * 生成文章前台地址。
 *
 * 生成失败（方案未启用、模板缺参、第三方参数取不到值）时回退到内建默认路径 ——
 * **绝不**让"配错地址"变成前台死链。
 */
export function postUrl(
  runtime: PostsRuntime,
  input: PostUrlInput,
  options: { request?: unknown } = {}
): string {
  const permalink = permalinkOf(runtime);
  if (!permalink) return `/post/${input.slug}`;

  const date = toDate(input.publishedAt ?? input.createdAt);
  const values: Record<string, string | number> = {
    cid: input.id,
    slug: input.slug,
    category: primaryCategorySlug(input.categories ?? []) ?? PERMALINK_UNCATEGORIZED_SEGMENT,
    // 月/日补零为两位（与阅读习惯一致：/2026/03/05/…）；
    // 命中侧按同样的形态比对，因此 /2026/3/5/… 不会被当作合法地址
    ...(date ? dateParts(date) : {})
  };

  return permalink.build(PERMALINK_SCHEME_IDS.POST, values, options) ?? `/post/${input.slug}`;
}

/** 生成分类归档地址；固定链接插件不可用时回退 `/category/:slug`。 */
export function categoryUrl(
  runtime: PostsRuntime,
  term: { id: number; slug: string },
  options: { request?: unknown } = {}
): string {
  const permalink = permalinkOf(runtime);
  if (!permalink) return `/category/${term.slug}`;

  return (
    permalink.build(PERMALINK_SCHEME_IDS.CATEGORY, { mid: term.id, slug: term.slug }, options) ??
    `/category/${term.slug}`
  );
}

/**
 * 降级场景用的分类地址：只知道缩略名、拿不到词条 ID 时（taxonomy 插件不可用）。
 *
 * 模板含 `{mid}` 时生成必然失败，此时回退内建形式 —— 这是"词条服务不可用"的
 * 占位页面，地址形状不再重要，重要的是页面本身能渲染出来。
 */
export function categoryUrlBySlug(runtime: PostsRuntime, slug: string): string {
  const permalink = permalinkOf(runtime);
  if (!permalink) return `/category/${slug}`;
  return permalink.build(PERMALINK_SCHEME_IDS.CATEGORY, { slug }) ?? `/category/${slug}`;
}

/** 标签归档地址：标签不纳入固定链接方案，保持内建形式。 */
export function tagUrl(term: { slug: string }): string {
  return `/tag/${term.slug}`;
}

/* ------------------------------- 命中解析 ------------------------------- */

export interface PostLookup {
  /** 按 ID 命中（模板含 `{cid}`）。 */
  byId?: number;
  /** 按缩略名命中（模板含 `{slug}`）。 */
  bySlug?: string;
  /**
   * 模板含年/月/日时的期望发布时间（**地址中的原始字符串**）。
   *
   * 保留字符串形态是为了按"生成时的补零形态"严格比对：
   * 生成 `/2026/03/05/…`，则 `/2026/3/5/…` 不应也能访问。
   */
  expectedDate?: { year: string; month: string; day: string };
  /** 模板含 `{category}` 时的期望分类缩略名。 */
  expectedCategory?: string;
}

/**
 * 把路由参数还原成文章查询条件。
 *
 * 返回 `undefined` 表示"这个地址不合法"（例如模板要求 `.html` 而地址里没有后缀），
 * 调用方应直接返回 404。固定链接插件未启用时按内建的 `/post/:slug` 处理。
 */
export function readPostLookup(
  runtime: PostsRuntime,
  params: Record<string, string>
): PostLookup | undefined {
  const permalink = permalinkOf(runtime);
  if (!permalink) {
    const slug = params.slug ?? '';
    return slug.length > 0 ? { bySlug: slug } : undefined;
  }

  const values = permalink.extract(PERMALINK_SCHEME_IDS.POST, params);
  if (!values) return undefined;

  const lookup: PostLookup = {};

  if (values.cid !== undefined) {
    const id = Number.parseInt(values.cid, 10);
    if (!Number.isInteger(id) || id <= 0) return undefined;
    lookup.byId = id;
  }
  if (values.slug !== undefined) lookup.bySlug = values.slug;

  if (values.year !== undefined && values.month !== undefined && values.day !== undefined) {
    if (!isRealDate(Number(values.year), Number(values.month), Number(values.day))) {
      return undefined;
    }
    lookup.expectedDate = { year: values.year, month: values.month, day: values.day };
  }

  if (values.category !== undefined) lookup.expectedCategory = values.category;

  // 至少要能命中一条内容，否则这个地址毫无意义
  if (lookup.byId === undefined && lookup.bySlug === undefined) return undefined;
  return lookup;
}

/** 校验文章与地址中携带的年/月/日、分类是否一致。 */
export function matchesPostLookup(
  lookup: PostLookup,
  row: PostRow,
  categories: readonly { id: number; slug: string }[]
): boolean {
  if (lookup.expectedDate) {
    const date = toDate(row.published_at);
    if (!date) return false;
    const parts = dateParts(date);
    if (
      parts.year !== lookup.expectedDate.year ||
      parts.month !== lookup.expectedDate.month ||
      parts.day !== lookup.expectedDate.day
    ) {
      return false;
    }
  }

  if (lookup.expectedCategory !== undefined) {
    const primary = primaryCategorySlug(categories);
    if (lookup.expectedCategory === PERMALINK_UNCATEGORIZED_SEGMENT) {
      if (primary !== undefined) return false;
    } else if (primary !== lookup.expectedCategory) {
      return false;
    }
  }

  return true;
}

/* ------------------------------- 分类归档 ------------------------------- */

export interface CategoryLookup {
  byId?: number;
  bySlug?: string;
}

/** 把路由参数还原成分类查询条件（模板含 `{mid}` 时按 ID 查）。 */
export function readCategoryLookup(
  runtime: PostsRuntime,
  params: Record<string, string>
): CategoryLookup | undefined {
  const permalink = permalinkOf(runtime);
  if (!permalink) {
    const slug = params.slug ?? '';
    return slug.length > 0 ? { bySlug: slug } : undefined;
  }

  const values = permalink.extract(PERMALINK_SCHEME_IDS.CATEGORY, params);
  if (!values) return undefined;

  const lookup: CategoryLookup = {};
  if (values.mid !== undefined) {
    const id = Number.parseInt(values.mid, 10);
    if (!Number.isInteger(id) || id <= 0) return undefined;
    lookup.byId = id;
  }
  if (values.slug !== undefined) lookup.bySlug = values.slug;

  if (lookup.byId === undefined && lookup.bySlug === undefined) return undefined;
  return lookup;
}

/* ------------------------------- 工具 ------------------------------- */

function toDate(value: Date | string | null | undefined): Date | undefined {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** 生成与命中共用的日期形态：年四位、月日补零两位。 */
function dateParts(date: Date): { year: string; month: string; day: string } {
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0')
  };
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1970 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}
