/**
 * 主题模板上下文（Theme Context）契约。
 *
 * 模板作者在 .njk 中可直接使用下列顶层变量，Core 的 Renderer 负责构建它们。
 * 说明书 7.5 定义了完整清单，此文件是其可执行版本。
 */

import type { ThemeSettingValues } from '@ricenote/shared';

/**
 * 全局公开站点信息。
 *
 * 取值来自「`.env` 默认值 → 后台站点设置覆盖」，因此后台改完立即生效。
 */
export interface SiteContext {
  id: string;
  title: string;
  description: string;
  url: string;
  language: string;
  /** 站点 Logo（媒体库相对路径或外部地址）；未设置时为空。 */
  logoUrl?: string;
  /** 站点图标（favicon）地址；未设置时为空。 */
  faviconUrl?: string;
  /** 页脚备案号文本；未设置时为空。 */
  icpText?: string;
  /** 备案查询链接；未设置时为空。 */
  icpUrl?: string;
}

/** 当前页面信息，由提供页面的插件决定。 */
export interface PageContext {
  kind: string;
  title: string;
  canonicalUrl: string;
  /** 页面级自定义字段，供模板自由取用。 */
  [key: string]: unknown;
}

/** 主题自身的只读信息与已校验设置。 */
export interface ThemeContext {
  id: string;
  name: string;
  version: string;
  /** 扁平化后的设置值：defaults + publishedOverrides（预览时叠加 draft）。 */
  settings: ThemeSettingValues;
}

/** 当前访客：只暴露明确可公开的字段。 */
export interface ViewerContext {
  id: number;
  name: string;
}

/** 文章视图模型（仅在文章相关页面提供）。 */
export interface PostContext {
  id: number;
  title: string;
  slug: string;
  /** 已消毒并标记为受信任的正文 HTML。 */
  html: string;
  excerpt: string;
  coverUrl?: string;
  authorName?: string;
  publishedAt?: string;
  updatedAt: string;
  terms: { id: number; name: string; slug: string; type: string }[];
  url: string;
}

export interface PostsContext {
  items: PostContext[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 自定义页面内容（仅在 `kind = 'page'` 的页面提供，变量名为 `content`）。
 *
 * 变量名刻意不叫 `page`：`page` 已被 Core 用作页面元信息
 * （kind / title / canonicalUrl），两者混用会让模板难以阅读。
 */
export interface PageContentContext {
  id: number;
  title: string;
  slug: string;
  /** 已消毒并标记为受信任的正文 HTML。 */
  html: string;
  /** 站点相对地址，例如 `/page/about`。 */
  url: string;
  /** 命中的页面模板键（主题 pageTemplates 声明）；未选择时省略。 */
  template?: string;
  publishedAt?: string;
  updatedAt: string;
}

/** 分页信息（archive / search 页面通用）。 */
export interface PaginationContext {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevUrl?: string;
  nextUrl?: string;
}

/** 主题模板的顶层上下文。 */
export interface ThemeRenderContext {
  site: SiteContext;
  page: PageContext;
  theme: ThemeContext;
  viewer?: ViewerContext;
  post?: PostContext;
  posts?: PostsContext;
  pagination?: PaginationContext;
  [key: string]: unknown;
}

/* ------------------------- helper 函数签名契约 ------------------------- */

/** `theme_asset("css/style.css")` → 带指纹的静态资源 URL。 */
export type ThemeAssetHelper = (relativePath: string) => string;

/** `url("post.show", { slug })` → 基于已注册命名路由生成 URL。 */
export type UrlHelper = (
  routeName: string,
  params?: Record<string, string | number>
) => string;

/** `slot("post.comments", { postId })` → 已安全化的 HTML 片段。 */
export type SlotHelper = (
  slotName: string,
  data?: Record<string, unknown>
) => string;

/** `has_feature("comments")` → 判断某能力当前是否实际启用。 */
export type HasFeatureHelper = (capability: string) => boolean;

/** 主题模板可用的全部 helper。 */
export interface ThemeHelpers {
  theme_asset: ThemeAssetHelper;
  url: UrlHelper;
  slot: SlotHelper;
  has_feature: HasFeatureHelper;
}
