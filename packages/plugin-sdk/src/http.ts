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
  /** 处理函数：返回 ViewModel。 */
  handler: (request: HttpRequestLike) => Promise<PageViewModel> | PageViewModel;
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
}
