/** 插件生命周期接口与定义辅助函数。 */

import type { PluginContext } from './context.js';

export interface Plugin {
  /**
   * 安装期调用一次：注册迁移、声明服务、准备静态资源。
   * 此时尚不接收请求。
   */
  setup?(context: PluginContext): void | Promise<void>;
  /**
   * 启用期调用：注册路由、订阅事件、注册 Slot。
   * 集成测试会断言 stop() 后这些注册项全部不可见。
   */
  start?(context: PluginContext): void | Promise<void>;
  /**
   * 停用期调用：必须调用全部 Dispose / Unsubscribe 句柄。
   * 受控重启模式下不保证 Fastify 路由热卸载（ADR-004），
   * 但必须保证注册表状态干净。
   */
  stop?(context: PluginContext): void | Promise<void>;
}

/** 定义插件并保留类型推导。 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
