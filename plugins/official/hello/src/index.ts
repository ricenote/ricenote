/**
 * Hello 示例插件。
 *
 * 演示插件 API 的四个要点：
 * 1. 通过 `ctx.services.provide` 发布能力契约；
 * 2. 通过 `ctx.routes.raw` 注册公开路由；
 * 3. 通过 `ctx.events.on/emit` 参与事件流；
 * 4. 通过 `ctx.adminMenu.add` 贡献后台菜单项。
 *
 * 所有注册方法返回的句柄都由 Core 自动收集，`stop()` 时统一注销（ADR-004）。
 */

import { definePlugin } from '@ricenote/plugin-sdk';
import type { ServiceDescriptor } from '@ricenote/plugin-sdk';

export interface HelloService {
  greet(name: string): string;
  startedAt: string;
}

export default definePlugin({
  start(ctx) {
    const startedAt = new Date().toISOString();

    const service: HelloService = {
      greet: (name: string) => `你好，${name}！这里是 RiceNote 的 Hello 插件。`,
      startedAt
    };

    ctx.services.provide<HelloService>({
      name: 'demo.hello@1',
      version: ctx.manifest.version,
      implementation: service
    } as ServiceDescriptor<HelloService>);

    ctx.routes.raw({
      method: 'GET',
      path: '/hello',
      handler: async (request, reply) => {
        const name = typeof request.query.name === 'string' ? request.query.name : '世界';
        reply.header('cache-control', 'no-store');
        reply.json({
          ok: true,
          plugin: ctx.manifest.id,
          version: ctx.manifest.version,
          startedAt,
          message: service.greet(name),
          requestId: request.requestId
        });
      }
    });

    ctx.events.on<{ requestId?: string }>('core.hello.ping.v1', (payload) => {
      ctx.logger.info('收到 ping 事件', { payload });
    });

    ctx.adminMenu.add({
      id: 'demo.hello',
      label: 'Hello 示例',
      path: '/hello',
      icon: 'Sparkles',
      order: -10,
      permission: 'plugin.view'
    });

    ctx.logger.info('Hello 插件已就绪', { route: '/hello', api: 'demo.hello@1' });
  },

  stop(ctx) {
    ctx.logger.info('Hello 插件已停止，注册项将由 Core 统一注销');
  }
});
