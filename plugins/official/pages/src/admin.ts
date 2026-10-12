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
import { MAX_CONTENT } from './service.js';

export interface PagesAdminDeps {
  service: ContentPagesService;
  defaultPageSize: number;
  /**
   * 渲染预览 HTML（与保存/发布同一条管线，由插件启动时注入）。
   *
   * 走依赖注入而不是让 admin 直接抓 runtime：这里只声明"需要一个渲染函数"，
   * 管线细节（Markdown 方言、消毒策略）仍只有一份实现。
   */
  preview: (content: string) => Promise<string>;
}

export function registerAdminRoutes(ctx: PluginContext, deps: PagesAdminDeps): void {
  const { service } = deps;

  /** 列表（每项的 `fields` 已由 service 按当前主题声明过滤）。 */
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

  /** 详情（`fields` 同样按当前主题声明过滤）。 */
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

  /**
   * 正文预览（只读渲染，不落库）。
   *
   * 刻意放在 `/pages/:pageId` 之前匹配也无妨：两者方法不同（POST vs GET/PUT/DELETE）。
   * 权限与保存一致（`page.manage`）—— 预览会把**未保存的正文**渲染出来，
   * 允许只读用户提交任意 Markdown 再拿到渲染结果，等于绕开了"谁能写"的边界。
   */
  ctx.routes.adminApi({
    method: 'POST',
    path: '/pages/preview',
    permission: 'page.manage',
    handler: async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const content = String(body.content ?? '');
      if (content.length > MAX_CONTENT) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '正文过长（超过 50 万字符）', { status: 400 });
      }
      reply.json({ data: { html: await deps.preview(content) } });
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

/**
 * 把请求体收敛为保存载荷（只取已知字段，避免写入意外字段）。
 *
 * `fields` 在这个白名单里，但**只原样透传、不在这里预校验**：
 * 校验必须由业务层用当前主题声明的白名单做（未声明的键会被拒绝），
 * 这里若顺手"过滤掉"未知键，作者会以为保存成功了。
 */
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
    ...(typeof raw.seoDescription === 'string' ? { seoDescription: raw.seoDescription } : {}),
    // 请求体没带 fields 键表示"本次不涉及内容字段"（更新时保留既有值），与"提交了空值"区分开；
    // 带了就是外部输入：这里不做结构判断（类型不符交给业务层的校验函数报错）
    ...(raw.fields === undefined ? {} : { fields: raw.fields as Record<string, unknown> })
  };
}
