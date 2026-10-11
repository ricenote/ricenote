/**
 * Slot 注册表：插件 → 主题的展示注入通道。
 *
 * 关键性质：
 * - 按 `priority` 降序渲染，同优先级保持注册顺序；
 * - **单组件错误隔离**：某个插件的 Slot 组件抛错时降级为空片段，
 *   绝不因此让整页渲染失败；
 * - 插件被禁用后其 Slot 自动消失，主题无需改动。
 */

import type { Dispose, SlotComponent, SlotRenderContext } from '@ricenote/plugin-sdk';
import type { Logger } from '../logger.js';

interface RegisteredSlotComponent {
  pluginId: string;
  slot: string;
  component: SlotComponent;
  priority: number;
  sequence: number;
}

export class SlotRegistry {
  private readonly components: RegisteredSlotComponent[] = [];
  private sequence = 0;

  constructor(private readonly logger: Logger) {}

  register(
    pluginId: string,
    slot: string,
    component: SlotComponent,
    options?: { priority?: number }
  ): Dispose {
    const entry: RegisteredSlotComponent = {
      pluginId,
      slot,
      component,
      priority: options?.priority ?? 0,
      sequence: ++this.sequence
    };
    this.components.push(entry);

    return () => {
      const index = this.components.indexOf(entry);
      if (index >= 0) this.components.splice(index, 1);
    };
  }

  /** 列出某插槽的全部组件（已排序）。 */
  componentsFor(slot: string): RegisteredSlotComponent[] {
    return this.components
      .filter((entry) => entry.slot === slot)
      .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
  }

  /**
   * 渲染一个插槽为 HTML 片段。
   * 组件异常被捕获、记录并跳过。
   */
  async render(slot: string, context: SlotRenderContext): Promise<string> {
    const entries = this.componentsFor(slot);
    if (entries.length === 0) return '';

    const fragments: string[] = [];
    for (const entry of entries) {
      try {
        const html = await entry.component.render(context);
        if (typeof html === 'string' && html.length > 0) {
          fragments.push(html);
        }
      } catch (error) {
        this.logger.error('Slot 组件渲染失败（已降级为空片段）', {
          slot,
          plugin: entry.pluginId,
          component: entry.component.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return fragments.join('\n');
  }

  list(): { slot: string; components: string[] }[] {
    const grouped = new Map<string, string[]>();
    for (const entry of this.components) {
      const bucket = grouped.get(entry.slot) ?? [];
      bucket.push(`${entry.component.name}@${entry.pluginId}`);
      grouped.set(entry.slot, bucket);
    }
    return [...grouped.entries()]
      .map(([slot, components]) => ({ slot, components: components.sort() }))
      .sort((left, right) => left.slot.localeCompare(right.slot));
  }

  /** 列出某插件注册的插槽（停用前影响分析）。 */
  ownedBy(pluginId: string): string[] {
    return [...new Set(this.components.filter((entry) => entry.pluginId === pluginId).map((entry) => entry.slot))].sort();
  }

  clear(): void {
    this.components.length = 0;
  }
}
