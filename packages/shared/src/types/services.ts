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
  CommentListQuery,
  CommentModerateRequest,
  CommentStatus,
  CommentSubmitRequest,
  CommentSummary,
  CommentThreadItem,
  EffectiveSiteInfo,
  MediaSummary,
  NavItemSaveRequest,
  NavItemSummary,
  NavItemType,
  NavRenderItem,
  NavTargetOption,
  PageDetail,
  PageTemplateDescriptor,
  PageListQuery,
  PageSaveRequest,
  PageStatus,
  PageSummary,
  PostDetail,
  PostListQuery,
  PostStatus,
  PostSummary,
  SiteSettings,
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
  /**
   * Core 提供的运行时服务：待生效（需重启）状态与重启请求。
   *
   * 进程重启的**机制**由服务端进程入口注入（`registerRestartHandler`），
   * Core 只负责状态簿记与广播，因此内核本身不依赖 HTTP 层。
   */
  CORE_RUNTIME: 'core.runtime@1',
  /**
   * Core 提供的站点信息服务（env 默认值 + 数据库覆盖后的生效值）。
   *
   * 插件读取 `ctx.site` 得到的即是该服务的快照式视图。
   */
  CORE_SITE: 'core.site@1',
  /** identity 插件提供的认证服务。 */
  IDENTITY_AUTH: 'identity.auth@1',
  /** authorization 插件提供的权限服务。 */
  IDENTITY_AUTHORIZATION: 'identity.authorization@1',
  /** posts 插件提供的内容服务。 */
  CONTENT_POSTS: 'content.posts@1',
  /** pages 插件提供的自定义页面服务。 */
  CONTENT_PAGES: 'content.pages@1',
  /** navigation 插件提供的导航项服务。 */
  CONTENT_NAVIGATION: 'content.navigation@1',
  /** taxonomy 插件提供的分类标签服务。 */
  CONTENT_TAXONOMY: 'content.taxonomy@1',
  /** media 插件提供的媒体库服务。 */
  MEDIA_LIBRARY: 'media.library@1',
  /**
   * search 插件提供的可搜索数据源注册表。
   *
   * 数据源拥有者（posts 等）主动向本契约注册 `SearchSource`，
   * 因此两者之间**不存在硬依赖**：search 被禁用时数据源拥有者静默降级。
   */
  CONTENT_SEARCH: 'content.search@1',
  /** comments 插件提供的评论服务。 */
  CONTENT_COMMENTS: 'content.comments@1',
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
  /**
   * 修改本人资料（显示名与邮箱）。
   *
   * 与 `changePassword` 的区别：这里**不校验原密码**，因为调用方已经过会话认证；
   * 敏感操作（改密、重置）仍然需要原密码或管理员权限。
   */
  updateProfile(input: {
    userId: number;
    displayName?: string;
    email?: string;
  }): Promise<AuthUser>;
  /**
   * 管理员重置他人密码。
   *
   * 语义与 `changePassword` 的差异：
   * - 不需要原密码（管理员代操作）；
   * - 重置后强制该用户**全部会话**失效，避免旧凭据继续可用。
   */
  resetPassword(input: { userId: number; newPassword: string }): Promise<void>;
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
  /**
   * 批量读取文章标题（**含草稿与归档**），供其他插件的后台列表展示。
   *
   * 存在的意义是避免"为每个 ID 单独查询"的 N+1 模式；缺失的键不出现在结果中。
   */
  titlesOf(postIds: number[]): Promise<Record<number, string>>;
  /**
   * 批量读取**已发布**文章的最小引用（id / 标题 / 前台地址）。
   *
   * 与 `titlesOf` 的分工：本方法只返回已发布文章，且带上前台地址，
   * 专供导航这类"全局插槽"使用——它们只需要链接文案，不希望为了几个链接
   * 触发 `findPublishedById`（会连带查询作者与词条），也不希望自己拼 `/post/:slug`
   * 这种属于 posts 的 URL 约定。一次查询完成，返回项不保证顺序。
   */
  publishedRefs(postIds: number[]): Promise<Array<{ id: number; title: string; url: string }>>;
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

/* ----------------------------- 自定义页面 ----------------------------- */

export interface PageQueryResult {
  items: PageSummary[];
  total: number;
}

/**
 * pages 插件提供的自定义页面服务。
 *
 * 页面与文章的区别：页面不参与分类/标签与列表归档，拥有独立地址 `/page/:slug`，
 * 通常用于「关于」「联系方式」等固定内容。
 */
export interface ContentPagesService {
  /** 前台：列出已发布页面（按 sortOrder 升序）。 */
  listPublished(input: { page: number; pageSize: number }): Promise<PageQueryResult>;
  /** 前台：按 slug 获取已发布页面（含渲染后的 HTML）。 */
  findPublishedBySlug(slug: string): Promise<PageDetail | undefined>;
  /**
   * 导航项（已发布页面，按 sortOrder 升序）。
   *
   * 供主题在 `header.navigation` / `footer.widgets` 中渲染页面链接，
   * 避免主题直接查询 `rn_pages` 表。
   */
  navItems(): Promise<Array<{ id: number; title: string; slug: string; url: string }>>;
  /** 后台：分页查询（含草稿）。 */
  listForAdmin(query: PageListQuery): Promise<PageQueryResult>;
  /** 后台：详情。 */
  findForAdmin(id: number): Promise<PageDetail | undefined>;
  /** 后台：保存（新建或更新）。`authorId` 为操作者，用于记录创建人。 */
  save(input: { id?: number; authorId?: number; payload: PageSaveRequest }): Promise<{ id: number }>;
  /** 后台：删除。 */
  remove(id: number): Promise<void>;
  /** 统计（仪表盘）。 */
  countByStatus(): Promise<Record<PageStatus | 'total', number>>;
}

/* ----------------------------- 导航 ----------------------------- */

/**
 * navigation 插件提供的导航项服务。
 *
 * 顶部导航栏的**唯一权威来源**：页面插件只负责"有哪些页面"，
 * 是否出现在导航栏、排在第几位、显示什么文案，都由导航项决定。
 *
 * 其他插件与主题的常规用法是让 navigation 插件自己把链接渲染进
 * `header.navigation` 插槽；确需自行渲染（例如换一种标记结构）时才直接读本服务。
 */
export interface ContentNavigationService {
  /**
   * 前台：按顺序返回**可直接渲染**的导航项。
   *
   * 只包含已启用、且目标可解析的项目；数量上限由插件设置 `maxItems` 决定。
   */
  listRenderable(): Promise<NavRenderItem[]>;
  /** 后台：全部导航项（含停用项），并附目标解析状态。 */
  listForAdmin(): Promise<NavItemSummary[]>;
  /** 后台：保存（新建或更新）。 */
  save(input: { id?: number; payload: NavItemSaveRequest }): Promise<{ id: number }>;
  /** 后台：删除。 */
  remove(id: number): Promise<void>;
  /** 后台：上移/下移一位，返回调整后的完整列表。 */
  move(input: { id: number; direction: 'up' | 'down' }): Promise<NavItemSummary[]>;
  /** 后台：目标选择器的候选项（按标题排序，含未发布以便编辑既有引用）。 */
  targets(input: { type: Exclude<NavItemType, 'custom'>; keyword?: string }): Promise<NavTargetOption[]>;
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

/* ----------------------------- 搜索 ----------------------------- */

/** 搜索结果中的词条引用（与 PostContext.terms 同构，便于主题复用卡片模板）。 */
export interface SearchTermRef {
  id: number;
  name: string;
  slug: string;
  type: string;
}

/**
 * 搜索命中的单条结果。
 *
 * 除"检索必需"字段外，还携带最小的**展示补充**（作者、封面、词条），
 * 使主题可以复用同一套结果卡片模板渲染来自不同数据源的结果。
 */
export interface SearchHit {
  /** 数据源内唯一 ID（字符串化）。 */
  id: string;
  title: string;
  excerpt: string;
  /** 站点相对路径，例如 `/post/hello`。 */
  url: string;
  /** 结果类型，例如 `post`。 */
  type: string;
  /** 数据源展示名，用于结果分组。 */
  sourceLabel: string;
  publishedAt?: string;
  /** 展示补充：作者显示名。 */
  authorName?: string;
  /** 展示补充：封面图 URL。 */
  coverUrl?: string;
  /** 展示补充：词条。 */
  terms?: SearchTermRef[];
}

export interface SearchQuery {
  keyword: string;
  page: number;
  pageSize: number;
}

export interface SearchSourceResult {
  items: SearchHit[];
  total: number;
}

/**
 * 可搜索数据源。
 *
 * 由内容拥有者（posts 等）实现并注册到 {@link ContentSearchService}，
 * 搜索插件只依赖本契约，不感知具体内容类型。
 */
export interface SearchSource {
  /** 数据源标识，例如 `posts`。 */
  id: string;
  /** 展示名，用于结果分组。 */
  label: string;
  /**
   * 检索实现。
   *
   * 约定：分页由实现方负责；实现方**不得**返回未对公众可见的内容。
   */
  query(input: SearchQuery): Promise<SearchSourceResult>;
}

/**
 * search 插件提供的可搜索数据源注册表。
 *
 * 注册方向为"数据源拥有者主动注册"，因此 posts 与 search 之间不存在硬依赖：
 * search 被禁用时，数据源拥有者的注册调用静默失败并降级。
 */
export interface ContentSearchService {
  /** 注册数据源；返回注销句柄（插件停止时必须调用）。 */
  registerSource(source: SearchSource): () => void;
  /** 按 ID 注销数据源；不存在时静默返回（幂等，便于插件 stop 阶段调用）。 */
  unregisterSource(id: string): void;
  /** 列出已注册数据源的描述信息。 */
  listSources(): Array<{ id: string; label: string }>;
  /**
   * 跨数据源检索。
   *
   * 语义：按数据源聚合后做**全局分页**；单个数据源失败不影响其他数据源的结果。
   */
  search(input: SearchQuery): Promise<{ items: SearchHit[]; total: number }>;
  /** 是否已有可用数据源。 */
  hasSources(): boolean;
}

/* ----------------------------- 评论 ----------------------------- */

export interface CommentCounts {
  pending: number;
  approved: number;
  spam: number;
  trash: number;
  total: number;
}

/** comments 插件提供的评论服务。 */
export interface ContentCommentsService {
  /** 前台：读取某文章的已通过评论（线程化，仅含展示字段）。 */
  listApprovedThreaded(input: { postId: number; page: number; pageSize: number }): Promise<{
    items: CommentThreadItem[];
    total: number;
    /** 该文章全部已通过评论数（含回复）。 */
    totalApproved: number;
  }>;
  /** 前台：提交评论（按插件配置决定进入待审还是直接通过）。 */
  submit(
    input: CommentSubmitRequest & { ip?: string; userAgent?: string; userId?: number }
  ): Promise<{ id: number; status: CommentStatus }>;
  /** 后台：分页查询。 */
  listForAdmin(query: CommentListQuery): Promise<{ items: CommentSummary[]; total: number }>;
  /** 后台：批量审核。 */
  moderate(input: CommentModerateRequest): Promise<{ affected: number }>;
  /** 后台：状态统计。 */
  countByStatus(): Promise<CommentCounts>;
  /** 批量读取多篇文章的已通过评论数（文章列表使用）。 */
  countsForPosts(postIds: number[]): Promise<Record<number, number>>;
  /** 最近评论（仪表盘）。 */
  recent(limit: number): Promise<CommentSummary[]>;
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
  /**
   * 当前主题声明的可选模板清单（供内容校验与后台下拉使用）。
   *
   * 内容（页面/文章）保存模板键时应在此校验：键不在清单内即应拒绝，
   * 否则切换主题后会出现"模板永远命中 fallback"的静默降级。
   */
  pageTemplates(): Promise<PageTemplateDescriptor[]>;
  /** 按标签失效 HTML 缓存（例如 `post:12`、`home`）。 */
  invalidate(tags: string[]): number;
  /**
   * 清空整个 HTML 缓存。
   *
   * 用于"内容出现在全局插槽"的场景：导航插槽（`header.navigation`）会被
   * **每一个页面**渲染，因此增删一个页面会让所有已缓存页面变旧，
   * 按标签精确失效无法覆盖。写操作本就低频，整体清空是可接受的代价。
   */
  clearCache(): void;
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
 * Core 提供的站点信息服务。
 *
 * 返回的是「env 默认值 + 数据库覆盖」后的**生效值**（带内存缓存），
 * 因此可以在渲染热路径中同步调用。插件通过 `ctx.site` 获得同样的数据。
 */
export interface CoreSiteService {
  info(): EffectiveSiteInfo;
}

/**
 * Core 提供的运行时服务：待生效状态与重启。
 *
 * 分工：
 * - Core 负责**状态簿记**（是否需要重启、原因、是否正在重启）与审计；
 * - 服务端进程入口负责**重启机制**（关停 HTTP 与内核 → 重新 bootstrap → 重新监听），
 *   通过 `registerRestartHandler` 注入。未注册时 `requestRestart` 返回
 *   `RN_RESTART_UNAVAILABLE`，便于诊断脚本与测试环境使用。
 */
export interface CoreRuntimeService {
  /** 注册重启执行器（仅进程入口调用一次）。 */
  registerRestartHandler(handler: (input: { reason: string }) => Promise<void> | void): void;
  /** 标记存在待生效变更（幂等；重复调用只更新原因）。 */
  markRestartRequired(input: { reason: string; actorId?: number }): Promise<void>;
  /**
   * 请求重启：先落库待生效原因，再异步触发执行器。
   *
   * 语义上等价于 `markRestartRequired` + `handler()`，返回值仅表示"已受理"。
   */
  requestRestart(input: { reason: string; actorId?: number }): Promise<{ accepted: boolean }>;
  /** 清除待生效标记（bootstrap 成功后由进程入口调用）。 */
  clearRestartRequired(): Promise<void>;
  /** 当前状态快照。 */
  state(): { restartRequired: boolean; reason?: string; requestedAt?: string; restarting: boolean };
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
