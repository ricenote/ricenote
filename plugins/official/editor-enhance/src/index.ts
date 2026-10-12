/**
 * editor-enhance 插件（编辑增强）的**服务端空实现**。
 *
 * 为什么是空的：
 * - 本插件的全部能力都在 `manifest.contributions` 里（六条 admin 作用域贡献），
 *   由 Core 在插件**启用**后把浏览器模块下发给后台界面；服务端不需要注册路由、
 *   服务或表结构，因此这里没有 `ctx.routes` / `ctx.services` 调用；
 * - 仍然保留一个真实入口（`./dist/index.js`）：manifest 的 `entry` 是插件被发现、
 *   被构建、被校验的前提，缺它 `pnpm validate` / `pnpm build` 都会失败。
 *
 * 契约：不新增任何依赖（Toast UI 是静态 vendor 文件，不进 package.json 依赖）。
 */

import { definePlugin } from '@ricenote/plugin-sdk';

export default definePlugin({
  async start(ctx) {
    // 只留一行可观测日志：排查"插件明明启用了但界面没变化"时，先看这里有没有打出来
    ctx.logger.info('editor-enhance 插件已就绪（能力全部来自声明式贡献）');
  },

  async stop(ctx) {
    // 无需清理：服务端没有注册任何路由 / 服务 / 事件
    ctx.logger.info('editor-enhance 插件已停止');
  }
});
