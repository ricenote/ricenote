/**
 * 服务注册表与事件总线门面。
 *
 * 跨插件调用只能通过"服务契约"进行，禁止直接 import 其他插件内部模块。
 */

import type { Dispose, Unsubscribe } from './logger.js';

export interface ServiceDescriptor<T = unknown> {
  /** 契约名，通常是 capability 契约，例如 `content.posts@1`。 */
  name: string;
  /** 实现版本（semver）。 */
  version: string;
  /** 服务实现对象。 */
  implementation: T;
}

export interface ServiceRegistryFacade {
  /** 发布服务；名称重复或版本冲突时报错。 */
  provide<T>(descriptor: ServiceDescriptor<T>): Dispose;
  /** 获取服务；不存在时抛出领域错误。 */
  use<T>(name: string): T;
  /** 尝试获取服务；不存在时返回 undefined。 */
  tryUse<T>(name: string): T | undefined;
  /** 判断服务是否可用（用于优雅降级）。 */
  has(name: string): boolean;
  /** 列出当前全部可用服务名。 */
  list(): string[];
}

export interface EventMeta {
  /** 事件名，例如 `content.post.published.v1`。 */
  name: string;
  /** 触发事件的插件 ID（Core 事件为 `core`）。 */
  source: string;
  /** 事件时间（ISO 8601）。 */
  occurredAt: string;
  /** 请求 ID（若由 HTTP 请求触发）。 */
  requestId?: string;
}

export interface EventHandler<T = unknown> {
  (payload: T, meta: EventMeta): void | Promise<void>;
}

export interface EventSubscribeOptions {
  /** 优先级：数值越大越先执行，缺省 0。 */
  priority?: number;
}

export interface EventBusFacade {
  /**
   * 订阅事件。返回取消订阅句柄。
   * 单个订阅抛错不会中断其他订阅，错误会被记录。
   */
  on<T = unknown>(
    eventName: string,
    handler: EventHandler<T>,
    options?: EventSubscribeOptions
  ): Unsubscribe;
  /** 发布事件（同步等待全部订阅完成）。 */
  emit<T = unknown>(eventName: string, payload: T, requestId?: string): Promise<void>;
  /** 列出所有已注册的事件名与订阅数。 */
  list(): { name: string; subscribers: number }[];
}
