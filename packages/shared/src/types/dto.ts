/**
 * 管理后台 REST API 的 DTO 契约。
 * 服务端与前端均依赖此处类型，改动需同步 docs/plugin-api 与 docs/theme-api。
 */

import type { PluginCapability, ThemeSettingField } from '../manifests.js';

/* ----------------------------- 通用响应 ----------------------------- */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface ApiItem<T> {
  data: T;
}

export interface ApiList<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

/* ----------------------------- 插件 ----------------------------- */

export type PluginState =
  | 'DISCOVERED'
  | 'VALIDATED'
  | 'INSTALLED'
  | 'ENABLED'
  | 'STARTED'
  | 'STOPPED'
  | 'DISABLED'
  | 'FAILED';

export interface PluginDependencyInfo {
  key: string;
  range: string;
  satisfied: boolean;
  providedBy?: string;
  /** 是否属于 capability 契约（否则为插件 ID）。 */
  isCapability: boolean;
}

export interface PluginSummary {
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: string;
  author?: string;
  state: PluginState;
  enabled: boolean;
  builtin: boolean;
  path: string;
  provides: string[];
  capabilities: PluginCapability[];
  dependencies: PluginDependencyInfo[];
  dependents: string[];
  lastError?: string;
  updatedAt?: string;
}

export interface PluginToggleRequest {
  enabled: boolean;
}

/**
 * 后台导航项（由插件贡献，Core 合并后通过 `/api/admin/menu` 下发）。
 *
 * 该类型同时被插件 SDK（`@ricenote/plugin-sdk`）复用，
 * 以避免"插件侧契约"与"线上传输格式"出现两份定义。
 */
export interface AdminMenuItem {
  /** 菜单唯一 ID，例如 `posts.list`。 */
  id: string;
  label: string;
  /** 后台前端路由路径，例如 `/posts`。 */
  path: string;
  /** lucide 图标名，例如 `FileText`。 */
  icon?: string;
  /** 排序权重，数值越大越靠前。 */
  order?: number;
  /** 访问所需权限点；为空表示仅需登录。 */
  permission?: string;
}

/* ----------------------------- 主题 ----------------------------- */

export interface ThemeSummary {
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: string;
  author?: string;
  screenshotUrl?: string;
  active: boolean;
  path: string;
  templates: Record<string, string>;
  requires: string[];
  missingRequirements: string[];
  settingsGroups: ThemeSettingsGroupDto[];
}

export interface ThemeSettingsGroupDto {
  key: string;
  label: string;
  description?: string;
  fields: ThemeSettingFieldDto[];
}

export interface ThemeSettingFieldDto extends ThemeSettingField {
  key: string;
  value: unknown;
  default: unknown;
}

export interface ThemeSettingsPayload {
  themeId: string;
  revision: number;
  values: Record<string, unknown>;
}

export interface ThemeSettingsSaveRequest {
  values: Record<string, unknown>;
  /** 乐观锁：与当前 revision 不一致时返回 409。 */
  revision: number;
}

export interface ThemeActivateRequest {
  themeId: string;
}

/* ----------------------------- 身份与权限 ----------------------------- */

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  csrfToken: string;
  expiresAt: string;
}

export interface AdminUserSummary {
  id: number;
  username: string;
  displayName: string;
  email: string;
  roles: string[];
  status: 'active' | 'disabled';
  createdAt: string;
  lastLoginAt?: string;
}

/* ----------------------------- 内容 ----------------------------- */

export type PostStatus = 'draft' | 'published' | 'archived';

export interface PostSummary {
  id: number;
  title: string;
  slug: string;
  status: PostStatus;
  excerpt: string;
  coverUrl?: string;
  authorId: number;
  authorName?: string;
  terms: TermSummary[];
  publishedAt?: string;
  updatedAt: string;
  createdAt: string;
}

export interface PostDetail extends PostSummary {
  /** Markdown 原文。 */
  content: string;
  /** 服务端渲染并消毒后的 HTML。 */
  html: string;
  seoTitle?: string;
  seoDescription?: string;
}

export interface PostSaveRequest {
  title: string;
  slug?: string;
  content: string;
  excerpt?: string;
  coverMediaId?: number | null;
  status: PostStatus;
  termIds?: number[];
  seoTitle?: string;
  seoDescription?: string;
}

export interface PostListQuery extends PageQuery {
  status?: PostStatus | 'all';
  keyword?: string;
  termId?: number;
}

/* ----------------------------- 分类与标签 ----------------------------- */

export type TermType = 'category' | 'tag';

export interface TermSummary {
  id: number;
  name: string;
  slug: string;
  type: TermType;
  count?: number;
}

export interface TermSaveRequest {
  name: string;
  slug?: string;
  type: TermType;
  description?: string;
}

/* ----------------------------- 媒体 ----------------------------- */

export interface MediaSummary {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  url: string;
  alt?: string;
  createdAt: string;
}

/* ----------------------------- 仪表盘 ----------------------------- */

export interface DashboardStats {
  site: {
    version: string;
    themeId: string;
    themeName: string;
    pluginCount: number;
    failedPluginCount: number;
    uptimeSeconds: number;
    nodeVersion: string;
  };
  content: {
    total: number;
    published: number;
    draft: number;
  };
  users: {
    total: number;
    activeSessions: number;
  };
  media: {
    total: number;
    totalSize: number;
  };
  recentPosts: PostSummary[];
  plugins: PluginSummary[];
}

/* ----------------------------- 站点设置 ----------------------------- */

export interface SiteSettings {
  siteId: string;
  title: string;
  description: string;
  url: string;
  language: string;
  activeThemeId: string;
}

/* ----------------------------- 审计日志 ----------------------------- */

export interface AuditLogEntry {
  id: number;
  actorId?: number;
  actorName?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  requestId?: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}
