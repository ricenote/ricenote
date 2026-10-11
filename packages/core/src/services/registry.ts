/**
 * 服务注册表：跨插件调用的唯一合法通道。
 *
 * 规则：
 * - 契约名（通常是 capability 契约）全局唯一，重复注册直接报错；
 * - 插件被停用时必须调用 `Dispose` 注销，否则集成测试会判定为泄漏；
 * - 服务调用是**同步语义**（返回 Promise 也由调用方 await），用于"我要立即知道"的场景。
 */

import type { Dispose, ServiceDescriptor } from '@ricenote/plugin-sdk';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';

interface ServiceEntry {
  descriptor: ServiceDescriptor;
  owner: string;
  registeredAt: number;
}

export class ServiceRegistry {
  private readonly entries = new Map<string, ServiceEntry>();

  /** 发布服务。 */
  provide(owner: string, descriptor: ServiceDescriptor): Dispose {
    const existing = this.entries.get(descriptor.name);
    if (existing) {
      throw new RiceNoteError(
        ErrorCode.SERVICE_DUPLICATE,
        `服务契约已被占用：${descriptor.name}（提供者：${existing.owner}）`,
        { status: 409, details: { name: descriptor.name, owner: existing.owner } }
      );
    }

    const entry: ServiceEntry = { descriptor, owner, registeredAt: Date.now() };
    this.entries.set(descriptor.name, entry);

    return () => {
      const current = this.entries.get(descriptor.name);
      // 仅当仍是本实例注册的条目时才删除，避免误删后来者的注册
      if (current && current.registeredAt === entry.registeredAt) {
        this.entries.delete(descriptor.name);
      }
    };
  }

  /** 获取服务实现；不存在时抛出领域错误。 */
  use<T>(name: string): T {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new RiceNoteError(ErrorCode.SERVICE_NOT_FOUND, `服务不可用：${name}`, {
        status: 503,
        details: { name, available: this.list() }
      });
    }
    return entry.descriptor.implementation as T;
  }

  /** 尝试获取服务；不存在返回 undefined（用于优雅降级）。 */
  tryUse<T>(name: string): T | undefined {
    const entry = this.entries.get(name);
    return entry ? (entry.descriptor.implementation as T) : undefined;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(): string[] {
    return [...this.entries.keys()].sort();
  }

  /** 列出某插件提供的全部服务（用于停用前的影响分析）。 */
  ownedBy(owner: string): string[] {
    return [...this.entries.values()]
      .filter((entry) => entry.owner === owner)
      .map((entry) => entry.descriptor.name)
      .sort();
  }

  /** 清空注册表（仅测试与关停时使用）。 */
  clear(): void {
    this.entries.clear();
  }
}
