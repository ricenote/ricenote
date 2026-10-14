/**
 * permalink 插件：固定链接。
 *
 * 职责边界（见 docs/plugin-api/v1.md）：
 * - 拥有 `rn_permalink_settings` 表与后台页「固定链接」；
 * - 把「文章 / 独立页面 / 分类」三类内容的前台地址形式做成可配置的**方案**，
 *   并通过 `ctx.routes.overridePath()` 替换 `post.show` / `page.show` / `term.category`
 *   三条已注册路由的**路径**（不接管它们的 handler，内容解析仍在 posts / pages）；
 * - 提供 `permalink.routes@1`，让内容插件与订阅源、站点地图等统一生成地址；
 * - 对外声明 `rice.permalink.schemes` 与 `rice.permalink.tokens` 两个扩展点，
 *   第三方插件可为自己内容类型接入同一套方案，或为核心方案追加参数。
 *
 * 装配时机：路径替换必须在**全部插件启动完成之后**做 —— 那时第三方方案的贡献
 * 才收集得到，且它们要接管的路由也才都已注册。此刻 `kernel.router.pages()` 尚未被
 * HTTP 装配读取（`createHttpServer` 在 `bootstrap()` 返回之后才执行），因此仍然生效。
 */

import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type CoreRuntimeService,
  type CoreSetupService,
  type PermalinkRoutesService,
  type PermalinkSchemeDeclaration,
  type PermalinkSchemesHookPayload,
  type PermalinkTokenDeclaration,
  type PermalinkTokensHookPayload
} from '@ricenote/shared';
import { registerAdminRoutes } from './admin.js';
import { BUILTIN_SCHEMES, EXTENSION_POINTS } from './config.js';
import { listTemplates } from './repository.js';
import { collectSchemes, collectTokens, reservedTokenNames, resolveScheme } from './scheme.js';
import { createPermalinkService, type ResolvedPermalinkScheme } from './service.js';

interface PermalinkState {
  /** 当前生效的方案（已编译）。 */
  schemes: ResolvedPermalinkScheme[];
  /** 全部方案声明（内置 + 第三方贡献）。 */
  declarations: PermalinkSchemeDeclaration[];
  /** 已接受的第三方参数。 */
  tokens: PermalinkTokenDeclaration[];
  /** 后台显式配置过的模板（键为方案 id）。 */
  stored: Map<string, string>;
}

export default definePlugin({
  async start(ctx: PluginContext) {
    const setup = ctx.services.use<CoreSetupService>(SERVICE_CONTRACTS.CORE_SETUP);
    const runtime = ctx.services.use<CoreRuntimeService>(SERVICE_CONTRACTS.CORE_RUNTIME);
    const siteId = setup.siteId();

    const state: PermalinkState = {
      schemes: [],
      declarations: [...BUILTIN_SCHEMES],
      tokens: [],
      stored: new Map()
    };

    const service = createPermalinkService({
      schemes: () => state.schemes,
      tokens: () => state.tokens,
      logger: ctx.logger
    });

    ctx.services.provide<PermalinkRoutesService>({
      name: SERVICE_CONTRACTS.PERMALINK,
      version: ctx.manifest.version,
      implementation: service
    });

    registerAdminRoutes(ctx, {
      siteId,
      db: ctx.db,
      logger: ctx.logger,
      declarations: () => ({ schemes: state.declarations, tokens: state.tokens }),
      templates: () => new Map(state.stored),
      markRestartRequired: (reason, actorId) =>
        runtime.markRestartRequired({ reason, ...(actorId ? { actorId } : {}) })
    });

    /** 收集声明 + 读取已配置模板 + 编译。不触碰路由，因此启动期也可以安全调用。 */
    const collect = async (): Promise<void> => {
      const stored = await listTemplates(ctx.db, siteId);

      const schemePayload = await ctx.extensions.apply<PermalinkSchemesHookPayload>(
        EXTENSION_POINTS.SCHEMES,
        { schemes: [...BUILTIN_SCHEMES] },
        // 单个第三方贡献抛错只跳过它自己，不影响内置方案与其它贡献
        { onError: 'skip' }
      );
      const tokenPayload = await ctx.extensions.apply<PermalinkTokensHookPayload>(
        EXTENSION_POINTS.TOKENS,
        { tokens: [] },
        { onError: 'skip' }
      );

      const declarations = collectSchemes(schemePayload.schemes ?? [], ctx.logger);
      const tokens = collectTokens(
        tokenPayload.tokens ?? [],
        reservedTokenNames(declarations),
        ctx.logger
      );

      const schemes: ResolvedPermalinkScheme[] = [];
      for (const declaration of declarations) {
        try {
          schemes.push(
            resolveScheme({
              declaration,
              tokens,
              ...(stored.get(declaration.id) ? { storedTemplate: stored.get(declaration.id) } : {}),
              logger: ctx.logger
            })
          );
        } catch (error) {
          ctx.logger.warn('固定链接方案不可用（模板编译失败）', {
            scheme: declaration.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      state.declarations = declarations;
      state.tokens = tokens;
      state.stored = stored;
      state.schemes = schemes;
    };

    /*
     * 启动期先收一次：此时只能拿到内置方案与清单式贡献里"已登记"的部分，
     * 但服务因此立刻可用（后台页在装配末段失败时也能读到内置三类而不是空白）。
     */
    await collect();

    ctx.events.on('core.runtime.started.v1', async () => {
      await collect();
      applyPathOverrides();
    });

    /** 把每个方案的编译结果登记为对应路由的路径替换。 */
    function applyPathOverrides(): void {
      const applied: string[] = [];
      const skipped: { scheme: string; route: string; reason: string }[] = [];

      for (const scheme of state.schemes) {
        try {
          ctx.routes.overridePath(scheme.routeName, {
            path: scheme.compiled.routePattern,
            urlPath: scheme.compiled.urlPattern
          });
          applied.push(scheme.id);
        } catch (error) {
          // 目标路由不存在（对方插件未启用）或不允许接管：跳过该方案即可，
          // 该内容类型继续使用自己的内建默认路径，不影响其它方案。
          skipped.push({
            scheme: scheme.id,
            route: scheme.routeName,
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }

      ctx.logger.info('固定链接已接管前台路由路径', {
        applied,
        skipped,
        templates: state.schemes.map((scheme) => `${scheme.id}=${scheme.template}`)
      });

      if (state.tokens.length > 0) {
        ctx.logger.info('固定链接已接受第三方参数', {
          tokens: state.tokens.map((token) => token.token)
        });
      }
    }

    ctx.logger.info('固定链接插件已就绪（路径接管在全部插件启动完成后进行）', {
      schemes: state.schemes.map((scheme) => scheme.id)
    });
  },

  async stop(ctx) {
    // 路径替换 / 服务 / 管理 API / 菜单都由 Core 按句柄注销
    ctx.logger.info('固定链接插件已停止（路由路径恢复为各内容插件的内建默认）');
  }
});
