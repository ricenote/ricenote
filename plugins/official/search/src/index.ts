/**
 * search 插件：全站搜索。
 *
 * 职责边界：
 * - 提供 `content.search@1` 契约（可搜索数据源注册表），**不感知任何具体内容类型**；
 * - 注册 `/search` 页面，跨数据源聚合结果并做全局分页；
 * - **不持有任何数据表**，也不越权查询其他插件的表——检索实现由各数据源负责。
 *
 * 依赖方向：posts 等数据源拥有者主动注册到本插件（而非本插件去依赖它们），
 * 因此 search 可被独立启停：禁用后 `/search` 路由消失，
 * 但数据源拥有者通过 `tryUse` 得到的 undefined 静默跳过注册，不受影响。
 */

import { definePlugin } from '@ricenote/plugin-sdk';
import {
  SERVICE_CONTRACTS,
  type ContentSearchService
} from '@ricenote/shared';
import { createSearchPage } from './page.js';
import { SearchSourceRegistry } from './registry.js';

export default definePlugin({
  async start(ctx) {
    const registry = new SearchSourceRegistry({
      maxItemsPerSource: clampInt(ctx.config.get('maxItemsPerSource', 50), 1, 500, 50),
      onSourceError: (sourceId, error) => {
        // 错误隔离：单个数据源失败只降级它自己的结果
        ctx.logger.error('搜索数据源查询失败，已跳过该来源', {
          source: sourceId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    const service: ContentSearchService = {
      registerSource: (source) => registry.register(source),
      unregisterSource: (id) => registry.unregister(id),
      listSources: () => registry.list(),
      search: (input) => registry.search(input),
      hasSources: () => registry.hasSources()
    };

    ctx.services.provide<ContentSearchService>({
      name: SERVICE_CONTRACTS.CONTENT_SEARCH,
      version: ctx.manifest.version,
      implementation: service
    });

    const maxKeywordLength = clampInt(ctx.config.get('maxKeywordLength', 100), 1, 500, 100);

    ctx.routes.page(
      createSearchPage({
        registry,
        siteTitle: ctx.site.title,
        pageSize: clampInt(ctx.config.get('resultPageSize', 10), 1, 50, 10),
        maxKeywordLength
      })
    );

    // 数据源由其他插件在 core.runtime.started.v1 阶段注册，
    // 因此这里同样等启动完成后再汇报，日志才反映真实状态。
    ctx.events.on('core.runtime.started.v1', () => {
      const sources = registry.list();
      if (sources.length === 0) {
        ctx.logger.warn('尚无插件注册可搜索数据源，/search 将返回空结果', {
          hint: '请确认 posts 等数据源插件已启用'
        });
        return;
      }
      ctx.logger.info('search 插件已就绪', {
        sources: sources.map((source) => source.id)
      });
    });
  },

  async stop(ctx) {
    ctx.logger.info('search 插件已停止（注册表随服务注销而失效）');
  }
});

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
