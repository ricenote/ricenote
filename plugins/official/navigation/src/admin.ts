/**
 * navigation 插件的管理 API。
 *
 * 权限点：`nav.view`（读取）/ `nav.manage`（写入）。
 * 路由前缀 `/api/admin/navigation`，由 Core 的守卫统一执行
 * 认证 → CSRF → 权限 → 审计（见 apps/server 的 guard）。
 */

import type { PluginContext } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  type ContentNavigationService,
  type NavItemSaveRequest
} from '@ricenote/shared';

export function registerAdminRoutes(
  ctx: PluginContext,
  deps: { service: ContentNavigationService }
): void {
  const { service } = deps;

  /** 全部导航项（含停用），带目标解析状态。 */
  ctx.routes.adminApi({
    method: 'GET',
    path: '/navigation/items',
    permission: 'nav.view',
    handler: async (_request, reply) => {
      const items = await service.listForAdmin();
      reply.json({ data: items, total: items.length });
    }
  });

  /** 新建。 */
  ctx.routes.adminApi({
    method: 'POST',
    path: '/navigation/items',
    permission: 'nav.manage',
    handler: async (request, reply) => {
      const result = await service.save({ payload: readPayload(request.body) });
      reply.statusCode = 201;
      reply.json({ data: result });
    }
  });

  /** 更新。 */
  ctx.routes.adminApi({
    method: 'PUT',
    path: '/navigation/items/:itemId',
    permission: 'nav.manage',
    handler: async (request, reply) => {
      const result = await service.save({
        id: parseId(request.params.itemId),
        payload: readPayload(request.body)
      });
      reply.json({ data: result });
    }
  });

  /** 删除。 */
  ctx.routes.adminApi({
    method: 'DELETE',
    path: '/navigation/items/:itemId',
    permission: 'nav.manage',
    handler: async (request, reply) => {
      const id = parseId(request.params.itemId);
      await service.remove(id);
      reply.json({ data: { id, removed: true } });
    }
  });

  /** 上移 / 下移一位（返回调整后的完整列表，前端无需自己重排）。 */
  ctx.routes.adminApi({
    method: 'POST',
    path: '/navigation/items/:itemId/move',
    permission: 'nav.manage',
    handler: async (request, reply) => {
      const id = parseId(request.params.itemId);
      const raw = (request.body ?? {}) as Record<string, unknown>;
      const direction = raw.direction === 'down' ? 'down' : raw.direction === 'up' ? 'up' : undefined;
      if (!direction) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, 'direction 必须是 up 或 down', {
          status: 400
        });
      }
      const items = await service.move({ id, direction });
      reply.json({ data: items, total: items.length });
    }
  });

  /** 目标选择器的候选项（已发布的页面 / 文章）。 */
  ctx.routes.adminApi({
    method: 'GET',
    path: '/navigation/targets',
    permission: 'nav.view',
    handler: async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      if (query.type !== 'page' && query.type !== 'post') {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, 'type 必须是 page 或 post', {
          status: 400
        });
      }
      const keyword = query.keyword?.trim();
      const options = await service.targets({
        type: query.type,
        ...(keyword ? { keyword } : {})
      });
      reply.json({ data: options, total: options.length });
    }
  });
}

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '导航项 ID 非法', { status: 400 });
  }
  return id;
}

/** 把请求体收敛为保存载荷（只取已知字段，避免写入意外字段）。 */
function readPayload(body: unknown): NavItemSaveRequest {
  const raw = (body ?? {}) as Record<string, unknown>;
  return {
    type: raw.type as NavItemSaveRequest['type'],
    ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
    ...(typeof raw.href === 'string' ? { href: raw.href } : {}),
    ...(raw.refId === undefined ? {} : { refId: Number(raw.refId) }),
    ...(raw.newTab === undefined ? {} : { newTab: Boolean(raw.newTab) }),
    ...(raw.enabled === undefined ? {} : { enabled: Boolean(raw.enabled) })
  };
}
