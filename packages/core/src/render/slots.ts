/**
 * 渲染期插槽（render 作用域）—— **命名扩展点注册表的门面**。
 *
 * 这层门面存在的唯一理由是**向后兼容**：`ctx.slots.register` 与 `SlotRegistry`
 * 的方法签名自 v1 起就对外承诺稳定，第三方插件（如 reading-time）与主题渲染路径
 * 都依赖它。内部实现已全部委托给 `ExtensionRegistry`，因此"插槽"与"扩展点"
 * 不再有两套注册表，`replace` 语义、权限过滤与零残留断言也就天然一致。
 *
 * 关键性质保持不变：
 * - 按 `order`（原 `priority`）降序渲染；
 * - **单组件错误隔离**：某个组件的 `render()` 抛错时降级为空片段并记日志，
 *   绝不让整页渲染失败；
 * - 插件被禁用后其插槽自动消失，主题无需改动。
 */

import type { Dispose, SlotComponent, SlotRenderContext } from '@ricenote/plugin-sdk';
import type { Logger } from '../logger.js';
import type { ExtensionRegistry } from '../extensions/registry.js';

/** 兼容既有调用方（渲染诊断）的内部形状。 */
interface RegisteredSlotComponent {
  pluginId: string;
  slot: string;
  component: SlotComponent;
  priority: number;
  sequence: number;
}

export class SlotRegistry {
  constructor(
    private readonly extensions: ExtensionRegistry,
    private readonly logger: Logger
  ) {}

  /** 等价于"向 render 作用域的该扩展点做一次 append 贡献"。 */
  register(
    pluginId: string,
    slot: string,
    component: SlotComponent,
    options?: { priority?: number }
  ): Dispose {
    return this.extensions.contribute(pluginId, slot, component, {
      scope: 'render',
      mode: 'append',
      order: options?.priority ?? 0
    });
  }

  /** 列出某插槽的全部组件（已按 order 降序、同序按注册顺序）。 */
  componentsFor(slot: string): RegisteredSlotComponent[] {
    return this.extensions.effective(slot, 'render').map((entry) => ({
      pluginId: entry.consumerId,
      slot: entry.point,
      component: entry.payload as SlotComponent,
      priority: entry.order,
      sequence: entry.sequence
    }));
  }

  /**
   * 渲染一个插槽为 HTML 片段。
   *
   * 组件异常被捕获、记录并跳过；存在 `replace` 贡献时，只渲染胜出者
   * （默认内容与其他追加贡献都不输出 —— 这正是"替换掉默认区块"的语义）。
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
    for (const summary of this.extensions.list()) {
      if (summary.scope !== 'render') continue;
      const components = this.componentsFor(summary.point).map(
        (entry) => `${entry.component.name}@${entry.pluginId}`
      );
      if (components.length === 0) continue;
      grouped.set(summary.point, components.sort());
    }
    return [...grouped.entries()]
      .map(([slot, components]) => ({ slot, components }))
      .sort((left, right) => left.slot.localeCompare(right.slot));
  }

  /** 列出某插件注册的插槽（停用前影响分析与零残留断言）。 */
  ownedBy(pluginId: string): string[] {
    return this.extensions.contributionsOwnedBy(pluginId, 'render');
  }

  clear(): void {
    this.extensions.clear('render');
  }
}
