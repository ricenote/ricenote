/**
 * PluginContext 工厂。
 *
 * 该模块是"能力白名单"的执行点：插件在 Manifest 中声明的 `capabilities`
 * 决定它能否使用数据库、注册路由、订阅事件等。未声明的能力会被一个
 * 明确报错的门面替代，而不是静默降级——让问题在开发期就暴露。
 *
 * 同时，所有返回的 `Dispose` / `Unsubscribe` 句柄会被自动收集，
 * 由 Plugin Manager 在 `stop()` 后统一校验是否已全部调用。
 */

import type {
  AdminMenuItem,
  AdminRouteSpec,
  Dispose,
  EventHandler,
  ExtensionApplyOptions,
  ExtensionContributeOptions,
  ExtensionPointDeclaration,
  HttpRequestLike,
  PageRouteSpec,
  Plugin,
  PluginConfigReader,
  PluginContext,
  PluginDatabase,
  RawRouteSpec,
  ServiceDescriptor,
  SiteInfo,
  SlotComponent,
  SlotRenderContext,
  Unsubscribe
} from '@ricenote/plugin-sdk';
import { ErrorCode, RiceNoteError, type PluginCapability } from '@ricenote/shared';
import type { Logger } from '../logger.js';
import type { DatabaseAdapter } from '../database/adapter.js';
import type { ServiceRegistry } from '../services/registry.js';
import type { EventBus } from '../events/bus.js';
import type { RouterRegistry } from '../routing/registry.js';
import type { SlotRegistry } from '../render/slots.js';
import type { ExtensionRegistry } from '../extensions/registry.js';
import type { AdminMenuRegistry } from './admin-menu.js';
import type { LoadedPlugin } from './manifest.js';
import type { PermissionRegistry } from '../security/permission-registry.js';
import { resolvePluginSettings } from './settings-schema.js';

export interface ContextFactoryDeps {
  db: DatabaseAdapter;
  services: ServiceRegistry;
  events: EventBus;
  router: RouterRegistry;
  slots: SlotRegistry;
  /** 命名扩展点注册表（三个作用域共用；`slots` 是它的 render 作用域门面）。 */
  extensions: ExtensionRegistry;
  adminMenu: AdminMenuRegistry;
  /**
   * 读取**当前生效**的站点信息。
   *
   * 以取值函数传入而非快照：后台修改站点信息后立即生效（无需重启），
   * 插件每次访问 `ctx.site` 都得到最新值。
   *
   * 注意与 `config` 的差异：插件配置（`ctx.config`）仍是启动期快照，
   * 因为它在 `start()` 阶段被读取并参与路由/服务装配（ADR-004）。
   */
  site: () => SiteInfo;
  /** 站点级插件配置覆盖（来自 rn_plugin_settings）。 */
  pluginSettings: Map<string, Record<string, unknown>>;
  /**
   * 权限点登记表。
   *
   * 注册管理路由/菜单时把"用到的权限点"记进去，供 Core 聚合展示，
   * 并在"用了却没声明"时给出告警（宽松策略：不影响鉴权）。
   */
  permissions: PermissionRegistry;
  logger: Logger;
}

export interface PluginContextBundle {
  context: PluginContext;
  /** 本插件注册的全部句柄（按注册顺序）。 */
  disposers: Dispose[];
  /** 用于停用后校验是否泄漏。 */
  pendingDisposers(): number;
}

function forbidden(pluginId: string, capability: PluginCapability, api: string): RiceNoteError {
  return new RiceNoteError(
    ErrorCode.FORBIDDEN,
    `插件 ${pluginId} 未在 manifest.capabilities 中声明 ${capability}，禁止调用 ${api}`,
    { status: 403, details: { pluginId, capability, api } }
  );
}

/** 构造一个"永远抛错"的数据库门面，用于未声明 database:own 的插件。 */
function deniedDatabase(pluginId: string): PluginDatabase {
  const fail = (): never => {
    throw forbidden(pluginId, 'database:own', 'ctx.db');
  };
  return {
    pluginId,
    orm: undefined,
    query: fail as unknown as PluginDatabase['query'],
    execute: fail as unknown as PluginDatabase['execute'],
    transaction: fail as unknown as PluginDatabase['transaction'],
    table: fail as unknown as PluginDatabase['table']
  };
}

/** 创建插件上下文。 */
export function createPluginContext(
  plugin: LoadedPlugin,
  deps: ContextFactoryDeps
): PluginContextBundle {
  const pluginId = plugin.manifest.id;
  const capabilities = new Set<PluginCapability>(plugin.manifest.capabilities ?? []);
  const disposers: Dispose[] = [];
  const logger = deps.logger.child({ plugin: pluginId });

  const track = <T extends Dispose>(dispose: T): T => {
    disposers.push(dispose);
    return dispose;
  };

  const configReader: PluginConfigReader = (() => {
    /*
     * 合并顺序与后台设置表单**必须完全一致**（settings → settingsSchema 默认值
     * → 数据库覆盖），否则会出现"后台显示 X、插件实际读到 Y"的错位。
     * 因此这里直接复用 resolvePluginSettings，而不是只合并 manifest.settings。
     */
    const overrides = deps.pluginSettings.get(pluginId) ?? {};
    const merged: Record<string, unknown> = resolvePluginSettings(plugin.manifest, overrides);
    return {
      get<T>(key: string, fallback: T): T {
        const value = merged[key];
        return value === undefined ? fallback : (value as T);
      },
      all(): Record<string, unknown> {
        return { ...merged };
      }
    };
  })();

  const context: PluginContext = {
    manifest: plugin.manifest,
    logger,
    config: configReader,
    db: capabilities.has('database:own') ? deps.db.forPlugin(pluginId) : deniedDatabase(pluginId),
    services: {
      provide<T>(descriptor: ServiceDescriptor<T>): Dispose {
        if (!capabilities.has('services:provide')) {
          throw forbidden(pluginId, 'services:provide', 'ctx.services.provide');
        }
        return track(deps.services.provide(pluginId, descriptor as ServiceDescriptor));
      },
      use<T>(name: string): T {
        if (!capabilities.has('services:consume')) {
          throw forbidden(pluginId, 'services:consume', 'ctx.services.use');
        }
        return deps.services.use<T>(name);
      },
      tryUse<T>(name: string): T | undefined {
        if (!capabilities.has('services:consume')) return undefined;
        return deps.services.tryUse<T>(name);
      },
      has(name: string): boolean {
        return deps.services.has(name);
      },
      list(): string[] {
        return deps.services.list();
      }
    },
    events: {
      on<T = unknown>(
        eventName: string,
        handler: EventHandler<T>,
        options?: { priority?: number }
      ): Unsubscribe {
        if (!capabilities.has('events:subscribe')) {
          throw forbidden(pluginId, 'events:subscribe', 'ctx.events.on');
        }
        return track(deps.events.on(pluginId, eventName, handler, options));
      },
      async emit<T = unknown>(eventName: string, payload: T, requestId?: string): Promise<void> {
        if (!capabilities.has('events:publish')) {
          throw forbidden(pluginId, 'events:publish', 'ctx.events.emit');
        }
        await deps.events.emit(eventName, payload, { source: pluginId, ...(requestId ? { requestId } : {}) });
      },
      list() {
        return deps.events.list();
      }
    },
    routes: {
      page(spec: PageRouteSpec): Dispose {
        if (!capabilities.has('routes:public')) {
          throw forbidden(pluginId, 'routes:public', 'ctx.routes.page');
        }
        return track(deps.router.registerPage(pluginId, spec));
      },
      raw(spec: RawRouteSpec): Dispose {
        const required: PluginCapability = spec.capability === 'routes:admin' ? 'routes:admin' : 'routes:public';
        if (!capabilities.has(required)) {
          throw forbidden(pluginId, required, 'ctx.routes.raw');
        }
        return track(deps.router.registerRaw(pluginId, spec));
      },
      adminApi(spec: AdminRouteSpec): Dispose {
        if (!capabilities.has('routes:admin')) {
          throw forbidden(pluginId, 'routes:admin', 'ctx.routes.adminApi');
        }
        // 登记"用到的权限点"（鉴权仍由网关按标识字符串比对，不依赖声明）
        deps.permissions.track(spec.permission, pluginId, 'admin-api');
        return track(deps.router.registerAdminApi(pluginId, spec));
      }
    },
    slots: {
      register(
        slotName: string,
        component: SlotComponent,
        options?: { priority?: number }
      ): Dispose {
        if (!capabilities.has('slots:register')) {
          throw forbidden(pluginId, 'slots:register', 'ctx.slots.register');
        }
        return track(deps.slots.register(pluginId, slotName, component, options));
      },
      list() {
        return deps.slots.list();
      }
    },
    extensions: {
      declare(point: ExtensionPointDeclaration): Dispose {
        if (!capabilities.has('extensions:declare')) {
          throw forbidden(pluginId, 'extensions:declare', 'ctx.extensions.declare');
        }
        return track(deps.extensions.declare(pluginId, point));
      },
      contribute(
        point: string,
        payload: unknown,
        options?: ExtensionContributeOptions
      ): Dispose {
        if (!capabilities.has('extensions:contribute')) {
          throw forbidden(pluginId, 'extensions:contribute', 'ctx.extensions.contribute');
        }
        // 命令式贡献没有清单文件可审计，因此显式标注来源插件，便于后台与日志定位
        return track(
          deps.extensions.contribute(pluginId, point, payload, {
            ...options,
            scope: options?.scope ?? 'render'
          })
        );
      },
      apply<T>(point: string, payload: T, options?: ExtensionApplyOptions): Promise<T> {
        return deps.extensions.apply(point, payload, options);
      },
      list() {
        return deps.extensions.list();
      }
    },
    adminMenu: {
      add(item: AdminMenuItem): Dispose {
        if (!capabilities.has('admin:menu')) {
          throw forbidden(pluginId, 'admin:menu', 'ctx.adminMenu.add');
        }
        deps.permissions.track(item.permission, pluginId, 'admin-menu');
        return track(deps.adminMenu.add(pluginId, item));
      },
      list() {
        return deps.adminMenu.list();
      }
    },
    // 动态取值：站点信息可在不重启的前提下被后台修改
    get site(): SiteInfo {
      return deps.site();
    }
  };

  return {
    context,
    disposers,
    pendingDisposers: () => disposers.length
  };
}

/** 类型守卫：请求对象是否携带已认证访客。 */
export function hasViewer(request: HttpRequestLike): boolean {
  return request.viewer !== undefined;
}

/** 供 Slot 组件复用的上下文构造（保持插件签名稳定）。 */
export function slotContext(
  kind: string,
  data: Record<string, unknown>,
  request?: HttpRequestLike
): SlotRenderContext {
  return {
    kind,
    data,
    ...(request ? { request } : {})
  };
}

/** 插件模块导出类型（供 Manager 使用）。 */
export type PluginModule = Plugin;
