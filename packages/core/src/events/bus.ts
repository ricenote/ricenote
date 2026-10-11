/**
 * 事件总线。
 *
 * 语义：
 * - 订阅按 `priority` 降序执行，同优先级保持注册顺序（稳定排序）；
 * - **单个订阅抛错不会中断其他订阅**，错误被记录后继续；
 * - 事件总线不保证持久性，强一致场景请使用同步服务调用；
 * - 需要"不可丢"的事件请使用 Outbox（见 `outbox.ts`）。
 */

import type { EventHandler, EventMeta } from '@ricenote/plugin-sdk';
import { RiceNoteError } from '@ricenote/shared';
import type { Logger } from '../logger.js';

interface Subscription {
  id: number;
  event: string;
  handler: EventHandler<unknown>;
  priority: number;
  source: string;
}

export interface EmitFailure {
  event: string;
  source: string;
  message: string;
}

export class EventBus {
  private readonly subscriptions = new Map<string, Subscription[]>();
  private sequence = 0;

  constructor(private readonly logger: Logger) {}

  /**
   * 订阅事件。
   * @param source 订阅来源（插件 ID 或 `core`），用于日志与泄漏排查。
   */
  on<T = unknown>(
    source: string,
    eventName: string,
    handler: EventHandler<T>,
    options?: { priority?: number }
  ): () => void {
    const subscription: Subscription = {
      id: ++this.sequence,
      event: eventName,
      handler: handler as EventHandler<unknown>,
      priority: options?.priority ?? 0,
      source
    };

    const bucket = this.subscriptions.get(eventName) ?? [];
    bucket.push(subscription);
    bucket.sort((left, right) => right.priority - left.priority || left.id - right.id);
    this.subscriptions.set(eventName, bucket);

    return () => {
      const current = this.subscriptions.get(eventName);
      if (!current) return;
      const index = current.findIndex((item) => item.id === subscription.id);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.subscriptions.delete(eventName);
    };
  }

  /**
   * 发布事件并等待全部订阅完成。
   * 失败被收集而非抛出，保证一个插件的故障不会拖垮整条链路。
   */
  async emit<T = unknown>(
    name: string,
    payload: T,
    options: { source?: string; requestId?: string } = {}
  ): Promise<{ failures: EmitFailure[]; delivered: number }> {
    const bucket = this.subscriptions.get(name);
    const meta: EventMeta = {
      name,
      source: options.source ?? 'core',
      occurredAt: new Date().toISOString(),
      ...(options.requestId ? { requestId: options.requestId } : {})
    };

    if (!bucket || bucket.length === 0) {
      return { failures: [], delivered: 0 };
    }

    const failures: EmitFailure[] = [];
    // 复制一份，避免订阅者在回调中退订造成迭代错乱
    for (const subscription of [...bucket]) {
      try {
        await subscription.handler(payload, meta);
      } catch (error) {
        const message = error instanceof RiceNoteError ? `${error.code}: ${error.message}` : String(error);
        failures.push({ event: name, source: subscription.source, message });
        this.logger.error('事件订阅执行失败', {
          event: name,
          subscriber: subscription.source,
          error: message
        });
      }
    }

    return { failures, delivered: bucket.length - failures.length };
  }

  /** 列出所有事件名与订阅数（后台诊断用）。 */
  list(): { name: string; subscribers: number }[] {
    return [...this.subscriptions.entries()]
      .map(([name, bucket]) => ({ name, subscribers: bucket.length }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** 列出某来源的订阅（用于停用前的影响分析）。 */
  ownedBy(source: string): string[] {
    const names = new Set<string>();
    for (const [name, bucket] of this.subscriptions) {
      if (bucket.some((item) => item.source === source)) names.add(name);
    }
    return [...names].sort();
  }

  clear(): void {
    this.subscriptions.clear();
  }
}
