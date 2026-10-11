/**
 * 跨插件服务契约。
 *
 * 这些接口是插件之间、以及 Core 与插件之间的**唯一协作通道**。
 * 依赖方通过 capability 契约名 `ctx.services.use()` 获取实现，
 * 禁止直接 import 其他插件内部模块（见 docs/plugin-api/v1.md）。
 */

import type {
  AdminUserSummary,
  AuthUser,
  MediaSummary,
  PostDetail,
  PostListQuery,
  PostStatus,
  PostSummary,
  TermSummary,
  TermType
} from './dto.js';

/** 契约名常量，避免各处硬编码字符串。 */
export const SERVICE_CONTRACTS = {
  /** Core 提供的安全管理服务（供 identity / authorization 插件注册解析器）。 */
  CORE_SECURITY: 'core.security@1',
  /** Core 提供的主题服务（供插件读取当前主题设置）。 */
  CORE_THEME: 'core.theme@1',
  /** Core 提供的 HTML 安全化服务（供插件产出受信 HTML）。 */
  CORE_HTML: 'core.html@1',
  /** Core 提供的初始化引导服务（向插件传递站点标识与首次启动凭据）。 */
  CORE_SETUP: 'core.setup@1',
  /** identity 插件提供的认证服务。 */
  IDENTITY_AUTH: 'identity.auth@1',
  /** authorization 插件提供的权限服务。 */
  IDENTITY_AUTHORIZATION: 'identity.authorization@1',
  /** posts 插件提供的内容服务。 */
  CONTENT_POSTS: 'content.posts@1',
  /** taxonomy 插件提供的分类标签服务。 */
  CONTENT_TAXONOMY: 'content.taxonomy@1',
  /** media 插件提供的媒体库服务。 */
  MEDIA_LIBRARY: 'media.library@1',
  /**
   * taxonomy 插件提供的内部服务。
   *
   * 用于 posts 与 taxonomy 之间的**双向**协作（文章保存时要写入词条关联），
   * 保持"不直接访问对方表"的边界。该契约属于官方插件间的约定，
   * 第三方插件如需同能力应改用 `content.taxonomy@1`。
   */
  TAXONOMY_INTERNAL: 'taxonomy.internal@1'
} as const;

/* ----------------------------- 会话与认证 ----------------------------- */

/** 已解析的会话（由 identity 插件返回，Core 转换为内部 AuthContext）。 */
export interface ResolvedSession {
  user: AuthUser;
  sessionId: string;
  /** ISO 8601 时间字符串。 */
  expiresAt: string;
}

export interface LoginInput {
  username: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

export interface IdentityAuthService {
  /** 校验凭据并创建会话；失败抛 `RN_UNAUTHENTICATED`。 */
  login(input: LoginInput): Promise<{ user: AuthUser; sessionId: string; expiresAt: string }>;
  /** 解析会话；无效或过期返回 undefined。 */
  resolveSession(sessionId: string): Promise<ResolvedSession | undefined>;
  /** 注销会话。 */
  logout(sessionId: string): Promise<void>;
  /**
   * 确保存在初始管理员。
   * 仅在 identity 插件首次启动且用户表为空时生效。
   */
  ensureBootstrapAdmin(input: {
    username: string;
    password: string;
    email: string;
  }): Promise<{ created: boolean; userId?: number }>;
  changePassword(input: {
    userId: number;
    currentPassword: string;
    nextPassword: string;
  }): Promise<void>;
  listUsers(query: { page?: number; pageSize?: number; keyword?: string }): Promise<{
    items: AdminUserSummary[];
    total: number;
  }>;
  countUsers(): Promise<{ total: number }>;
  countActiveSessions(): Promise<number>;
}

/** 用户公开信息（跨插件只暴露必要字段）。 */
export interface PublicUserInfo {
  id: number;
  username: string;
  displayName: string;
  email: string;
}

/**
 * identity 插件提供的用户查询服务。
 *
 * 其他插件（如 posts 需要作者名）通过此契约获取用户信息，
 * **不得**直接查询 `rn_identity_users` 表。
 */
export interface IdentityUsersService {
  findById(userId: number): Promise<PublicUserInfo | undefined>;
  /** 批量查询，返回 `userId → 展示名` 的映射（缺失的键不出现在结果中）。 */
  displayNames(userIds: number[]): Promise<Record<number, string>>;
}

/* ----------------------------- 授权 ----------------------------- */

export interface RoleDefinition {
  id: number;
  name: string;
  description?: string;
  permissions: string[];
  builtin: boolean;
}

export interface AuthorizationService {
  permissionsOf(userId: number): Promise<string[]>;
  rolesOf(userId: number): Promise<string[]>;
  listRoles(): Promise<RoleDefinition[]>;
  listPermissions(): Promise<{ key: string; label: string; group: string }[]>;
  assignRole(userId: number, roleName: string): Promise<void>;
  revokeRole(userId: number, roleName: string): Promise<void>;
}

/* ----------------------------- 内容 ----------------------------- */

export interface PostQueryResult {
  items: PostSummary[];
  total: number;
}

export interface ContentPostsService {
  /** 前台：列出已发布文章。 */
  listPublished(input: { page: number; pageSize: number }): Promise<PostQueryResult>;
  /** 前台：按 slug 获取已发布文章（含渲染后的 HTML）。 */
  findPublishedBySlug(slug: string): Promise<PostDetail | undefined>;
  /** 前台：按 ID 获取已发布文章。 */
  findPublishedById(id: number): Promise<PostDetail | undefined>;
  /** 按分类/标签 slug 列出已发布文章。 */
  listPublishedByTerm(input: { termSlug: string; page: number; pageSize: number }): Promise<PostQueryResult>;
  /** 搜索已发布文章。 */
  searchPublished(input: { keyword: string; page: number; pageSize: number }): Promise<PostQueryResult>;
  /** 后台：分页查询（含草稿）。 */
  listForAdmin(query: PostListQuery): Promise<PostQueryResult>;
  /** 后台：详情。 */
  findForAdmin(id: number): Promise<PostDetail | undefined>;
  /** 后台：保存（新建或更新）。 */
  save(input: {
    id?: number;
    authorId: number;
    payload: import('./dto.js').PostSaveRequest;
  }): Promise<{ id: number }>;
  /** 后台：删除。 */
  remove(id: number): Promise<void>;
  /** 统计。 */
  countByStatus(): Promise<Record<PostStatus | 'total', number>>;
  /** 最近文章（仪表盘）。 */
  recent(limit: number): Promise<PostSummary[]>;
}

/* ----------------------------- 分类与标签 ----------------------------- */

export interface TaxonomyService {
  list(type?: TermType): Promise<TermSummary[]>;
  listWithCounts(): Promise<TermSummary[]>;
  findBySlug(slug: string): Promise<TermSummary | undefined>;
  save(input: { id?: number; name: string; slug?: string; type: TermType; description?: string }): Promise<{ id: number }>;
  remove(id: number): Promise<void>;
  termsOfPost(postId: number): Promise<TermSummary[]>;
}

/** taxonomy 插件提供给 posts 插件的关联维护能力。 */
export interface TaxonomyInternalService {
  /** 覆盖式设置文章的词条关联。 */
  setPostTerms(postId: number, termIds: number[]): Promise<void>;
  /** 清除文章的全部词条关联。 */
  clearPostTerms(postId: number): Promise<void>;
  /** 读取文章已关联的词条 ID。 */
  termIdsOfPost(postId: number): Promise<number[]>;
  /** 按词条别名读取文章 ID 列表（分类/标签归档使用）。 */
  postIdsOfTerm(slug: string): Promise<number[]>;
}

/* ----------------------------- 媒体 ----------------------------- */

export interface MediaService {
  list(input: { page?: number; pageSize?: number; keyword?: string }): Promise<{
    items: MediaSummary[];
    total: number;
  }>;
  findById(id: number): Promise<MediaSummary | undefined>;
  /** 保存上传文件并登记元数据。 */
  save(input: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    alt?: string;
    uploaderId?: number;
  }): Promise<MediaSummary>;
  remove(id: number): Promise<void>;
  countAll(): Promise<{ total: number; totalSize: number }>;
}

/* ----------------------------- Core 提供给插件的服务 ----------------------------- */

/**
 * Core 提供的安全管理服务。
 * identity 插件用它注册会话解析器；authorization 插件用它注册权限解析器。
 * 这样 Core 不需要 import 任何插件实现（依赖倒置）。
 */
export interface CoreSecurityService {
  /** 注册会话解析器（identity 插件调用）。 */
  registerSessionResolver(
    resolver: (sessionId: string) => Promise<ResolvedSession | undefined>
  ): void;
  /** 注册权限解析器（authorization 插件调用）。 */
  registerAuthorizationResolver(resolver: {
    permissionsOf(userId: number): Promise<string[]>;
    rolesOf(userId: number): Promise<string[]>;
  }): void;
}

/** Core 提供给插件的主题服务。 */
export interface CoreThemeService {
  /** 当前激活主题的 ID。 */
  activeThemeId(): Promise<string>;
  /** 当前生效的主题设置（扁平化字段名 → 值）。 */
  settings(): Promise<Record<string, unknown>>;
  /** 失效 HTML 缓存。 */
  invalidate(tags: string[]): number;
}

/**
 * Core 提供给插件的初始化引导服务。
 *
 * 用途：把"站点标识"与"首次启动的管理员凭据"这类**属于部署配置而非插件配置**的信息
 * 以显式契约传递给需要的插件（目前仅 identity 插件使用），
 * 避免插件直接读取进程环境变量而破坏边界。
 */
export interface CoreSetupService {
  /** 当前站点标识（v1 固定为 `default`）。 */
  siteId(): string;
  /** 首次启动时应创建的管理员凭据。 */
  bootstrapAdmin(): { username: string; password: string; email: string };
  /** 受管目录（插件用于存放上传文件等，不得越出这些目录）。 */
  paths(): { storageDir: string; uploadsDir: string; cacheDir: string };
}

/**
 * 受信任 HTML 句柄。
 *
 * 插件在 ViewModel 中提供的富文本必须使用本句柄包装，
 * 渲染器才会在模板中按"不转义"输出；普通字符串一律自动转义。
 */
export interface TrustedHtmlHandle {
  readonly __trustedHtml: true;
  readonly value: string;
  toString(): string;
}

/**
 * Core 提供的 HTML 安全化服务。
 *
 * 插件不应自行引入消毒库，统一走此服务以保证全站消毒策略一致。
 */
export interface CoreHtmlService {
  /** 消毒富文本并返回受信任句柄。 */
  sanitize(dirty: string, options?: { extraTags?: string[] }): TrustedHtmlHandle;
  /** 直接标记为受信任（仅用于插件自己生成的、已确认安全的 HTML 片段）。 */
  markTrusted(html: string): TrustedHtmlHandle;
  /** 转义为 HTML 安全字符串。 */
  escape(text: string): string;
}
