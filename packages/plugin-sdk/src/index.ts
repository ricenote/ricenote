/**
 * @ricenote/plugin-sdk —— 插件作者唯一需要依赖的稳定接口包。
 *
 * 契约稳定性承诺：本包导出的接口在 Plugin API v1 生命周期内保持向后兼容；
 * 新增能力以可选字段方式引入，破坏性变更需提升主版本并同步 docs/plugin-api/v1.md。
 */

export type { PluginLogger, Dispose, Unsubscribe } from './logger.js';
export type {
  ViewerContext,
  HttpRequestLike,
  HttpResponseLike,
  RouteHandler,
  HttpMethod,
  PageRouteSpec,
  PageViewModel,
  RawRouteSpec,
  AdminRouteSpec,
  RouteRegistryFacade
} from './http.js';
export type {
  ServiceDescriptor,
  ServiceRegistryFacade,
  EventMeta,
  EventHandler,
  EventSubscribeOptions,
  EventBusFacade
} from './services.js';
export type { ExecuteOutcome, PluginDatabase } from './database.js';
export {
  STANDARD_SLOTS,
  type StandardSlot,
  type SlotRenderContext,
  type SlotComponent,
  type SlotRegisterOptions,
  type SlotRegistryFacade,
  type AdminMenuItem,
  type AdminMenuRegistry
} from './slots.js';
export type { SiteInfo, PluginConfigReader, PluginContext } from './context.js';
export { definePlugin, type Plugin } from './plugin.js';

/** 当前 Plugin API 主版本，与 Manifest 的 apiVersion 区间对齐。 */
export const PLUGIN_API_VERSION = '1.0.0';
