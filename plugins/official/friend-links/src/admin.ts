/**
 * friend-links 插件的管理 API。
 *
 * 权限点：`link.view`（读取）/ `link.manage`（写入）。
 * 路由前缀 `/api/admin/friend-links`，由 Core 的守卫统一执行
 * 认证 → CSRF → 权限 → 审计（见 apps/server 的 guard）。
 */

import type { PluginContext } from '@ricenote/plugin-sdk';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import type { FriendLinksService } from './service.js';
import type { FriendLinkSaveRequest } from './types.js';

export function registerAdminRoutes(
  ctx: PluginContext,
  deps: { service: FriendLinksService }
): void {
  const { service } = deps;

  /** 全部友链（含停用）。 */
  ctx.routes.adminApi({
    method: 'GET',
    path: '/friend-links/items',
    permission: 'link.view',
    handler: async (_request, reply) => {
      const items = await service.listForAdmin();
      reply.json({ data: items, total: items.length });
    }
  });

  /** 新建。 */
  ctx.routes.adminApi({
    method: 'POST',
    path: '/friend-links/items',
    permission: 'link.manage',
    handler: async (request, reply) => {
      const result = await service.save({ payload: readPayload(request.body) });
      reply.statusCode = 201;
      reply.json({ data: result });
    }
  });

  /** 更新。 */
  ctx.routes.adminApi({
    method: 'PUT',
    path: '/friend-links/items/:linkId',
    permission: 'link.manage',
    handler: async (request, reply) => {
      const result = await service.save({
        id: parseId(request.params.linkId),
        payload: readPayload(request.body)
      });
      reply.json({ data: result });
    }
  });

  /** 删除。 */
  ctx.routes.adminApi({
    method: 'DELETE',
    path: '/friend-links/items/:linkId',
    permission: 'link.manage',
    handler: async (request, reply) => {
      const id = parseId(request.params.linkId);
      await service.remove(id);
      reply.json({ data: { id, removed: true } });
    }
  });
}

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '友链 ID 非法', { status: 400 });
  }
  return id;
}

/** 把请求体收敛为保存载荷（只取已知字段，避免写入意外字段）。 */
function readPayload(body: unknown): FriendLinkSaveRequest {
  const raw = (body ?? {}) as Record<string, unknown>;
  return {
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
    ...(typeof raw.avatarUrl === 'string' ? { avatarUrl: raw.avatarUrl } : {}),
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(raw.sortOrder === undefined ? {} : { sortOrder: Number(raw.sortOrder) }),
    ...(raw.enabled === undefined ? {} : { enabled: Boolean(raw.enabled) })
  };
}
