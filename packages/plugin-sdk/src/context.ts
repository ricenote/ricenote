/** 插件运行时上下文：插件唯一的对外能力入口。 */

import type { PluginManifest } from '@ricenote/shared';
import type { PluginLogger } from './logger.js';
import type { PluginDatabase } from './database.js';
import type { RouteRegistryFacade } from './http.js';
import type { ServiceRegistryFacade, EventBusFacade } from './services.js';
import type { AdminMenuRegistry, SlotRegistryFacade } from './slots.js';

/** 插件可见的只读站点信息。 */
export interface SiteInfo {
  id: string;
  title: string;
  description: string;
  url: string;
  language: string;
}

/** 插件命名空间配置读取器（只读，值已由 Core 合并默认值）。 */
export interface PluginConfigReader {
  get<T>(key: string, fallback: T): T;
  all(): Record<string, unknown>;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly logger: PluginLogger;
  readonly config: PluginConfigReader;
  readonly db: PluginDatabase;
  readonly services: ServiceRegistryFacade;
  readonly events: EventBusFacade;
  readonly routes: RouteRegistryFacade;
  readonly slots: SlotRegistryFacade;
  readonly adminMenu: AdminMenuRegistry;
  readonly site: SiteInfo;
}
