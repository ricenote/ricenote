/**
 * 与 HTTP 框架解耦的请求/响应抽象。
 *
 * Core 负责把 Fastify 的 request/reply 适配成这里的结构，
 * 插件只依赖这些接口，不直接依赖 Fastify，从而避免框架锁定。
 */

import type { AuthUser } from '@ricenote/shared';
import type { Dispose } from './logger.js';

export interface ViewerContext {
  user: AuthUser;
}

/** 单次上传的文件（Core 已应用大小与数量限额）。 */
export interface UploadedFile {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface HttpRequestLike {
  readonly method: string;
  readonly url: string;
  readonly params: Record<string, string>;
  readonly query: Record<string, unknown>;
  readonly body: unknown;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly requestId: string;
  /** 已认证的访客（公开站点通常为空）。 */
  readonly viewer?: ViewerContext;
  /**
   * 读取一个 multipart 上传文件。
   * 非 multipart 请求返回 undefined；未注册 multipart 时同样返回 undefined。
   */
  file?(): Promise<UploadedFile | undefined>;
  /** 原始框架请求对象，仅供逃生舱使用。 */
  readonly raw: unknown;
}

export interface HttpResponseLike {
  statusCode: number;
  header(name: string, value: string): HttpResponseLike;
  send(payload?: string | Buffer): void;
  json(payload: unknown): void;
  html(markup: string): void;
  redirect(url: string, code?: number): void;
}

export type RouteHandler = (
  request: HttpRequestLike,
  reply: HttpResponseLike
) => void | Promise<void>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * 公开页面路由声明。
 *
 * 插件只负责产出 ViewModel，Core 负责选择主题模板并渲染 HTML。
 * 这是"插件提供数据、主题决定展示"的关键交接点。
 */
export interface PageRouteSpec {
  /** 路由名，用于 `url('name', params)` 生成链接，需全局唯一。 */
  name: string;
  /** 路径模板，支持 `:param` 占位，例如 `/post/:slug`。 */
  path: string;
  /** 页面类型（home / post / archive / search / 404 / 自定义）。 */
  kind: string;
  /** 可选：覆盖主题中该 kind 对应的模板文件。 */
  template?: string;
  /** 是否参与 HTML 缓存（默认 true）。 */
  cacheable?: boolean;
  /**
   * 声明「本路由的路径可被其它插件接管」。
   *
   * 只有显式声明为 true 的路由才允许被 `ctx.routes.overridePath()` 改写路径
   * （例如「固定链接」插件接管 `post.show` 的地址形式）。
   * 这是数据里的显式契约，避免任意插件劫持别人的路由；
   * 接管方只改变路径，**不会**替换 handler。
   */
  overridable?: boolean;
  /** 处理函数：返回 ViewModel。 */
  handler: (request: HttpRequestLike) => Promise<PageViewModel> | PageViewModel;
}

/**
 * 页面路由的路径替换声明。
 *
 * 两个字段的区别（与路径模板的「匹配模式 / 生成模式」一一对应）：
 * - `path` 用于路由注册：参数独占一段，段内字面量被剥离
 *   （`{slug}.html` → `:slug`，后缀由处理器剥离）；
 * - `urlPath` 用于地址生成：保留段内字面量（`/archives/:slug.html`），
 *   缺省与 `path` 相同。
 */
export interface PageRoutePathOverride {
  path: string;
  urlPath?: string;
}

export interface PageViewModel {
  kind: string;
  title: string;
  canonicalUrl?: string;
  /** 覆盖主题模板（优先级高于 PageRouteSpec.template）。 */
  template?: string;
  status?: number;
  /** 传给模板的数据，键名即模板中的顶层变量。 */
  data: Record<string, unknown>;
  /** 缓存标签，用于主题/内容变更时精确失效。 */
  cacheTags?: string[];
}

/** 原始 HTTP 路由声明（需要 `routes:public` 或 `routes:admin` 能力）。 */
export interface RawRouteSpec {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
  /** 需要的能力，缺省为 `routes:public`。 */
  capability?: 'routes:public' | 'routes:admin';
}

/** 管理 API 路由声明，Core 会自动套用会话、CSRF 与授权校验。 */
export interface AdminRouteSpec {
  method: HttpMethod;
  path: string;
  /** 权限点，例如 `post.write`；为空表示仅需登录。 */
  permission?: string;
  handler: RouteHandler;
}

/** 路由注册门面：所有注册方法返回注销句柄。 */
export interface RouteRegistryFacade {
  page(spec: PageRouteSpec): Dispose;
  raw(spec: RawRouteSpec): Dispose;
  adminApi(spec: AdminRouteSpec): Dispose;
  /**
   * 按路由名替换一条已注册的页面路由的路径。
   *
   * 与插件启动顺序**无关**：替换按路由名登记，在路由表被读取时叠加，
   * 因此接管方不必让被接管插件先启动，也不必声明对它硬依赖。
   * 但目标路由**必须已经注册**，且必须声明 `overridable: true`
   * （在 `core.runtime.started.v1` 阶段调用即可满足"全部插件都已注册路由"）。
   * 不满足时分别抛 `NOT_FOUND` 与 `ROUTE_CONFLICT`，绝不静默失效。
   * 返回句柄，停用插件即恢复原路径。
   */
  overridePath(name: string, override: PageRoutePathOverride): Dispose;
}
