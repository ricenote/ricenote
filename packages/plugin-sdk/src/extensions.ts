/**
 * 命名扩展点契约（v1.x 新增）：**声明 — 贡献 — 渲染/触发**。
 *
 * 与 `ctx.slots` 的关系：`slots` 是**渲染作用域的别名**（历史 API，继续可用）。
 * 扩展点把同一套模型推广到三个作用域，让插件不仅"往主题里塞片段"，
 * 还能暴露自己的挂载点供别的插件接入：
 *
 * | 作用域 | payload 形状 | 谁渲染/触发 |
 * | --- | --- | --- |
 * | `render` | `SlotComponent`（`{ name, render(context) }`） | Core 渲染管线（模板 `slot()` helper） |
 * | `admin` | **浏览器可 import 的 ESM 模块 URL 字符串** | 后台 SPA 的 `PluginSlot` 组件 |
 * | `server` | `ExtensionHookModule`（`{ apply(payload, ctx) }`） | 提供方插件在自己的流程里 `ctx.extensions.apply()` |
 *
 * payload 形状**按作用域而异**，注册表本身不解释它 —— 这一点必须在插件文档里写清楚，
 * 否则贡献者会把三种形状写混。
 */

import type { Dispose, PluginLogger } from './logger.js';
import type {
  ExtensionMode,
  ExtensionPointProp,
  ExtensionScope,
  PluginExtensionContributionDeclaration,
  PluginExtensionPointDeclaration
} from '@ricenote/shared';

/*
 * 清单层的声明形状由 `@ricenote/shared` 定义（清单校验与运行时必须共用一份），
 * 这里以插件作者熟悉的命名再导出，并补上运行时（hook 模块 / 门面）的类型。
 */
export type {
  ExtensionScope,
  ExtensionMode,
  ExtensionPointProp,
  PluginExtensionContributionDeclaration as ExtensionContributionDeclaration,
  PluginExtensionPointDeclaration as ExtensionPointDeclaration
};

/** 服务端钩子贡献模块的契约（默认导出或具名导出 apply 均可）。 */
export interface ExtensionHookModule<T = unknown> {
  name?: string;
  /** 接收上一版 payload，返回修改后的 payload（filter 语义）。 */
  apply(payload: T, context: ExtensionHookContext): Promise<T> | T;
}

/** 服务端钩子执行上下文。 */
export interface ExtensionHookContext {
  point: string;
  /** 贡献方插件 ID。 */
  pluginId: string;
  logger: PluginLogger;
}

/** 服务端钩子的错误策略：`abort`（默认，响亮失败）或 `skip`（记日志后沿用上一版 payload）。 */
export type ExtensionErrorPolicy = 'abort' | 'skip';

export interface ExtensionContributeOptions {
  /** 缺省 `render`（与历史 `ctx.slots.register` 一致）。 */
  scope?: ExtensionScope;
  mode?: ExtensionMode;
  order?: number;
}

export interface ExtensionApplyOptions {
  /** 缺省 `abort`：贡献抛错即上抛，避免把未经验证的数据写进库。 */
  onError?: ExtensionErrorPolicy;
}

/** 一个扩展点的诊断摘要（`ctx.extensions.list()`）。 */
export interface ExtensionPointSummary {
  point: string;
  scope: ExtensionScope;
  /** 声明者（提供方）；标准渲染插槽为 `core`。 */
  provider: string;
  contributions: number;
}

/** `ctx.extensions` 门面：命令式声明与贡献（声明式之外的动态路径）。 */
export interface ExtensionRegistryFacade {
  declare(point: ExtensionPointDeclaration): Dispose;
  contribute(point: string, payload: unknown, options?: ExtensionContributeOptions): Dispose;
  /**
   * 触发服务端钩子：按 `order` **升序**串行传递 payload（filter 语义）。
   *
   * 刻意**不需要**额外能力：`apply` 是提供方在自己的流程里运行"别人声明要参与的钩子"，
   * 真正的风险面在**贡献**侧（执行他人代码），因此那里才做能力门控。
   */
  apply<T>(point: string, payload: T, options?: ExtensionApplyOptions): Promise<T>;
  list(): ExtensionPointSummary[];
}
