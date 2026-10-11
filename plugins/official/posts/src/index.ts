/**
 * posts 插件：文章。
 *
 * 依赖与协作：
 * - `identity.users@1`（必需）：解析作者显示名；
 * - `content.taxonomy@1` / `taxonomy.internal@1`（可选）：词条读取与关联维护；
 * - `media.library@1`（可选）：解析封面 URL；
 * - `core.html@1`（必需）：统一消毒富文本；
 * - `core.theme@1`（必需）：内容变更后失效 HTML 缓存。
 *
 * 所有可选依赖都在**请求期惰性解析**（见 runtime.ts 的说明），
 * 因此无论插件启动顺序如何、或对方被禁用，posts 都能正常工作。
 */

import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type ContentPostsService,
  type ContentSearchService,
  type CoreHtmlService,
  type CoreSetupService,
  type CoreThemeService
} from '@ricenote/shared';
import { registerAdminRoutes } from './admin.js';
import { registerPublicPages } from './pages.js';
import {
  mediaOf,
  taxonomyInternalOf,
  taxonomyOf,
  usersOf,
  type PostsRuntime
} from './runtime.js';
import { POSTS_SOURCE_ID, createPostsSearchSource } from './search-source.js';
import { createPostsService } from './service.js';

export default definePlugin({
  async start(ctx: PluginContext) {
    const setup = ctx.services.use<CoreSetupService>(SERVICE_CONTRACTS.CORE_SETUP);
    const html = ctx.services.use<CoreHtmlService>(SERVICE_CONTRACTS.CORE_HTML);
    const theme = ctx.services.use<CoreThemeService>(SERVICE_CONTRACTS.CORE_THEME);

    const runtime: PostsRuntime = {
      db: ctx.db,
      siteId: setup.siteId(),
      /*
       * 范围与 manifest.settingsSchema 的声明保持一致。
       * 写入侧已经校验过，这里再收敛一次是为了防"历史脏值"——
       * pageSize 变成 NaN 会让分页查询直接失效，属于必须兜住的输入。
       */
      pageSize: clampInt(ctx.config.get('pageSize', 10), 1, 50, 10),
      excerptLength: clampInt(ctx.config.get('excerptLength', 160), 20, 1000, 160),
      html,
      logger: ctx.logger,
      services: ctx.services
    };

    const service = createPostsService({
      runtime,
      invalidate: (tags) => theme.invalidate(tags),
      emit: async (event, payload) => {
        await ctx.events.emit(event, payload);
      },
      log: (message, meta) => ctx.logger.info(message, meta)
    });

    ctx.services.provide<ContentPostsService>({
      name: SERVICE_CONTRACTS.CONTENT_POSTS,
      version: ctx.manifest.version,
      implementation: service
    });

    registerPublicPages(ctx, runtime);
    registerAdminRoutes(ctx, { service, runtime });
    registerPostSlot(ctx);

    // 可选依赖的可用性在"全部插件启动完成"之后再上报，否则日志会因启动顺序而失真
    ctx.events.on('core.runtime.started.v1', () => {
      const optional = {
        taxonomy: Boolean(taxonomyOf(runtime)),
        media: Boolean(mediaOf(runtime)),
        users: Boolean(usersOf(runtime))
      };

      ctx.logger.info('posts 插件已就绪', {
        pageSize: runtime.pageSize,
        excerptLength: runtime.excerptLength,
        optional
      });

      const missing = Object.entries(optional)
        .filter(([, available]) => !available)
        .map(([name]) => name);
      if (missing.length > 0) {
        ctx.logger.warn('部分可选依赖不可用，已降级运行', { missing });
      }

      registerSearchSource(ctx, runtime);
    });
  },

  async stop(ctx) {
    // 主动注销数据源：search 插件的注册表在它自己的进程内存中，
    // posts 停止后若不注销，搜索页会继续拿到指向已停用插件的查询实现。
    ctx.services
      .tryUse<ContentSearchService>(SERVICE_CONTRACTS.CONTENT_SEARCH)
      ?.unregisterSource(POSTS_SOURCE_ID);

    ctx.logger.info('posts 插件已停止（注册的路由/服务/Slot 已由 Core 注销）');
  }
});

/** 取整并收敛到 [min, max]；非法值回退到 fallback。 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 向 search 插件注册可搜索数据源。
 *
 * 时机必须等到"全部插件启动完成"（`core.runtime.started.v1`）：
 * 拓扑排序仅保证依赖在前，不保证 posts 与 search 的先后顺序，
 * 在 `start()` 里直接取服务会出现"对方还没启动"的假阴性。
 * search 插件未启用时 `tryUse` 返回 undefined，此处静默跳过。
 */
function registerSearchSource(ctx: PluginContext, runtime: PostsRuntime): void {
  const search = ctx.services.tryUse<ContentSearchService>(SERVICE_CONTRACTS.CONTENT_SEARCH);
  if (!search) {
    ctx.logger.info('search 插件未启用，可搜索数据源注册已跳过');
    return;
  }

  search.registerSource(createPostsSearchSource(runtime));
  ctx.logger.info('已向 search 插件注册可搜索数据源', { source: POSTS_SOURCE_ID });
}

/**
 * 注册文章底部插槽：展示词条与最后更新时间。
 *
 * 这是"插件向主题注入展示"的最小示例：主题只需写
 * `{{ slot('post.afterContent', { postId: post.id }) }}` 即可获得该区块；
 * 插件被禁用时插槽自动为空，主题代码无需任何修改。
 */
function registerPostSlot(ctx: PluginContext): void {
  const html = ctx.services.use<CoreHtmlService>(SERVICE_CONTRACTS.CORE_HTML);
  const taxonomyInternal = ctx.services.tryUse('taxonomy.internal@1');

  ctx.slots.register(
    'post.afterContent',
    {
      name: 'posts.meta',
      render: (context) => {
        const post = context.data.post as
          | {
              id?: number;
              terms?: { name: string; slug: string; type: string }[];
              updatedAt?: string;
            }
          | undefined;
        if (!post) return '';

        const parts: string[] = [];

        const terms = post.terms ?? [];
        if (terms.length > 0) {
          const links = terms
            .map((term) => {
              const segment = term.type === 'category' ? 'category' : 'tag';
              return `<a class="rn-term" href="/${segment}/${encodeURIComponent(term.slug)}">${html.escape(term.name)}</a>`;
            })
            .join('');
          parts.push(`<div class="rn-post-terms"><span>相关</span>${links}</div>`);
        }

        if (post.updatedAt) {
          const date = new Date(post.updatedAt);
          if (!Number.isNaN(date.getTime())) {
            const formatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
              date.getDate()
            ).padStart(2, '0')}`;
            parts.push(`<p class="rn-post-updated">最后更新于 ${html.escape(formatted)}</p>`);
          }
        }

        return parts.join('\n');
      }
    },
    { priority: 10 }
  );

  void taxonomyInternal;
}
