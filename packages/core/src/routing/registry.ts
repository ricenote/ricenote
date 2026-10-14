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
  PageRoutePathOverride,
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
  /** 地址生成用的模式（保留 `.html` 等字面量）；缺省与 `path` 相同。 */
  urlPath?: string;
  kind: string;
  template?: string;
  cacheable: boolean;
  /** 是否允许被其它插件替换路径（见 `PageRouteSpec.overridable`）。 */
  overridable: boolean;
  handler: PageRouteSpec['handler'];
}

/** 已登记的页面路由路径替换（按路由名）。 */
interface RegisteredPagePathOverride {
  /** 发起替换的插件 ID（仅用于日志与冲突报错）。 */
  pluginId: string;
  path: string;
  urlPath: string;
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
  /** 页面路由的路径签名 → 路由名（用于页面路由之间的路径冲突检测）。 */
  private readonly pagePathSignatures = new Map<string, string>();
  /** 按路由名登记的路径替换（与插件启动顺序无关）。 */
  private readonly pagePathOverrides = new Map<string, RegisteredPagePathOverride>();

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
    this.assertPagePathFree(path, spec.name, pluginId);

    const route: RegisteredPageRoute = {
      pluginId,
      name: spec.name,
      path,
      kind: spec.kind,
      ...(spec.template ? { template: spec.template } : {}),
      cacheable: spec.cacheable !== false,
      overridable: spec.overridable === true,
      handler: spec.handler
    };

    this.pageRoutes.push(route);
    this.pageByName.set(spec.name, route);
    this.pagePathSignatures.set(routeSignature('GET', path), spec.name);

    return () => {
      const index = this.pageRoutes.indexOf(route);
      if (index >= 0) this.pageRoutes.splice(index, 1);
      if (this.pageByName.get(spec.name) === route) this.pageByName.delete(spec.name);
      if (this.pagePathSignatures.get(routeSignature('GET', path)) === spec.name) {
        this.pagePathSignatures.delete(routeSignature('GET', path));
      }
    };
  }

  /**
   * 按路由名替换页面路由的路径。
   *
   * 「固定链接」一类插件在自己启动时调用：它只改变地址形式，不接管 handler。
   * 与启动顺序无关（替换登记在读取时叠加），因此调用方不必依赖被接管插件先启动。
   */
  overridePath(pluginId: string, name: string, override: PageRoutePathOverride): Dispose {
    const route = this.pageByName.get(name);
    if (!route) {
      throw new RiceNoteError(ErrorCode.NOT_FOUND, `要替换路径的路由不存在：${name}`, {
        status: 404,
        details: { name, pluginId }
      });
    }
    if (!route.overridable) {
      throw new RiceNoteError(
        ErrorCode.ROUTE_CONFLICT,
        `路由 ${name} 未声明可被接管（overridable），拒绝替换其路径`,
        { status: 409, details: { name, owner: route.pluginId, pluginId } }
      );
    }

    const existing = this.pagePathOverrides.get(name);
    if (existing && existing.pluginId !== pluginId) {
      throw new RiceNoteError(
        ErrorCode.ROUTE_CONFLICT,
        `路由 ${name} 的路径已被 ${existing.pluginId} 接管，${pluginId} 不能再接管`,
        { status: 409, details: { name, owner: existing.pluginId, pluginId } }
      );
    }

    const path = normalizePath(override.path);
    this.assertPagePathFree(path, name, pluginId);

    const entry: RegisteredPagePathOverride = {
      pluginId,
      path,
      urlPath: normalizeUrlPath(override.urlPath ?? path)
    };
    this.pagePathOverrides.set(name, entry);

    return () => {
      if (this.pagePathOverrides.get(name) === entry) this.pagePathOverrides.delete(name);
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

  /** 全部页面路由（已叠加路径替换后的生效值）。 */
  pages(): RegisteredPageRoute[] {
    return this.pageRoutes.map((route) => this.applyOverride(route));
  }

  rawRoutesList(): RegisteredRawRoute[] {
    return [...this.rawRoutes];
  }

  adminRoutesList(): RegisteredAdminRoute[] {
    return [...this.adminRoutes];
  }

  findPageByName(name: string): RegisteredPageRoute | undefined {
    const route = this.pageByName.get(name);
    return route ? this.applyOverride(route) : undefined;
  }

  /** 按模板中的命名路由生成路径（优先用地址生成模式，保留 `.html` 等字面量）。 */
  resolveUrl(name: string, params: Record<string, string | number> = {}): string {
    const route = this.pageByName.get(name);
    if (!route) {
      throw new RiceNoteError(ErrorCode.NOT_FOUND, `未注册的路由名：${name}`, {
        status: 500,
        details: { name, available: [...this.pageByName.keys()] }
      });
    }
    const effective = this.applyOverride(route);
    return buildPath(effective.urlPath ?? effective.path, params);
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

  /** 返回叠加路径替换后的路由（未登记替换时原样返回）。 */
  private applyOverride(route: RegisteredPageRoute): RegisteredPageRoute {
    const override = this.pagePathOverrides.get(route.name);
    if (!override) return route;
    return { ...route, path: override.path, urlPath: override.urlPath };
  }

  /**
   * 校验页面路由之间的路径冲突。
   *
   * 冲突在两个时机暴露：注册新路由时（与既有生效路径比对）与登记路径替换时
   * （替换后的路径与其它路由比对）。提前拦住，避免装配 HTTP 时由 Fastify
   * 抛出难以定位的重复路由错误。
   */
  private assertPagePathFree(path: string, routeName: string, pluginId: string): void {
    const signature = routeSignature('GET', path);
    const owner = this.pagePathSignatures.get(signature);
    if (owner && owner !== routeName) {
      const existing = this.pageByName.get(owner);
      throw new RiceNoteError(
        ErrorCode.ROUTE_CONFLICT,
        `页面路由路径冲突：${path} 与路由 ${owner}（${existing?.pluginId ?? '未知插件'}）相同`,
        { status: 409, details: { path, route: routeName, owner, pluginId } }
      );
    }

    for (const route of this.pageRoutes) {
      if (route.name === routeName) continue;
      if (routeSignature('GET', this.applyOverride(route).path) !== signature) continue;
      throw new RiceNoteError(
        ErrorCode.ROUTE_CONFLICT,
        `页面路由路径冲突：${path} 与路由 ${route.name}（${route.pluginId}）相同`,
        { status: 409, details: { path, route: routeName, owner: route.name, pluginId } }
      );
    }

  }

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

/**
 * 归一化「地址生成模式」。
 *
 * 与 `normalizePath` 的差别：**保留尾部斜杠** —— 模板 `/archives/{cid}/` 的
 * 生成结果就应当带尾斜杠，canonical 与站内链接要与之完全一致。
 */
function normalizeUrlPath(path: string): string {
  const trimmed = path.trim();
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/{2,}/g, '/');
}
