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
 * 插件设置的读取/保存载荷。
 *
 * `groups` 由插件清单的 `settingsSchema` 解析而来（文案已按站点语言解析），
 * 后台据此自动生成表单；`declarative` 为 false 表示该插件未声明表单，
 * 前端应退化为键值编辑或引导用户前往插件自定义设置页。
 */
export interface PluginSettingsDto {
  pluginId: string;
  name: string;
  version: string;
  /** 乐观锁：保存时回传，不一致返回 409。 */
  revision: number;
  groups: SettingsGroupDto[];
  values: Record<string, unknown>;
  declarative: boolean;
  /**
   * 保存后是否需重启才生效。
   *
   * 恒为 true：`ctx.config` 是插件启动期快照（与 ADR-004 一致），
   * 保留该字段是为了让前端无需硬编码该结论。
   */
  restartRequiredOnSave: boolean;
}

export interface PluginSettingsSaveRequest {
  values: Record<string, unknown>;
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
  /** 可供页面/文章选择的模板清单（label 已按站点语言解析）。 */
  pageTemplates: PageTemplateDescriptor[];
  requires: string[];
  missingRequirements: string[];
  settingsGroups: ThemeSettingsGroupDto[];
}

/**
 * 可供内容选择的页面模板（已解析展示文案）。
 *
 * `key` 即页面/文章 `template` 字段存储的值；服务端会校验其必定来自当前主题声明。
 */
export interface PageTemplateDescriptor {
  key: string;
  /** 主题内模板文件名。 */
  template: string;
  label: string;
  description?: string;
}

export interface ThemeSettingsGroupDto {
  key: string;
  /** 已按站点语言解析的展示文案。 */
  label: string;
  description?: string;
  fields: ThemeSettingFieldDto[];
}

/**
 * 后台可渲染的设置字段。
 *
 * 与 Manifest 的差异：所有可本地化文案（label / description / placeholder / options[].label）
 * 已按站点语言解析为字符串，后台无需再处理多语言。
 */
export interface ThemeSettingFieldDto
  extends Omit<ThemeSettingField, 'label' | 'description' | 'placeholder' | 'options'> {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  /** select 选项，`label` 已按站点语言解析。 */
  options?: Array<{ label: string; value: string }>;
  value: unknown;
  default: unknown;
}

export interface ThemeSettingsPayload {
  themeId: string;
  revision: number;
  values: Record<string, unknown>;
}

/**
 * 设置分组/字段 DTO 的中性别名。
 *
 * 插件设置与主题设置在后台复用同一套表单渲染组件，因此共用同一结构。
 */
export type SettingsGroupDto = ThemeSettingsGroupDto;
export type SettingsFieldDto = ThemeSettingFieldDto;

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

/* ----------------------------- 个人资料 ----------------------------- */

/** 修改本人资料（显示名与邮箱）。 */
export interface ProfileUpdateRequest {
  displayName?: string;
  email?: string;
}

/** 修改本人密码（需校验原密码）。 */
export interface PasswordChangeRequest {
  currentPassword: string;
  nextPassword: string;
}

/** 管理员重置他人密码。 */
export interface PasswordResetRequest {
  newPassword: string;
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
  /** 封面媒体 ID（`coverUrl` 是由它派生的访问地址）。 */
  coverMediaId?: number;
  authorId: number;
  authorName?: string;
  /**
   * 所选的渲染模板键（来自当前主题的 `pageTemplates` 声明）。
   *
   * 为空表示使用主题中 `templates.post` 对应的默认模板。
   */
  template?: string;
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
  /** 渲染模板键（主题 `pageTemplates` 声明）；null/undefined 表示使用默认文章模板。 */
  template?: string | null;
  termIds?: number[];
  seoTitle?: string;
  seoDescription?: string;
}

export interface PostListQuery extends PageQuery {
  status?: PostStatus | 'all';
  keyword?: string;
  termId?: number;
}

/* ----------------------------- 自定义页面 ----------------------------- */

export type PageStatus = 'draft' | 'published';

/** 后台页面列表项。 */
export interface PageSummary {
  id: number;
  title: string;
  slug: string;
  status: PageStatus;
  /**
   * 所选的页面模板键（来自当前主题的 `pageTemplates` 声明）。
   *
   * 为空表示使用主题中 `templates.page` 对应的默认模板。
   */
  template?: string;
  /** 排序权重，数值越小越靠前。 */
  sortOrder: number;
  seoTitle?: string;
  seoDescription?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface PageDetail extends PageSummary {
  /** Markdown 原文。 */
  content: string;
  /** 服务端渲染并消毒后的 HTML。 */
  html: string;
}

export interface PageSaveRequest {
  title: string;
  slug?: string;
  content: string;
  status: PageStatus;
  /** 页面模板键；传 null/undefined 表示使用主题默认页面模板。 */
  template?: string | null;
  sortOrder?: number;
  seoTitle?: string;
  seoDescription?: string;
}

export interface PageListQuery extends PageQuery {
  status?: PageStatus | 'all';
  keyword?: string;
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

/* ----------------------------- 评论 ----------------------------- */

/** 评论审核状态机（四态）。 */
export type CommentStatus = 'pending' | 'approved' | 'spam' | 'trash';

/** 后台审核列表项。 */
export interface CommentSummary {
  id: number;
  postId: number;
  /** 关联文章标题（跨插件通过公开契约解析，可能为空）。 */
  postTitle?: string;
  parentId: number | null;
  authorName: string;
  /** 后台可见的完整邮箱；前台输出前必须脱敏。 */
  authorEmail: string;
  authorUrl?: string;
  userId?: number;
  /** 消毒前的正文（明文，后台详情使用）。 */
  content: string;
  status: CommentStatus;
  ipHash?: string;
  userAgent?: string;
  /** 直接子回复数。 */
  replyCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 前台评论线程节点（仅含展示所需字段）。 */
export interface CommentThreadItem {
  id: number;
  authorName: string;
  authorUrl?: string;
  /** 已消毒的正文 HTML（受信句柄序列化后的字符串）。 */
  html: string;
  createdAt: string;
  children: CommentThreadItem[];
}

/** 前台提交评论。 */
export interface CommentSubmitRequest {
  postId: number;
  parentId?: number | null;
  authorName: string;
  authorEmail: string;
  authorUrl?: string;
  content: string;
}

export interface CommentListQuery extends PageQuery {
  status?: CommentStatus | 'all';
  postId?: number;
  keyword?: string;
}

export type CommentModerationAction = 'approve' | 'pending' | 'spam' | 'trash' | 'delete';

export interface CommentModerateRequest {
  ids: number[];
  action: CommentModerationAction;
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
  /** 自定义页面统计：仅当 pages 插件启用时存在。 */
  pages?: {
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
  /** 评论统计：仅当评论插件启用时存在。 */
  comments?: {
    pending: number;
    approved: number;
    total: number;
  };
  recentPosts: PostSummary[];
  plugins: PluginSummary[];
}

/* ----------------------------- 站点设置 ----------------------------- */

/**
 * 生效中的站点信息。
 *
 * 取值来源为「`.env` 默认值 → 数据库覆盖层」（见 `SiteSettingsProvider`）。
 * `overridden` 列出被数据库覆盖的字段，便于后台提示运维。
 */
export interface SiteSettings {
  siteId: string;
  title: string;
  description: string;
  url: string;
  language: string;
  activeThemeId: string;
  /** 站点 Logo 地址（媒体库相对路径或外部 URL）。 */
  logoUrl?: string;
  /** 站点图标（favicon）地址。 */
  faviconUrl?: string;
  /** 页脚备案号文本。 */
  icpText?: string;
  /** 备案查询链接。 */
  icpUrl?: string;
  /** 乐观锁版本号。 */
  revision: number;
  /** 当前被数据库覆盖（相对 .env）的字段名。 */
  overridden: string[];
}

/**
 * 生效中的站点信息（不含"当前激活主题"，因为那需要查询站点运行状态）。
 *
 * 渲染上下文、插件 `ctx.site` 与 `core.site@1` 服务都以此为数据源。
 */
export type EffectiveSiteInfo = Omit<SiteSettings, 'activeThemeId'>;

/** 站点信息更新请求（仅允许白名单字段，其余一律拒绝）。 */
export interface SiteSettingsUpdate {
  title?: string;
  description?: string;
  language?: string;
  url?: string;
  /** 传空字符串表示清除该覆盖项（回落到 .env 默认值）。 */
  logoUrl?: string;
  faviconUrl?: string;
  icpText?: string;
  icpUrl?: string;
  /** 乐观锁：与当前 revision 不一致时返回 409。 */
  revision?: number;
}

/* ----------------------------- 系统运行状态 ----------------------------- */

/** 进程级运行状态（用于顶栏「待重启」提示与重启流程）。 */
export interface SystemStateDto {
  /** 存在需要重启才能生效的变更。 */
  restartRequired: boolean;
  /** 待生效变更的原因（中文，直接展示给用户）。 */
  reason?: string;
  /** 待生效标记的产生时间（ISO 8601）。 */
  requestedAt?: string;
  /** 服务端当前正在执行重启（新请求应快速失败并提示维护中）。 */
  restarting: boolean;
  /** 应用版本与本次启动时间，供前端在重启后判断"已经是新进程"。 */
  version: string;
  startedAt: string;
}

/** 重启请求响应。 */
export interface RestartAcceptedDto {
  accepted: true;
  /** 前端据此开始轮询等待恢复。 */
  restarting: true;
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

/* ----------------------------- 运行日志 ----------------------------- */

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

/** 结构化运行日志的一行（来自 logsDir 下的 JSON Lines 文件）。 */
export interface RuntimeLogEntry {
  /** 所在日志文件名（相对于 logsDir）。 */
  file: string;
  /** 该文件内的从 1 开始的行号。 */
  line: number;
  timestamp: string;
  level: LogLevelName;
  message: string;
  /** 其余结构化字段（已剔除非序列化值）。 */
  fields: Record<string, unknown>;
}

export interface RuntimeLogQuery extends PageQuery {
  level?: LogLevelName | 'all';
  /** 精确匹配的日志文件名；缺省时读取全部日志文件。 */
  file?: string;
  /** 关键字（在 message 与字段值中做不区分大小写的包含匹配）。 */
  keyword?: string;
  /** 起始时间（含），ISO 8601 字符串。 */
  from?: string;
  /** 结束时间（含），ISO 8601 字符串。 */
  to?: string;
}

/** 可读取的日志文件清单项。 */
export interface RuntimeLogFileInfo {
  name: string;
  size: number;
  updatedAt: string;
}

/* ----------------------------- 备份与恢复 ----------------------------- */

/** 备份包内的清单元数据（写入 `manifest.json`）。 */
export interface BackupManifest {
  formatVersion: 1;
  createdAt: string;
  appVersion: string;
  siteId: string;
  database: { name: string; host: string; port: number };
  plugins: Array<{ id: string; version: string; enabled: boolean }>;
  themes: Array<{ id: string; version: string; active: boolean }>;
  uploads: { fileCount: number; totalBytes: number };
}

/** 已生成的历史快照。 */
export interface BackupSnapshot {
  /** 文件名，例如 backup-20261011-143000.zip。 */
  name: string;
  size: number;
  createdAt: string;
}

/* ----------------------------- 插件包安装 ----------------------------- */

export interface PluginInstallResult {
  pluginId: string;
  name: string;
  version: string;
  /** 安装后的目录名（pluginsDir 下的相对目录）。 */
  dir: string;
  /** 是否覆盖了同 ID 的既有插件（升级）。 */
  upgraded: boolean;
  /** v1 受控重启：安装/升级后必须重启进程才会生效（ADR-004）。 */
  restartRequired: true;
}
