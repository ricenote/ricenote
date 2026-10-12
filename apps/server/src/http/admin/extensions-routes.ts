/**
 * 后台扩展点下发：把"当前生效的 admin 作用域扩展点与贡献"交给后台 SPA。
 *
 * 三条**服务端**过滤是不可绕过的安全边界（前端隐藏不算数）：
 * 1. 只下发**已启动**的插件（停用/启动失败 = 贡献消失，无需前端判断）；
 * 2. 只下发 `scope === 'admin'` 的贡献（render/server 与后台界面无关）；
 * 3. 按当前用户权限过滤（`contributions[].permission`，超级管理员 `*` 全放行）。
 *
 * 裁决（`replace` 胜出者）在内核注册表里完成，因此这里下发的就是最终生效集合，
 * 前端只负责渲染 —— 少一处双份实现，就少一处两边裁决不一致的机会。
 */

import type { FastifyInstance } from 'fastify';
import type {
  AdminExtensionContributionDto,
  AdminExtensionPointDto
} from '@ricenote/shared';
import { pluginAdminEntryUrl, type RiceNoteKernel } from '@ricenote/core';
import { guard } from './guard.js';

export function registerExtensionRoutes(app: FastifyInstance, kernel: RiceNoteKernel): void {
  app.get(
    '/extensions',
    guard(kernel, {}, async ({ kernel: k, reply, auth }) => {
      const user = await k.gateway.describeUser(auth);
      const permissions = user.permissions.includes('*') ? undefined : user.permissions;
      const allowed = (permission?: string): boolean =>
        permission === undefined || permissions === undefined || permissions.includes(permission);

      const points: AdminExtensionPointDto[] = k.extensions
        .declaredPoints('admin')
        .filter((entry) => k.plugins.isStarted(entry.providerId))
        .map((entry) => ({
          name: entry.name,
          provider: entry.providerId,
          replaceable: entry.replaceable,
          ...(entry.description ? { description: entry.description } : {}),
          ...(entry.props ? { props: entry.props } : {})
        }));

      const contributions: AdminExtensionContributionDto[] = [];
      for (const summary of k.extensions.list()) {
        if (summary.scope !== 'admin') continue;
        for (const entry of k.extensions.effective(summary.point, 'admin')) {
          if (!k.plugins.isStarted(entry.consumerId)) continue;

          /*
           * 命令式贡献（ctx.extensions.contribute）没有 meta：它没有"入口文件"
           * 可供浏览器 import，因此后台作用域只支持声明式贡献，这里跳过并留痕，
           * 避免出现"贡献了却永远不显示"的静默黑洞。
           */
          const meta = entry.meta;
          if (!meta) {
            k.logger.debug('admin 作用域的命令式贡献没有入口模块，已跳过后台下发', {
              point: entry.point,
              plugin: entry.consumerId
            });
            continue;
          }
          if (!allowed(meta.permission)) continue;

          contributions.push({
            point: entry.point,
            pluginId: entry.consumerId,
            mode: entry.mode,
            order: entry.order,
            entryUrl: String(entry.payload),
            ...(meta.style ? { styleUrl: pluginAdminEntryUrl(entry.consumerId, meta.style) } : {}),
            ...(meta.label ? { label: meta.label } : {})
          });
        }
      }

      return reply.send({ data: { points, contributions } });
    })
  );
}
