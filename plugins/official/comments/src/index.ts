/**
 * comments 插件：访客评论、嵌套回复、四态审核与反垃圾。
 *
 * 关键设计：
 * - 通过 `content.comments@1` 对外提供评论服务，其他插件不读 `rn_comments`；
 * - `content.posts@1` 与 `identity.users@1` 都是**可选依赖**，在请求期惰性解析，
 *   任一缺失时降级而不是启动失败（与 posts → taxonomy/media 的处理一致）；
 * - 评论内容按纯文本入库、转义后输出，因此不存在"用户 HTML 进入模板"的路径。
 */

import { definePlugin, type HttpRequestLike, type PluginContext } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  type ContentCommentsService,
  type ContentPostsService,
  type CoreHtmlService,
  type CoreThemeService,
  type IdentityUsersService
} from '@ricenote/shared';
import { createCommentsService, type CommentsRuntime, type CommentsSettings } from './service.js';
import { createCommentsSlot } from './slot.js';

/** 互动分区的权限点（由本插件的 `manifest.permissions` 声明，见 ADR-018）。 */
const PERMISSION_MODERATE = 'comment.moderate';

export default definePlugin({
  async start(ctx) {
    const html = ctx.services.use<CoreHtmlService>(SERVICE_CONTRACTS.CORE_HTML);
    const theme = ctx.services.use<CoreThemeService>(SERVICE_CONTRACTS.CORE_THEME);
    const settings = readSettings(ctx);

    const runtime: CommentsRuntime = {
      db: ctx.db,
      siteId: ctx.site.id,
      logger: ctx.logger,
      html,
      settings,
      invalidate: (tags) => {
        theme.invalidate(tags);
      },
      // 可选依赖：惰性解析，避免与拓扑排序顺序耦合
      posts: () => ctx.services.tryUse<ContentPostsService>(SERVICE_CONTRACTS.CONTENT_POSTS),
      users: () => ctx.services.tryUse<IdentityUsersService>('identity.users@1')
    };

    const service = createCommentsService(runtime);

    ctx.services.provide<ContentCommentsService>({
      name: SERVICE_CONTRACTS.CONTENT_COMMENTS,
      version: ctx.manifest.version,
      implementation: service
    });

    registerPublicRoutes(ctx, runtime, service);
    registerAdminRoutes(ctx, service);
    registerSlot(ctx, runtime, service);

    /*
     * 后台菜单与界面来自 manifest.admin.pages（声明式）：
     * Core 负责注册菜单、托管 `admin/main.js` 并计算前端入口 URL，
     * 因此这里不再调用 ctx.adminMenu.add，也不需要 admin:menu 能力。
     */

    ctx.logger.info('comments 插件已就绪', {
      requireApproval: settings.requireApproval,
      pageSize: settings.pageSize,
      rateLimit: `${settings.rateLimitMaxSubmissions}/${settings.rateLimitWindowSeconds}s`,
      blockedKeywords: settings.blockedKeywords.length
    });
  },

  async stop(ctx) {
    ctx.logger.info('comments 插件已停止（路由/服务/Slot/菜单已由 Core 注销）');
  }
});

/* ------------------------------ 公开接口 ------------------------------ */

function registerPublicRoutes(
  ctx: PluginContext,
  runtime: CommentsRuntime,
  service: ContentCommentsService
): void {
  /**
   * 提交评论。
   *
   * **双模式响应**（同一端点在有无 JavaScript 时都可用）：
   * - `Accept: application/json`（主题脚本）→ 返回 JSON，前端就地展示提示；
   * - 普通表单提交（无 JS 或 JS 失效）→ 302 回到文章页并附带 `?comment=<结果>`，
   *   由 Slot 渲染提示条。
   *
   * 无会话可绑定，因此依赖同源校验 + 频率限制 + 蜜罐三层防护。
   */
  ctx.routes.raw({
    method: 'POST',
    path: '/comments/submit',
    handler: async (request, reply) => {
      const wantsJson = (headerValue(request, 'accept') ?? '').includes('application/json');
      const body = asRecord(request.body);
      const postId = Number(body.postId);

      // 重定向目标由服务端自行解析，绝不使用用户传入的 URL（防开放重定向）
      const postUrl = await resolvePostUrl(runtime, postId);

      // 文章 slug 可能包含中文：必须百分号编码后放入 Location，
      // 否则 Node 会以 "Invalid character in header content" 直接拒绝响应
      const backTo = (flag: string): string => `${encodeURI(postUrl)}?comment=${flag}#comments`;

      // 蜜罐命中：假装成功，不给自动化脚本任何反馈
      if (typeof body.website === 'string' && body.website.trim().length > 0) {
        runtime.logger.warn('评论蜜罐命中，已静默丢弃', { postId });
        if (wantsJson) reply.json({ data: { id: 0, status: 'spam' } });
        else reply.redirect(backTo('accepted'));
        return;
      }

      try {
        assertSameOrigin(request, ctx.site.url);

        const result = await service.submit({
          postId,
          parentId:
            body.parentId === undefined || body.parentId === null || body.parentId === ''
              ? null
              : Number(body.parentId),
          authorName: asText(body.authorName),
          authorEmail: asText(body.authorEmail),
          authorUrl: asText(body.authorUrl),
          content: asText(body.content),
          ip: clientIpOf(request),
          userAgent: headerValue(request, 'user-agent') ?? '',
          ...(request.viewer?.user.id ? { userId: request.viewer.user.id } : {})
        });

        if (wantsJson) {
          reply.statusCode = 201;
          reply.json({ data: result });
        } else {
          reply.redirect(backTo(result.status === 'approved' ? 'published' : 'pending'));
        }
      } catch (error) {
        // 无 JS 时无法展示字段级错误，只能回到文章页给出通用提示
        if (wantsJson) throw error;

        runtime.logger.warn('表单模式提交评论失败', {
          postId,
          error: error instanceof Error ? error.message : String(error)
        });
        reply.redirect(backTo('error'));
      }
    }
  });

  /** 读取某文章的已通过评论（供主题脚本局部刷新）。 */
  ctx.routes.raw({
    method: 'GET',
    path: '/api/comments',
    handler: async (request, reply) => {
      const postId = Number(request.query.postId);
      if (!Number.isInteger(postId) || postId <= 0) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '缺少合法的 postId', { status: 400 });
      }

      const page = Number(request.query.page ?? 1);
      const pageSize = Number(request.query.pageSize ?? runtime.settings.pageSize);
      const thread = await service.listApprovedThreaded({
        postId,
        page: Number.isFinite(page) ? page : 1,
        pageSize: Number.isFinite(pageSize) ? pageSize : runtime.settings.pageSize
      });

      reply.json({
        data: thread.items,
        total: thread.total,
        totalApproved: thread.totalApproved
      });
    }
  });
}

/**
 * 解析"评论成功后回到哪里"。
 *
 * 刻意不接受用户传入的跳转地址：只按 postId 反查已发布文章的 slug，
 * 查不到时退回首页，从根本上消除开放重定向。
 */
async function resolvePostUrl(runtime: CommentsRuntime, postId: number): Promise<string> {
  if (Number.isInteger(postId) && postId > 0) {
    const posts = runtime.posts();
    if (posts) {
      const post = await posts.findPublishedById(postId).catch(() => undefined);
      if (post?.slug) return `/post/${post.slug}`;
    }
  }
  return '/';
}

/* ------------------------------ 管理接口 ------------------------------ */

function registerAdminRoutes(ctx: PluginContext, service: ContentCommentsService): void {
  ctx.routes.adminApi({
    method: 'GET',
    path: '/comments',
    permission: PERMISSION_MODERATE,
    handler: async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const page = query.page ? Number(query.page) : 1;
      const pageSize = query.pageSize ? Number(query.pageSize) : 20;
      const status = query.status && query.status !== 'all' ? (query.status as never) : undefined;

      const result = await service.listForAdmin({
        page,
        pageSize,
        ...(status ? { status } : {}),
        ...(query.postId ? { postId: Number(query.postId) } : {}),
        ...(query.keyword ? { keyword: query.keyword } : {})
      });

      reply.json({ data: result.items, total: result.total, page, pageSize });
    }
  });

  ctx.routes.adminApi({
    method: 'GET',
    path: '/comments/counts',
    permission: PERMISSION_MODERATE,
    handler: async (_request, reply) => {
      reply.json({ data: await service.countByStatus() });
    }
  });

  ctx.routes.adminApi({
    method: 'POST',
    path: '/comments/moderate',
    permission: PERMISSION_MODERATE,
    handler: async (request, reply) => {
      const body = asRecord(request.body);
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)) : [];
      const action = asText(body.action) as 'approve' | 'pending' | 'spam' | 'trash' | 'delete';

      if (!['approve', 'pending', 'spam', 'trash', 'delete'].includes(action)) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `不支持的审核动作：${action}`, {
          status: 400
        });
      }

      const result = await service.moderate({ ids, action });
      reply.json({ data: result });
    }
  });
}

/* ------------------------------ Slot ------------------------------ */

function registerSlot(
  ctx: PluginContext,
  runtime: CommentsRuntime,
  service: ContentCommentsService
): void {
  ctx.slots.register(
    'post.comments',
    createCommentsSlot({
      runtime,
      buildThread: (postId, page, pageSize) =>
        service.listApprovedThreaded({ postId, page, pageSize })
    })
  );
}

/* ------------------------------ 工具函数 ------------------------------ */

/** 读取并收敛插件设置，非法值一律回退到安全默认值。 */
function readSettings(ctx: PluginContext): CommentsSettings {
  const blocked = ctx.config.get<unknown>('blockedKeywords', []);

  return {
    enabled: ctx.config.get<boolean>('enabled', true),
    requireApproval: ctx.config.get<boolean>('requireApproval', true),
    pageSize: clampInt(ctx.config.get<unknown>('pageSize', 20), 1, 100, 20),
    maxLength: clampInt(ctx.config.get<unknown>('maxLength', 2000), 1, 20000, 2000),
    rateLimitWindowSeconds: clampInt(ctx.config.get<unknown>('rateLimitWindowSeconds', 60), 0, 86400, 60),
    rateLimitMaxSubmissions: clampInt(ctx.config.get<unknown>('rateLimitMaxSubmissions', 3), 0, 100, 3),
    maxLinksPerComment: clampInt(ctx.config.get<unknown>('maxLinksPerComment', 2), 0, 100, 2),
    maxDepth: clampInt(ctx.config.get<unknown>('maxDepth', 5), 1, 10, 5),
    blockedKeywords: Array.isArray(blocked)
      ? blocked.filter((item): item is string => typeof item === 'string')
      : []
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function headerValue(request: HttpRequestLike, name: string): string | undefined {
  const raw = request.headers[name] ?? request.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function clientIpOf(request: HttpRequestLike): string | undefined {
  const forwarded = headerValue(request, 'x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim();
  return headerValue(request, 'x-real-ip');
}

/**
 * 同源校验。
 *
 * 公开评论接口没有会话可绑定，因此用 Origin/Referer 与 Host 比对阻断跨站伪造提交；
 * 浏览器不发送来源头时（如部分原生客户端）不在此处阻断，改由频率限制兜底。
 */
function assertSameOrigin(request: HttpRequestLike, siteUrl: string): void {
  const origin = headerValue(request, 'origin') ?? headerValue(request, 'referer');
  if (!origin) return;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new RiceNoteError(ErrorCode.FORBIDDEN, '请求来源不合法', { status: 403 });
  }

  const requestHost = headerValue(request, 'host');
  const configuredHost = safeHost(siteUrl);
  if (originHost === requestHost || (configuredHost && originHost === configuredHost)) return;

  throw new RiceNoteError(ErrorCode.FORBIDDEN, '请求来源不合法', { status: 403 });
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
