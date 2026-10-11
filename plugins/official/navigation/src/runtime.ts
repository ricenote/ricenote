/**
 * navigation 插件的运行时容器。
 *
 * 与 pages / posts 的约定一致：
 * - Core 提供的 `core.html@1`（转义）与 `core.theme@1`（缓存失效）在 `start()` 中一次性取用；
 * - **可选依赖**（pages / posts）在请求期惰性解析：它们被禁用时导航仍要能工作
 *   （只剩自定义链接），而不是启动失败或 500。
 */

import type { PluginDatabase, PluginLogger } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type ContentPagesService,
  type ContentPostsService,
  type CoreHtmlService,
  type CoreThemeService,
  type NavItemType
} from '@ricenote/shared';

export interface RuntimeServiceResolver {
  tryUse<T>(name: string): T | undefined;
}

export interface NavigationRuntime {
  db: PluginDatabase;
  siteId: string;
  /** 前台最多渲染多少项（插件设置 `maxItems`）。 */
  maxItems: number;
  html: CoreHtmlService;
  theme: CoreThemeService;
  logger: PluginLogger;
  services: RuntimeServiceResolver;
}

/** 惰性解析页面服务（pages 插件未启用时为 undefined）。 */
export function pagesOf(runtime: NavigationRuntime): ContentPagesService | undefined {
  return runtime.services.tryUse<ContentPagesService>(SERVICE_CONTRACTS.CONTENT_PAGES);
}

/** 惰性解析文章服务（posts 插件未启用时为 undefined）。 */
export function postsOf(runtime: NavigationRuntime): ContentPostsService | undefined {
  return runtime.services.tryUse<ContentPostsService>(SERVICE_CONTRACTS.CONTENT_POSTS);
}

/** `page` / `post` 这类"引用内容"的类型（不含自定义链接）。 */
export type ContentItemType = Exclude<NavItemType, 'custom'>;

/** 目标解析结果：前台地址与标题（仅在目标已发布时存在）。 */
export interface ResolvedTarget {
  title: string;
  url: string;
}
