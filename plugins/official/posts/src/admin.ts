/**
 * posts 插件的管理 API。
 *
 * 权限模型：
 * - 读写草稿需要 `post.write`（由 Core 的路由守卫统一校验）；
 * - **发布/归档**额外需要 `post.publish`，这里通过 authorization 服务二次校验
 *   （Core 的守卫只能声明单一权限点，多权限组合由插件自行判断）。
 */

import type { PluginContext } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  type AuthorizationService,
  type ContentPostsService,
  type PostSaveRequest,
  type PostStatus
} from '@ricenote/shared';
import type { PostsRuntime } from './runtime.js';

export interface AdminRouteDeps {
  service: ContentPostsService;
  runtime: PostsRuntime;
}

const STATUS_LABEL: Record<PostStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档'
};

export function registerAdminRoutes(
  ctx: PluginContext,
  deps: AdminRouteDeps
): void {
  const { service, runtime } = deps;

  /** 需要发布权限时进行二次校验。 */
  const assertPublishPermission = async (userId: number, status: PostStatus): Promise<void> => {
    if (status !== 'published') return;
    const authorization = ctx.services.tryUse<AuthorizationService>(
      SERVICE_CONTRACTS.IDENTITY_AUTHORIZATION
    );
    if (!authorization) {
      throw new RiceNoteError(
        ErrorCode.FORBIDDEN,
        '权限服务不可用，无法校验发布权限，已拒绝该操作',
        { status: 403 }
      );
    }
    const permissions = await authorization.permissionsOf(userId);
    if (!permissions.includes('*') && !permissions.includes('post.publish')) {
      throw new RiceNoteError(
        ErrorCode.FORBIDDEN,
        `缺少发布权限（post.publish），当前文章状态：${STATUS_LABEL[status]}`,
        { status: 403 }
      );
    }
  };

  ctx.routes.adminApi({
    method: 'GET',
    path: '/posts',
    permission: 'post.view',
    handler: async (request, reply) => {
      const query = request.query as {
        page?: string;
        pageSize?: string;
        status?: string;
        keyword?: string;
      };
      const result = await service.listForAdmin({
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : 20,
        ...(query.status ? { status: query.status as PostStatus | 'all' } : {}),
        ...(query.keyword ? { keyword: query.keyword } : {})
      });
      reply.json({
        data: result.items,
        total: result.total,
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : 20
      });
    }
  });

  ctx.routes.adminApi({
    method: 'GET',
    path: '/posts/:postId',
    permission: 'post.view',
    handler: async (request, reply) => {
      const { postId } = request.params as { postId: string };
      const post = await service.findForAdmin(Number(postId));
      if (!post) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `文章不存在：${postId}`, { status: 404 });
      }
      reply.json({ data: post });
    }
  });

  ctx.routes.adminApi({
    method: 'POST',
    path: '/posts',
    permission: 'post.write',
    handler: async (request, reply) => {
      const body = (request.body ?? {}) as PostSaveRequest;
      const authorId = request.viewer?.user.id ?? 0;
      await assertPublishPermission(authorId, body.status ?? 'draft');

      const result = await service.save({ authorId, payload: body });
      reply.statusCode = 201;
      reply.json({ data: result });
    }
  });

  ctx.routes.adminApi({
    method: 'PUT',
    path: '/posts/:postId',
    permission: 'post.write',
    handler: async (request, reply) => {
      const { postId } = request.params as { postId: string };
      const body = (request.body ?? {}) as PostSaveRequest;
      const authorId = request.viewer?.user.id ?? 0;
      await assertPublishPermission(authorId, body.status ?? 'draft');

      const result = await service.save({
        id: Number(postId),
        authorId,
        payload: body
      });
      reply.json({ data: result });
    }
  });

  /** 单独的状态变更端点（发布 / 撤回 / 归档）。 */
  ctx.routes.adminApi({
    method: 'POST',
    path: '/posts/:postId/status',
    permission: 'post.publish',
    handler: async (request, reply) => {
      const { postId } = request.params as { postId: string };
      const body = (request.body ?? {}) as { status?: PostStatus };
      const status = body.status ?? 'draft';
      if (!['draft', 'published', 'archived'].includes(status)) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `状态非法：${String(status)}`, {
          status: 400
        });
      }

      const existing = await service.findForAdmin(Number(postId));
      if (!existing) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `文章不存在：${postId}`, { status: 404 });
      }

      /*
       * 状态变更复用保存流程，因此必须把完整字段一并回传。
       *
       * 历史上这里只回传了正文相关字段，导致"仅切换发布状态"会静默清空
       * 封面、SEO 字段与自选模板 —— 属于数据丢失，必须在载荷里补齐。
       */
      await service.save({
        id: Number(postId),
        authorId: existing.authorId,
        payload: {
          title: existing.title,
          slug: existing.slug,
          content: existing.content,
          excerpt: existing.excerpt,
          status,
          coverMediaId: existing.coverMediaId ?? null,
          template: existing.template ?? null,
          ...(existing.seoTitle ? { seoTitle: existing.seoTitle } : {}),
          ...(existing.seoDescription ? { seoDescription: existing.seoDescription } : {}),
          termIds: existing.terms.map((term) => term.id)
        }
      });

      reply.json({ data: { id: Number(postId), status } });
    }
  });

  ctx.routes.adminApi({
    method: 'DELETE',
    path: '/posts/:postId',
    permission: 'post.delete',
    handler: async (request, reply) => {
      const { postId } = request.params as { postId: string };
      await service.remove(Number(postId));
      reply.json({ data: { id: Number(postId), removed: true } });
    }
  });

  ctx.routes.adminApi({
    method: 'GET',
    path: '/posts/stats',
    permission: 'post.view',
    handler: async (_request, reply) => {
      const counts = await service.countByStatus();
      reply.json({ data: counts });
    }
  });

  /*
   * 后台菜单与界面来自 manifest.admin.pages（声明式）：
   * Core 注册菜单、托管 ./admin/main.js 并计算前端入口 URL，插件无需注册代码。
   */

  runtime.logger.info('管理 API 已注册', {
    routes: [
      'GET /posts',
      'GET /posts/:postId',
      'POST /posts',
      'PUT /posts/:postId',
      'POST /posts/:postId/status',
      'DELETE /posts/:postId'
    ]
  });
}
