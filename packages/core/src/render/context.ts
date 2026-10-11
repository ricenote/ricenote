/**
 * Theme Context 构建。
 *
 * 该模块集中体现"插件提供数据、主题决定展示"的交接：
 * 插件返回的 ViewModel.data 会被合并进模板顶层变量，
 * Core 负责补齐 site / page / theme / viewer 等受控上下文。
 */

import type { ThemeSettingValues } from '@ricenote/shared';
import type {
  PageContext,
  PaginationContext,
  SiteContext,
  ThemeContext,
  ViewerContext
} from '@ricenote/theme-sdk';
import type { HttpRequestLike } from '@ricenote/plugin-sdk';

export interface BuildContextInput {
  site: SiteContext;
  theme: { id: string; name: string; version: string; settings: ThemeSettingValues };
  page: { kind: string; title: string; canonicalUrl: string };
  /** 插件返回的 ViewModel.data。 */
  data: Record<string, unknown>;
  viewer?: ViewerContext;
  pagination?: PaginationContext;
  request?: HttpRequestLike;
}

/** 合并后的模板上下文（主题模板的顶层变量）。 */
export type TemplateContext = Record<string, unknown>;

/**
 * 构建模板上下文。
 *
 * 注意：插件提供的 data 先铺开，再由 Core 的受控字段覆盖，
 * 从而保证插件无法通过 data 伪造 `site` / `theme` / `viewer` 等安全相关变量。
 */
export function buildTemplateContext(input: BuildContextInput): TemplateContext {
  const page: PageContext = {
    ...input.data,
    kind: input.page.kind,
    title: input.page.title,
    canonicalUrl: input.page.canonicalUrl
  };

  const theme: ThemeContext = {
    id: input.theme.id,
    name: input.theme.name,
    version: input.theme.version,
    settings: input.theme.settings
  };

  return {
    ...input.data,
    site: input.site,
    page,
    theme,
    ...(input.viewer ? { viewer: input.viewer } : {}),
    ...(input.pagination ? { pagination: input.pagination } : {}),
    // 便于模板调试：当前渲染的页面类型
    current_kind: input.page.kind
  };
}

/** 由请求对象推导访客上下文（仅暴露可公开字段）。 */
export function viewerFromRequest(request?: HttpRequestLike): ViewerContext | undefined {
  const user = request?.viewer?.user;
  if (!user) return undefined;
  return { id: user.id, name: user.displayName || user.username };
}

/** 构造分页上下文。 */
export function buildPagination(input: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
}): PaginationContext {
  const totalPages = Math.max(1, Math.ceil(input.total / Math.max(1, input.pageSize)));
  const hasPrev = input.page > 1;
  const hasNext = input.page < totalPages;
  const link = (page: number): string => {
    const separator = input.basePath.includes('?') ? '&' : '?';
    return `${input.basePath}${separator}page=${page}`;
  };

  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages,
    hasPrev,
    hasNext,
    ...(hasPrev ? { prevUrl: link(input.page - 1) } : {}),
    ...(hasNext ? { nextUrl: link(input.page + 1) } : {})
  };
}
