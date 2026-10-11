/**
 * posts 插件的运行时依赖容器与视图模型映射。
 *
 * 关于"可选依赖"的重要约定：
 * 可选服务（taxonomy / media / identity.users）**必须在请求期惰性解析**，
 * 而不是在 `start()` 中一次性取用。原因是拓扑排序对无依赖关系的插件
 * 只保证"依赖在前"，不保证任意两个插件的先后顺序——若在启动期解析，
 * 就可能出现"对方尚未启动"的假阴性，导致功能静默降级。
 */

import type { PluginDatabase, PluginLogger } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type CoreHtmlService,
  type IdentityUsersService,
  type MediaService,
  type TaxonomyInternalService,
  type TaxonomyService,
  type TermSummary
} from '@ricenote/shared';
import type { PostRow } from './repository.js';

export interface RuntimeServiceResolver {
  tryUse<T>(name: string): T | undefined;
}

export interface PostsRuntime {
  db: PluginDatabase;
  siteId: string;
  pageSize: number;
  excerptLength: number;
  html: CoreHtmlService;
  logger: PluginLogger;
  /** 惰性服务解析器（用于可选依赖）。 */
  services: RuntimeServiceResolver;
}

/* ----------------------------- 惰性服务解析 ----------------------------- */

export function taxonomyOf(runtime: PostsRuntime): TaxonomyService | undefined {
  return runtime.services.tryUse<TaxonomyService>(SERVICE_CONTRACTS.CONTENT_TAXONOMY);
}

export function taxonomyInternalOf(runtime: PostsRuntime): TaxonomyInternalService | undefined {
  return runtime.services.tryUse<TaxonomyInternalService>(SERVICE_CONTRACTS.TAXONOMY_INTERNAL);
}

export function mediaOf(runtime: PostsRuntime): Pick<MediaService, 'findById'> | undefined {
  const media = runtime.services.tryUse<MediaService>(SERVICE_CONTRACTS.MEDIA_LIBRARY);
  return media ? { findById: (id: number) => media.findById(id) } : undefined;
}

export function usersOf(runtime: PostsRuntime): IdentityUsersService | undefined {
  return runtime.services.tryUse<IdentityUsersService>('identity.users@1');
}

/* ------------------------------- 视图模型 ------------------------------- */

/** 主题中的文章视图模型（对应 theme-sdk 的 PostContext）。 */
export interface PostViewModel {
  id: number;
  title: string;
  slug: string;
  html: unknown;
  excerpt: string;
  coverUrl?: string;
  authorName?: string;
  publishedAt?: string;
  updatedAt: string;
  url: string;
  status: string;
  /** 命中的模板键（主题声明），未选择模板时省略。 */
  template?: string;
  terms: { id: number; name: string; slug: string; type: string }[];
}

/** 主题中的文章列表视图模型。 */
export interface PostsCollection {
  items: PostViewModel[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function toIso(value: Date | string | null): string | undefined {
  if (value === null) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** 解析 `?page=` 查询参数。 */
export function parsePage(raw: unknown, fallback = 1): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 1000);
}

/** 批量解析作者显示名；identity 不可用时返回空映射（不影响列表渲染）。 */
export async function loadAuthorNames(
  runtime: PostsRuntime,
  rows: { author_id: number }[]
): Promise<Record<number, string>> {
  const users = usersOf(runtime);
  if (!users || rows.length === 0) return {};
  try {
    return await users.displayNames(rows.map((row) => row.author_id));
  } catch (error) {
    runtime.logger.warn('解析作者显示名失败', {
      error: error instanceof Error ? error.message : String(error)
    });
    return {};
  }
}

/**
 * 读取文章词条。
 * taxonomy 插件被禁用时返回空数组，保证前台与会话流程仍可降级运行。
 */
export async function loadTerms(runtime: PostsRuntime, postId: number): Promise<TermSummary[]> {
  const taxonomy = taxonomyOf(runtime);
  if (!taxonomy) return [];
  try {
    return await taxonomy.termsOfPost(postId);
  } catch (error) {
    runtime.logger.warn('读取文章词条失败', {
      postId,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * 把数据库行映射为主题视图模型。
 *
 * `html` 字段使用 `markTrusted` 包裹已消毒的正文，
 * 渲染器识别该句柄后会在模板中按"不转义"输出。
 */
export async function toPostViewModel(
  runtime: PostsRuntime,
  row: PostRow,
  options: { withHtml: boolean; terms?: TermSummary[]; authorName?: string }
): Promise<PostViewModel> {
  const terms = options.terms ?? (await loadTerms(runtime, row.id));

  let coverUrl: string | undefined;
  if (row.cover_media_id) {
    const media = mediaOf(runtime);
    if (media) {
      const found = await media.findById(Number(row.cover_media_id)).catch(() => undefined);
      coverUrl = found?.url;
    }
    // media 插件不可用时降级为按 ID 约定访问，保证前台不报错
    coverUrl = coverUrl ?? `/media/${row.cover_media_id}`;
  }

  const publishedAt = toIso(row.published_at);
  const updatedAt = toIso(row.updated_at) ?? new Date().toISOString();

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    html: options.withHtml
      ? runtime.html.markTrusted(row.content_html)
      : runtime.html.markTrusted(''),
    excerpt: row.excerpt,
    ...(coverUrl ? { coverUrl } : {}),
    ...(options.authorName ? { authorName: options.authorName } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    updatedAt,
    url: `/post/${row.slug}`,
    status: row.status,
    ...(row.template ? { template: row.template } : {}),
    terms: terms.map((term) => ({
      id: term.id,
      name: term.name,
      slug: term.slug,
      type: term.type
    }))
  };
}

/** 批量映射（列表页使用，避免 N+1 的作者查询）。 */
export async function toPostViewModels(
  runtime: PostsRuntime,
  rows: PostRow[],
  options: { withHtml: boolean; authorNames?: Record<number, string> }
): Promise<PostViewModel[]> {
  const output: PostViewModel[] = [];
  for (const row of rows) {
    output.push(
      await toPostViewModel(runtime, row, {
        withHtml: options.withHtml,
        ...(options.authorNames?.[row.author_id]
          ? { authorName: options.authorNames[row.author_id] }
          : {})
      })
    );
  }
  return output;
}

/** 构造分页信息。 */
export function buildCollection(
  items: PostViewModel[],
  total: number,
  page: number,
  pageSize: number
): PostsCollection {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  };
}
