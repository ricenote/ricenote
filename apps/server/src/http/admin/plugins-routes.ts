/**
 * 扩展中心 API：插件列表、启停、配置与依赖信息。
 *
 * 权限点：`plugin.view` / `plugin.manage`。
 *
 * 注意（ADR-004）：启停写库后需**重启进程**才能让路由变更生效，
 * 因此响应中显式返回 `restartRequired`，由前端提示用户。
 */

import type { FastifyInstance } from 'fastify';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import type { RiceNoteKernel } from '@ricenote/core';
import { guard } from './guard.js';

export function registerPluginRoutes(app: FastifyInstance, kernel: RiceNoteKernel): void {
  /** 插件列表 + 诊断信息。 */
  app.get(
    '/plugins',
    guard(kernel, { permission: 'plugin.view' }, async ({ kernel: k, reply }) => {
      const items = k.plugins.summary();
      return reply.send({
        data: items,
        total: items.length,
        page: 1,
        pageSize: items.length,
        diagnostics: {
          invalid: k.plugins.getInvalidPlugins().map((item) => ({
            dir: item.dir,
            id: item.id ?? null,
            issues: item.issues
          })),
          dependencyProblems: k.plugins.getDependencyProblems(),
          coreApiVersion: k.plugins.getCoreApiVersion()
        }
      });
    })
  );

  /** 启用插件。 */
  app.post(
    '/plugins/:pluginId/enable',
    guard(kernel, { permission: 'plugin.manage' }, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const { pluginId } = request.params as { pluginId: string };
      const result = await k.plugins.enable(pluginId);

      await k.audit.record({
        action: 'plugin.enable',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'plugin',
        targetId: pluginId,
        ip,
        requestId
      });

      return reply.send({ data: { pluginId, enabled: true, restartRequired: result.restartRequired } });
    })
  );

  /** 禁用插件（存在已启用反向依赖时拒绝）。 */
  app.post(
    '/plugins/:pluginId/disable',
    guard(kernel, { permission: 'plugin.manage' }, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const { pluginId } = request.params as { pluginId: string };
      const result = await k.plugins.disable(pluginId);

      k.cache.clear();

      await k.audit.record({
        action: 'plugin.disable',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'plugin',
        targetId: pluginId,
        ip,
        requestId
      });

      return reply.send({ data: { pluginId, enabled: false, restartRequired: result.restartRequired } });
    })
  );

  /** 读取插件配置。 */
  app.get(
    '/plugins/:pluginId/settings',
    guard(kernel, { permission: 'plugin.view' }, async ({ kernel: k, request, reply }) => {
      const { pluginId } = request.params as { pluginId: string };
      const known = k.plugins.summary().some((item) => item.id === pluginId);
      if (!known) {
        throw new RiceNoteError(ErrorCode.PLUGIN_NOT_FOUND, `插件不存在：${pluginId}`, { status: 404 });
      }
      const values = await k.plugins.readSettings(pluginId);
      return reply.send({ data: { pluginId, values } });
    })
  );

  /** 保存插件配置。 */
  app.put(
    '/plugins/:pluginId/settings',
    guard<{ values: Record<string, unknown> }>(
      kernel,
      { permission: 'plugin.manage' },
      async ({ kernel: k, request, reply, body, auth, ip, requestId }) => {
        const { pluginId } = request.params as { pluginId: string };
        const known = k.plugins.summary().some((item) => item.id === pluginId);
        if (!known) {
          throw new RiceNoteError(ErrorCode.PLUGIN_NOT_FOUND, `插件不存在：${pluginId}`, { status: 404 });
        }

        const values = body?.values ?? {};
        const result = await k.plugins.writeSettings(pluginId, k.config.site.id, values);

        await k.audit.record({
          action: 'plugin.settings.update',
          actorId: auth.user.id,
          actorName: auth.user.username,
          targetType: 'plugin',
          targetId: pluginId,
          ip,
          requestId,
          detail: { revision: result.revision, fields: Object.keys(values).length }
        });

        return reply.send({ data: { pluginId, revision: result.revision, values } });
      }
    )
  );
}
