/**
 * 路由注册表：合并插件路由、检测冲突、提供命名路由 URL 生成。
 *
 * 三类路由：
 * - `page`：公开页面路由。插件只产出 ViewModel，Core 负责套主题渲染；
 * - `raw`：原始 HTTP 路由（公开或管理），用于 RSS / sitemap / 上传回调等；
 * - `adminApi`：管理 API 路由，Core 自动套用会话、CSRF 与权限校验。
 */

import type {
  AdminRouteSpec,
  Dispose,
  HttpMethod,
  PageRouteSpec,
  RawRouteSpec,
  RouteHandler
} from '@ricenote/plugin-sdk';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import { buildPath, normalizePath, routeSignature } from './url.js';

export interface RegisteredPageRoute {
  pluginId: string;
  name: string;
  path: string;
  kind: string;
  template?: string;
  cacheable: boolean;
  handler: PageRouteSpec['handler'];
}

export interface RegisteredRawRoute {
  pluginId: string;
  method: HttpMethod;
  path: string;
  capability: 'routes:public' | 'routes:admin';
  handler: RouteHandler;
}

export interface RegisteredAdminRoute {
  pluginId: string;
  method: HttpMethod;
  path: string;
  permission?: string;
  handler: RouteHandler;
}

export class RouterRegistry {
  private readonly pageRoutes: RegisteredPageRoute[] = [];
  private readonly pageByName = new Map<string, RegisteredPageRoute>();
  private readonly rawRoutes: RegisteredRawRoute[] = [];
  private readonly adminRoutes: RegisteredAdminRoute[] = [];
  private readonly routeSignatures = new Map<string, string>();

  /* ------------------------------ 注册 ------------------------------ */

  registerPage(pluginId: string, spec: PageRouteSpec): Dispose {
    if (this.pageByName.has(spec.name)) {
      const existing = this.pageByName.get(spec.name);
      throw new RiceNoteError(
        ErrorCode.ROUTE_CONFLICT,
        `页面路由名重复：${spec.name}（已由 ${existing?.pluginId} 注册）`,
        { status: 409, details: { name: spec.name, owner: existing?.pluginId } }
      );
    }

    const path = normalizePath(spec.path);
    const route: RegisteredPageRoute = {
      pluginId,
      name: spec.name,
      path,
      kind: spec.kind,
      ...(spec.template ? { template: spec.template } : {}),
      cacheable: spec.cacheable !== false,
      handler: spec.handler
    };

    this.pageRoutes.push(route);
    this.pageByName.set(spec.name, route);

    return () => {
      const index = this.pageRoutes.indexOf(route);
      if (index >= 0) this.pageRoutes.splice(index, 1);
      if (this.pageByName.get(spec.name) === route) this.pageByName.delete(spec.name);
    };
  }

  registerRaw(pluginId: string, spec: RawRouteSpec): Dispose {
    const path = normalizePath(spec.path);
    const capability = spec.capability ?? 'routes:public';
    this.assertNoConflict(spec.method, path, pluginId, 'HTTP 路由');

    const route: RegisteredRawRoute = { pluginId, method: spec.method, path, capability, handler: spec.handler };
    this.rawRoutes.push(route);

    return () => {
      const index = this.rawRoutes.indexOf(route);
      if (index >= 0) this.rawRoutes.splice(index, 1);
      this.releaseSignature(spec.method, path);
    };
  }

  registerAdminApi(pluginId: string, spec: AdminRouteSpec): Dispose {
    const path = normalizePath(spec.path);
    this.assertNoConflict(spec.method, path, pluginId, '管理 API 路由');

    const route: RegisteredAdminRoute = {
      pluginId,
      method: spec.method,
      path,
      ...(spec.permission ? { permission: spec.permission } : {}),
      handler: spec.handler
    };
    this.adminRoutes.push(route);

    return () => {
      const index = this.adminRoutes.indexOf(route);
      if (index >= 0) this.adminRoutes.splice(index, 1);
      this.releaseSignature(spec.method, path);
    };
  }

  /* ------------------------------ 查询 ------------------------------ */

  pages(): RegisteredPageRoute[] {
    return [...this.pageRoutes];
  }

  rawRoutesList(): RegisteredRawRoute[] {
    return [...this.rawRoutes];
  }

  adminRoutesList(): RegisteredAdminRoute[] {
    return [...this.adminRoutes];
  }

  findPageByName(name: string): RegisteredPageRoute | undefined {
    return this.pageByName.get(name);
  }

  /** 按模板中的命名路由生成路径。 */
  resolveUrl(name: string, params: Record<string, string | number> = {}): string {
    const route = this.pageByName.get(name);
    if (!route) {
      throw new RiceNoteError(ErrorCode.NOT_FOUND, `未注册的路由名：${name}`, {
        status: 500,
        details: { name, available: [...this.pageByName.keys()] }
      });
    }
    return buildPath(route.path, params);
  }

  /** 列出某插件注册的全部路由（停用前影响分析）。 */
  ownedBy(pluginId: string): { pages: string[]; raw: string[]; admin: string[] } {
    return {
      pages: this.pageRoutes.filter((route) => route.pluginId === pluginId).map((route) => route.name),
      raw: this.rawRoutes
        .filter((route) => route.pluginId === pluginId)
        .map((route) => `${route.method} ${route.path}`),
      admin: this.adminRoutes
        .filter((route) => route.pluginId === pluginId)
        .map((route) => `${route.method} /api/admin${route.path}`)
    };
  }

  /* ------------------------------ 内部 ------------------------------ */

  private assertNoConflict(
    method: HttpMethod,
    path: string,
    pluginId: string,
    label: string
  ): void {
    const signature = routeSignature(method, path);
    const owner = this.routeSignatures.get(signature);
    if (owner) {
      throw new RiceNoteError(
        ErrorCode.ROUTE_CONFLICT,
        `${label}冲突：${method} ${path} 已由 ${owner} 注册`,
        { status: 409, details: { method, path, owner, pluginId } }
      );
    }
    this.routeSignatures.set(signature, pluginId);
  }

  private releaseSignature(method: HttpMethod, path: string): void {
    this.routeSignatures.delete(routeSignature(method, path));
  }
}
