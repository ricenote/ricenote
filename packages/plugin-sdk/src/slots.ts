/**
 * Slot（插槽）与后台菜单注册契约。
 *
 * Slot 让插件向主题的固定挂载点注入 HTML 片段；Core 负责按优先级排序、
 * 上下文校验与单组件错误隔离（单个组件异常降级为空片段）。
 */

import type { AdminMenuItem } from '@ricenote/shared';
import type { Dispose } from './logger.js';
import type { HttpRequestLike } from './http.js';

/** 后台菜单项契约由 `@ricenote/shared` 统一定义（同时作为 RPC 传输格式）。 */
export type { AdminMenuItem };

/** 说明书 7.7 定义的推荐标准 Slot。 */
export const STANDARD_SLOTS = [
  'head.end',
  'body.start',
  'body.end',
  'header.navigation',
  'sidebar.widgets',
  'post.beforeContent',
  'post.afterContent',
  'post.comments',
  'footer.widgets'
] as const;

export type StandardSlot = (typeof STANDARD_SLOTS)[number];

export interface SlotRenderContext {
  /** 触发渲染的请求（后台预览时可能为空）。 */
  request?: HttpRequestLike;
  /** 页面 ViewModel 的 data 部分。 */
  data: Record<string, unknown>;
  /** 页面类型（home / post / ...）。 */
  kind: string;
}

export interface SlotComponent {
  /** 组件唯一名称，用于后台展示与调试。 */
  name: string;
  /** 渲染为受信任 HTML 片段（Core 会做安全检查）。 */
  render(context: SlotRenderContext): Promise<string> | string;
}

export interface SlotRegisterOptions {
  /** 排序优先级：数值越大越靠前，缺省 0。 */
  priority?: number;
}

export interface SlotRegistryFacade {
  register(slotName: string, component: SlotComponent, options?: SlotRegisterOptions): Dispose;
  list(): { slot: string; components: string[] }[];
}

export interface AdminMenuRegistry {
  add(item: AdminMenuItem): Dispose;
  list(): AdminMenuItem[];
}
