/**
 * Outbox 接口（M2 仅保留契约与内存实现）。
 *
 * 背景：内存事件总线无法保证事件不丢。需要"至少一次投递"的场景
 * （通知、搜索索引、Webhook）必须走"业务写入 + outbox 记录"同事务，
 * 再由 Worker 轮询投递并保证消费者幂等。
 *
 * M2 范围仅提供接口与内存实现，便于插件提前按此契约编码；
 * 持久化实现（`rn_outbox` 表 + Worker）在 M4 交付。
 */

export interface OutboxMessage<T = unknown> {
  /** 消息 ID，消费者据此实现幂等。 */
  id: string;
  /** 事件名，与 EventBus 命名一致，例如 `content.post.published.v1`。 */
  event: string;
  payload: T;
  createdAt: string;
  attempts: number;
}

export interface Outbox {
  /** 入队一条消息（M4 实现需与业务写入处于同一事务）。 */
  enqueue<T>(event: string, payload: T): Promise<string>;
  /** 拉取待投递消息（Worker 使用）。 */
  pending(limit: number): Promise<OutboxMessage[]>;
  /** 标记投递成功。 */
  ack(id: string): Promise<void>;
  /** 标记投递失败（增加重试计数）。 */
  nack(id: string, reason: string): Promise<void>;
}

/** 内存实现：仅用于开发与测试，进程重启即丢失。 */
export class InMemoryOutbox implements Outbox {
  private readonly messages = new Map<string, OutboxMessage>();
  private sequence = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async enqueue<T>(event: string, payload: T): Promise<string> {
    const id = `mem-${++this.sequence}`;
    this.messages.set(id, {
      id,
      event,
      payload,
      createdAt: this.now().toISOString(),
      attempts: 0
    });
    return id;
  }

  async pending(limit: number): Promise<OutboxMessage[]> {
    return [...this.messages.values()].slice(0, Math.max(0, limit));
  }

  async ack(id: string): Promise<void> {
    this.messages.delete(id);
  }

  async nack(id: string, reason: string): Promise<void> {
    const message = this.messages.get(id);
    if (!message) return;
    message.attempts += 1;
    // 内存实现不保留失败原因，交由调用方日志记录
    void reason;
  }
}
