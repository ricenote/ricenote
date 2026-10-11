/**
 * taxonomy 插件：分类与标签。
 *
 * 边界说明：
 * - 本插件只提供"词条 + 关联"能力，不注册任何页面路由；
 *   分类/标签归档页面由 posts 插件提供（它才掌握文章列表），
 *   这正是"插件只提供数据、由内容插件决定呈现"的体现。
 */

import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  normalizeSlug,
  SERVICE_CONTRACTS,
  type CoreSetupService,
  type TaxonomyService,
  type TermType
} from '@ricenote/shared';
import * as repo from './repository.js';

function assertTermType(value: unknown): TermType {
  if (value === 'category' || value === 'tag') return value;
  throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `词条类型非法：${String(value)}`, {
    status: 400
  });
}

export default definePlugin({
  async start(ctx: PluginContext) {
    const db = ctx.db;
    const setup = ctx.services.use<CoreSetupService>(SERVICE_CONTRACTS.CORE_SETUP);
    const siteId = setup.siteId();

    const service: TaxonomyService = {
      list: (type) => repo.listTerms(db, siteId, type),
      listWithCounts: () => repo.listTermsWithCounts(db, siteId),
      findBySlug: (slug) => repo.findTermBySlug(db, siteId, slug),
      save: async (input) => {
        const type = assertTermType(input.type);
        const name = String(input.name ?? '').trim();
        if (!name) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '名称不能为空', { status: 400 });
        }
        const slug = normalizeSlug(input.slug?.trim() || name, 'term');

        if (input.id) {
          const existing = await repo.findTermById(db, input.id);
          if (!existing) {
            throw new RiceNoteError(ErrorCode.NOT_FOUND, `词条不存在：${input.id}`, { status: 404 });
          }
          await repo.updateTerm(db, input.id, {
            name,
            slug,
            ...(input.description ? { description: input.description } : {})
          });
          ctx.logger.info('词条已更新', { id: input.id, slug });
          return { id: input.id };
        }

        const duplicated = await repo.findTermBySlug(db, siteId, slug);
        if (duplicated) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `同类型下已存在相同别名：${slug}`, {
            status: 409
          });
        }

        const id = await repo.insertTerm(db, {
          siteId,
          type,
          name,
          slug,
          ...(input.description ? { description: input.description } : {})
        });
        ctx.logger.info('词条已创建', { id, type, slug });
        return { id };
      },
      remove: async (id) => {
        await repo.deleteTerm(db, id);
        ctx.logger.info('词条已删除', { id });
      },
      termsOfPost: (postId) => repo.termsOfPost(db, postId)
    };

    ctx.services.provide<TaxonomyService>({
      name: SERVICE_CONTRACTS.CONTENT_TAXONOMY,
      version: ctx.manifest.version,
      implementation: service
    });

    /* ---------- 供 posts 插件调用的内部服务（保持跨插件调用不碰表） ---------- */
    ctx.services.provide({
      name: 'taxonomy.internal@1',
      version: ctx.manifest.version,
      implementation: {
        setPostTerms: (postId: number, termIds: number[]) => repo.setPostTerms(db, postId, termIds),
        clearPostTerms: (postId: number) => repo.clearPostTerms(db, postId),
        termIdsOfPost: (postId: number) => repo.termIdsOfPost(db, postId),
        postIdsOfTerm: (slug: string) => repo.postIdsOfTerm(db, slug, siteId)
      }
    });

    /* ---------- 管理 API ---------- */
    ctx.routes.adminApi({
      method: 'GET',
      path: '/terms',
      permission: 'post.view',
      handler: async (request, reply) => {
        const query = request.query as { type?: string };
        const type = query.type ? assertTermType(query.type) : undefined;
        const items = await service.listWithCounts();
        reply.json({
          data: type ? items.filter((item) => item.type === type) : items,
          total: items.length,
          page: 1,
          pageSize: items.length
        });
      }
    });

    ctx.routes.adminApi({
      method: 'POST',
      path: '/terms',
      permission: 'taxonomy.manage',
      handler: async (request, reply) => {
        const body = (request.body ?? {}) as {
          id?: number;
          name?: string;
          slug?: string;
          type?: string;
          description?: string;
        };
        const result = await service.save({
          ...(body.id ? { id: Number(body.id) } : {}),
          name: String(body.name ?? ''),
          ...(body.slug ? { slug: body.slug } : {}),
          type: assertTermType(body.type ?? 'category'),
          ...(body.description ? { description: body.description } : {})
        });
        reply.statusCode = body.id ? 200 : 201;
        reply.json({ data: result });
      }
    });

    ctx.routes.adminApi({
      method: 'DELETE',
      path: '/terms/:termId',
      permission: 'taxonomy.manage',
      handler: async (request, reply) => {
        const { termId } = request.params as { termId: string };
        await service.remove(Number(termId));
        reply.json({ data: { id: Number(termId), removed: true } });
      }
    });

    /*
     * 后台菜单与界面来自 manifest.admin.pages（声明式）：
     * Core 负责注册菜单、托管 `admin/main.js` 并计算前端入口 URL，
     * 因此这里不再调用 ctx.adminMenu.add，也不需要 admin:menu 能力。
     */

    ctx.logger.info('taxonomy 插件已就绪', { contracts: [SERVICE_CONTRACTS.CONTENT_TAXONOMY] });
  },

  async stop(ctx) {
    ctx.logger.info('taxonomy 插件已停止');
  }
});
