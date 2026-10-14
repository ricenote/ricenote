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

/**
 * 插件来源类型。
 *
 * - `registry`：npm 包。可一键安装/更新，普通 npm 依赖会被自动解析安装；
 * - `git`：Git 仓库的某个 tag / commit / 分支。取源码后按插件声明的脚本构建，
 *   适合开发版与私人插件；
 * - `local`：本地目录。开发调试直接引用源码；**压缩包上传也归入这一路**
 *   （离线兜底，没有版本概念，因此不参与更新检查）。
 */
export type PluginSourceType = 'registry' | 'git' | 'local';

/** 本地来源的投放方式（仅 `local` 有意义）。 */
export type PluginLocalVia = 'directory' | 'zip';

/**
 * 插件来源元数据。
 *
 * 后台据此展示"这个插件从哪来、装的哪个版本"，并决定能否检查更新
 * （只有 `registry` / `git` 可检查）。
 */
export interface PluginSourceInfo {
  type: PluginSourceType;
  /** 来源地址：npm 包名（含版本区间）/ Git 仓库 URL / 本地目录路径。 */
  spec: string;
  /** Git 引用（tag / commit / 分支）；仅 `git` 来源有。 */
  ref?: string;
  /** npm 解析后的确切版本；仅 `registry` 来源有。 */
  resolvedVersion?: string;
  /** 包完整性校验值（npm 的 `dist.integrity`），仅 `registry` 来源有。 */
  integrity?: string;
  /** 本地来源的投放方式；历史记录可能缺失（v0.4.0 之前无法区分）。 */
  via?: PluginLocalVia;
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
  /**
   * **随仓库分发**（位于 `plugins/official`）：不可卸载，来源每次启动以仓库路径为准。
   *
   * 注意它**不等于"官方"**：从 npm 安装的官方插件是可卸载的普通插件，
   * 是否官方看 `official`。
   */
  builtin: boolean;
  /** 属于官方插件目录（`plugin-catalog.json`）：显示"官方"徽章、参与推荐版本比较。 */
  official?: boolean;
  path: string;
  provides: string[];
  capabilities: PluginCapability[];
  dependencies: PluginDependencyInfo[];
  dependents: string[];
  lastError?: string;
  updatedAt?: string;
  /** 来源元数据；内置（随仓库分发）的插件也有，类型为 `local`。 */
  source?: PluginSourceInfo;
}

/**
 * 扩展中心「官方插件目录」的一行。
 *
 * 由目录清单（推荐版本）与已安装状态合并而来：`installedVersion` 为 null
 * 表示未安装；`updateToRecommended` 走**推荐版本**口径（不是 registry 最新版本）。
 */
export interface CatalogPluginDto {
  id: string;
  npm: string;
  /** 推荐版本（随主程序发布）。 */
  version: string;
  category: 'required' | 'recommended' | 'optional' | 'example';
  label: string;
  description: string;
  capabilities: string[];
  requires: string[];
  repository: string;
  license: string;
  /** 已安装版本；未安装为 null。 */
  installedVersion: string | null;
  /** 是否已安装（含从 npm 安装与随仓库分发两种形态）。 */
  installed: boolean;
  /** 是否随仓库分发（不可卸载）。 */
  builtin: boolean;
  /** 已装版本低于推荐版本。 */
  updateToRecommended: boolean;
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
  /** 贡献该菜单的插件 ID（Core 注入；后端自有的菜单项没有该字段）。 */
  pluginId?: string;
  /**
   * 插件自带后台界面的入口 URL（Core 计算，前端**不自行拼接**）。
   *
   * 有该字段表示"这个页面由插件自己实现"：后台用通用宿主动态 import 它并挂载，
   * 路径解析与启用态校验都在服务端的托管路由里完成。
   */
  entryUrl?: string;
  /** 插件自带样式的托管 URL（清单声明 `style` 时由 Core 计算）。 */
  styleUrl?: string;
  /**
   * 该入口当前是否可用。
   *
   * `false` 表示插件**声明了**这个页面但插件当前未启用（或启动失败）：
   * 侧栏不展示它，但直接访问该地址时前台会给出"由插件提供、当前未启用"的明确提示，
   * 而不是撞一个接口 404 或悄悄跳回仪表盘。
   */
  available?: boolean;
  /**
   * 为 `true` 时**只注册路由、不进侧栏**。
   *
   * 用于由列表页跳转进入的页面（如文章/页面的独立编辑页）：
   * 路由与深链照常可用，只是不占侧栏位置。
   */
  hidden?: boolean;
}

/* --------------------------- 命名扩展点（后台下发） --------------------------- */

/** 一个可被后台渲染的扩展点（提供方声明 + 是否可替换）。 */
export interface AdminExtensionPointDto {
  name: string;
  /** 声明者插件 ID；Core 预置的标准渲染插槽为 `core`。 */
  provider: string;
  description?: string;
  replaceable: boolean;
  props?: { name: string; description: string }[];
}

/**
 * 一条后台作用域的贡献。
 *
 * `entryUrl` / `styleUrl` 由**服务端**换算并把关（`/plugin-admin/<pluginId>/…`），
 * 前端不自行拼接路径 —— 与插件后台页面的托管口径保持一致。
 */
export interface AdminExtensionContributionDto {
  point: string;
  /** 贡献方插件 ID。 */
  pluginId: string;
  mode: 'append' | 'replace';
  order: number;
  entryUrl: string;
  styleUrl?: string;
  label?: string;
}

/**
 * `GET /api/admin/extensions` 的载荷。
 *
 * 服务端已按"插件启用且启动成功 + admin 作用域 + 当前用户权限"过滤，
 * 前端只负责渲染，不承担安全判断。
 */
export interface AdminExtensionsDto {
  points: AdminExtensionPointDto[];
  contributions: AdminExtensionContributionDto[];
}

/* --------------------------- 内容自定义字段（后台下发） --------------------------- */

/**
 * 一个内容自定义字段的后台视图（文案已按站点语言解析）。
 *
 * 文章与页面共用同一份声明，因此两个编辑页都用这个形状渲染控件。
 * 刻意**不带默认值**：未填写的字段不会写进数据，模板用 `{% if %}` 判断即可，
 * 从而避免"空字符串覆盖了主题想表达的缺省"这类隐形问题。
 */
export interface ContentFieldDto {
  key: string;
  type: 'text' | 'textarea' | 'color' | 'boolean' | 'number' | 'select' | 'image' | 'url' | 'stringList';
  label: string;
  description?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  maxLength?: number;
  maxItems?: number;
}

/** `GET /api/admin/content-fields` 的载荷：当前启用主题声明的字段集。 */
export interface ContentFieldsDto {
  /** 声明来源主题 ID（换主题后字段集会变化，界面据此解释原因）。 */
  themeId?: string;
  fields: ContentFieldDto[];
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
  /**
   * 主题声明的**内容自定义字段**值（已按当前启用主题的声明过滤）。
   *
   * 键集合随主题变化：换主题后旧键仍留在库里，但不会再出现在这里 ——
   * 模板只该看到"当前主题声明过"的字段，否则模板会读到与自己无关的脏数据。
   */
  fields?: Record<string, unknown>;
  terms: TermSummary[];
  /**
   * 前台地址（不含站点前缀）。
   *
   * 由提供内容的插件按当前生效的固定链接方案生成，消费方（订阅源、站点地图等）
   * **直接取用即可**，不要自己拼 `/post/:slug` —— 这类属于 posts 的 URL 约定
   * 一旦被复制就会与「固定链接」插件的设置漂移。
   */
  url?: string;
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
  /**
   * 内容自定义字段。键必须来自当前主题的声明，否则**整体拒绝保存**
   * （静默丢弃会让作者以为"填了却没生效"）；**省略整个键表示不改动**已存值，
   * 这样不渲染字段控件的旧界面不会在普通编辑时清空作者已填的内容。
   */
  fields?: Record<string, unknown>;
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
  /** 主题声明的内容自定义字段值（已按当前启用主题的声明过滤）。 */
  fields?: Record<string, unknown>;
  /** 排序权重，数值越小越靠前。 */
  sortOrder: number;
  seoTitle?: string;
  seoDescription?: string;
  /**
   * 前台地址（不含站点前缀）。
   *
   * 由 pages 插件按当前生效的固定链接方案生成；后台列表直接展示它，
   * 不要自己拼 `/page/:slug`（改了地址方案后就会与实际不符）。
   */
  url?: string;
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
  /** 内容自定义字段（口径同文章：未声明键拒绝保存；省略表示不改动已存值）。 */
  fields?: Record<string, unknown>;
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
  /**
   * 前台归档地址（不含站点前缀）。
   *
   * 分类地址由「固定链接」方案生成、标签保持内建形式；消费方直接取用，
   * 不要自己拼 `/category/:slug`。方案未启用或生成失败时省略，取值方需兜底。
   */
  url?: string;
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
  /**
   * 作者邮箱（可能为空字符串：站长关闭「要求填写邮箱」后访客可以留空）。
   *
   * 后台展示用；前台的邮箱走 `CommentThreadItem.authorEmail`，由主题决定怎么用。
   */
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
  /**
   * 作者邮箱（缺省表示访客没填：站长关闭「要求填写邮箱」后可以留空）。
   *
   * **会输出到前台**：评论项的 `data-rn-author-email` 与公开接口 `GET /api/comments`
   * 都会带上它，供主题自行取头像或做其它展示（插件不代劳渲染）。
   */
  authorEmail?: string;
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
  /** 邮箱是否必填由插件设置决定：关闭「要求填写邮箱」后可以留空。 */
  authorEmail?: string;
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

/* --------------------------- 插件安装任务与更新 --------------------------- */

export type PluginJobAction = 'install' | 'update' | 'remove';
export type PluginJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type PluginJobStep = 'resolve' | 'prepare' | 'commit';

/**
 * 安装请求里的来源描述（JSON 形式）。
 *
 * 压缩包走 multipart 上传端点，因此不在此列 —— 它在后台同样归入 `local` 来源，
 * 只是入口不同（ADR-015）。
 */
export type PluginInstallSourceRequest =
  | { type: 'registry'; spec: string }
  | { type: 'git'; repo: string; ref: string }
  | { type: 'directory'; path: string };

export interface PluginInstallRequest {
  source: PluginInstallSourceRequest;
  /**
   * 是否允许依赖安装脚本与构建脚本执行。
   *
   * 缺省沿用服务端配置（默认允许）。后台提交前必须让管理员显式确认
   * "安装第三方插件等同授予其服务器代码执行权限"。
   */
  allowScripts?: boolean;
}

/**
 * 安装/更新/卸载任务。
 *
 * 任务在服务端**串行执行**（同一时刻只有一个任务在改磁盘），
 * 后台通过 `GET /plugins/jobs/:id?offset=N` 轮询日志增量。
 */
export interface PluginJobDto {
  id: string;
  pluginId: string | null;
  action: PluginJobAction;
  source: PluginSourceInfo | null;
  status: PluginJobStatus;
  step: PluginJobStep | null;
  /** 0–100。 */
  progress: number;
  /** 日志（可能被截断为末尾若干 KB，避免响应体过大）。 */
  log: string;
  error: string | null;
  actorId: number | null;
  startedAt: string;
  finishedAt: string | null;
}

/** 单个插件的更新检查结果。 */
export interface PluginUpdateInfo {
  pluginId: string;
  currentVersion: string;
  source: PluginSourceInfo;
  /** 该来源是否支持检查更新（本地目录来源没有版本概念）。 */
  checkable: boolean;
  updateAvailable: boolean;
  /** 可用的最新版本（registry 为 semver；git 为远端提交短哈希）。 */
  latestVersion?: string;
  /** 不可检查或检查失败的原因（直接展示给管理员）。 */
  note?: string;
}

export interface PluginUpdateReport {
  checkedAt: string;
  items: PluginUpdateInfo[];
}

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
  /** 本次安装的来源元数据（写入 `rn_plugins`，在扩展中心展示）。 */
  source?: PluginSourceInfo;
}

/* ----------------------------- 导航 ----------------------------- */

/**
 * 导航项来源类型。
 *
 * 三种来源覆盖了顶部导航栏的全部常见需求：
 * - `custom`：站内相对路径或外部链接（标签 + 地址）；
 * - `page`：引用一个有独立地址的页面；
 * - `post`：引用一篇文章。
 */
export type NavItemType = 'custom' | 'page' | 'post';

/**
 * 导航项引用目标的解析状态。
 *
 * 后台需要区分三种情况才能给出准确提示：
 * - 目标存在且已发布 → 前台正常渲染；
 * - 目标存在但未发布 → 前台**不渲染**（避免把访客带到 404），后台给出警告；
 * - 目标已被删除 → 同上，并提示重新选择目标。
 */
export interface NavTargetState {
  type: 'page' | 'post';
  id: number;
  exists: boolean;
  published: boolean;
  title?: string;
  url?: string;
}

/** 后台列表与详情共用的导航项视图。 */
export interface NavItemSummary {
  id: number;
  type: NavItemType;
  /** 编辑者填写的文案（`custom` 必填；`page`/`post` 可留空以跟随目标标题）。 */
  label: string;
  /** 实际展示文案：`label` 优先，目标失效时为空字符串。 */
  displayLabel: string;
  /** 实际链接地址；目标失效时为 `null`。 */
  href: string | null;
  /**
   * `page` / `post` 引用的内容 ID。
   *
   * 后台编辑时必须回填到表单里；即使目标已失效也会原样返回，
   * 这样界面才能提示"原目标已删除"而不是悄悄丢失选择。
   */
  refId?: number;
  newTab: boolean;
  enabled: boolean;
  sortOrder: number;
  /** `page` / `post` 类型的目标解析状态；`custom` 无此字段。 */
  target?: NavTargetState;
  createdAt: string;
  updatedAt: string;
}

/** 保存导航项（新建或更新）。 */
export interface NavItemSaveRequest {
  type: NavItemType;
  /** `custom` 必填；`page` / `post` 可选（留空则跟随目标标题）。 */
  label?: string;
  /** `custom` 类型的地址，如 `/about` 或 `https://example.com`。 */
  href?: string;
  /** `page` / `post` 类型引用的内容 ID。 */
  refId?: number;
  newTab?: boolean;
  enabled?: boolean;
}

/**
 * 后台目标选择器中的候选项。
 *
 * 刻意**不带地址**：前台地址由提供内容的插件解析（页面是 `/page/:slug`、
 * 文章是 `/post/:slug`），导航插件不复制这类 URL 约定，避免两边各写一份而漂移。
 * `subtitle` 放别名（slug），用于同名内容之间的区分。
 */
export interface NavTargetOption {
  id: number;
  title: string;
  subtitle?: string;
}

/** 前台渲染用的最小导航项（已解析、可直接输出链接）。 */
export interface NavRenderItem {
  id: number;
  label: string;
  href: string;
  newTab: boolean;
}
