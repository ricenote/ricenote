/**
 * pages 插件的管理 API。
 *
 * 权限点：`page.view`（读取）/ `page.manage`（写入）。
 * 路由前缀 `/api/admin/pages`，由 Core 的守卫统一执行
 * 认证 → CSRF → 权限 → 审计（见 apps/server 的 guard）。
 */

import type { PluginContext } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  type ContentPagesService,
  type PageListQuery,
  type PageSaveRequest,
  type PageStatus
} from '@ricenote/shared';

export function registerAdminRoutes(
  ctx: PluginContext,
  deps: { service: ContentPagesService; defaultPageSize: number }
): void {
  const { service } = deps;

  /** 列表。 */
  ctx.routes.adminApi({
    method: 'GET',
    path: '/pages',
    permission: 'page.view',
    handler: async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const page = query.page ? Number(query.page) : 1;
      const pageSize = query.pageSize ? Number(query.pageSize) : deps.defaultPageSize;
      const listQuery: PageListQuery = {
        page,
        pageSize,
        ...(query.status ? { status: query.status as PageStatus | 'all' } : {}),
        ...(query.keyword ? { keyword: query.keyword } : {})
      };

      const result = await service.listForAdmin(listQuery);
      reply.json({ data: result.items, total: result.total, page, pageSize });
    }
  });

  /** 详情。 */
  ctx.routes.adminApi({
    method: 'GET',
    path: '/pages/:pageId',
    permission: 'page.view',
    handler: async (request, reply) => {
      const detail = await service.findForAdmin(parseId(request.params.pageId));
      if (!detail) {
        throw new RiceNoteError(ErrorCode.PAGE_NOT_FOUND, '页面不存在', { status: 404 });
      }
      reply.json({ data: detail });
    }
  });

  /** 新建。 */
  ctx.routes.adminApi({
    method: 'POST',
    path: '/pages',
    permission: 'page.manage',
    handler: async (request, reply) => {
      const result = await service.save({
        ...(request.viewer?.user.id ? { authorId: request.viewer.user.id } : {}),
        payload: readPayload(request.body)
      });
      reply.statusCode = 201;
      reply.json({ data: result });
    }
  });

  /** 更新。 */
  ctx.routes.adminApi({
    method: 'PUT',
    path: '/pages/:pageId',
    permission: 'page.manage',
    handler: async (request, reply) => {
      const id = parseId(request.params.pageId);
      const result = await service.save({
        id,
        ...(request.viewer?.user.id ? { authorId: request.viewer.user.id } : {}),
        payload: readPayload(request.body)
      });
      reply.json({ data: result });
    }
  });

  /** 删除。 */
  ctx.routes.adminApi({
    method: 'DELETE',
    path: '/pages/:pageId',
    permission: 'page.manage',
    handler: async (request, reply) => {
      const id = parseId(request.params.pageId);
      await service.remove(id);
      reply.json({ data: { id, removed: true } });
    }
  });
}

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '页面 ID 非法', { status: 400 });
  }
  return id;
}

/** 把请求体收敛为保存载荷（只取已知字段，避免写入意外字段）。 */
function readPayload(body: unknown): PageSaveRequest {
  const raw = (body ?? {}) as Record<string, unknown>;
  return {
    title: String(raw.title ?? ''),
    content: String(raw.content ?? ''),
    status: (raw.status ?? 'draft') as PageStatus,
    ...(typeof raw.slug === 'string' ? { slug: raw.slug } : {}),
    ...(raw.template === null || typeof raw.template === 'string' ? { template: raw.template } : {}),
    ...(raw.sortOrder === undefined ? {} : { sortOrder: Number(raw.sortOrder) }),
    ...(typeof raw.seoTitle === 'string' ? { seoTitle: raw.seoTitle } : {}),
    ...(typeof raw.seoDescription === 'string' ? { seoDescription: raw.seoDescription } : {})
  };
}
