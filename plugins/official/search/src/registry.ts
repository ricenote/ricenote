/**
 * 可搜索数据源注册表。
 *
 * 这是 `content.search@1` 的实现核心：搜索引擎**不认识任何具体内容类型**，
 * 只负责把查询分发给已注册的数据源、合并结果并做全局分页。
 *
 * 错误隔离：单个数据源抛错只影响它自己的结果，页面仍能正常渲染
 * （与 Slot「单组件错误隔离」的原则一致）。
 */

import {
  ErrorCode,
  RiceNoteError,
  type SearchHit,
  type SearchQuery,
  type SearchSource
} from '@ricenote/shared';

export interface SearchSourceRegistryOptions {
  /** 单个数据源在一次查询中最多返回的条数（防止某一源被请求过大的窗口）。 */
  maxItemsPerSource?: number;
  /** 数据源查询失败时的回调（用于日志告警）。 */
  onSourceError?: (sourceId: string, error: unknown) => void;
}

const DEFAULT_MAX_ITEMS_PER_SOURCE = 50;
const MAX_PAGE_SIZE = 100;

export class SearchSourceRegistry {
  private readonly sources = new Map<string, SearchSource>();
  private readonly maxItemsPerSource: number;
  private readonly onSourceError?: (sourceId: string, error: unknown) => void;

  constructor(options: SearchSourceRegistryOptions = {}) {
    this.maxItemsPerSource = Math.max(
      1,
      options.maxItemsPerSource ?? DEFAULT_MAX_ITEMS_PER_SOURCE
    );
    if (options.onSourceError) this.onSourceError = options.onSourceError;
  }

  /** 注册数据源；返回注销句柄。ID 重复时显式报错而非静默覆盖。 */
  register(source: SearchSource): () => void {
    const id = (source.id ?? '').trim();
    if (id.length === 0) {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '搜索数据源的 id 不能为空', {
        status: 400
      });
    }
    if (this.sources.has(id)) {
      throw new RiceNoteError(ErrorCode.SERVICE_DUPLICATE, `搜索数据源 id 重复：${id}`, {
        status: 409,
        details: { id }
      });
    }

    this.sources.set(id, { ...source, id });
    return () => this.unregister(id);
  }

  /** 按 ID 注销；不存在时静默返回，便于插件在 stop 阶段无条件调用。 */
  unregister(id: string): void {
    this.sources.delete(id);
  }

  list(): Array<{ id: string; label: string }> {
    return [...this.sources.values()].map((source) => ({ id: source.id, label: source.label }));
  }

  hasSources(): boolean {
    return this.sources.size > 0;
  }

  /**
   * 跨数据源检索并做全局分页。
   *
   * 由于各数据源独立分页，这里给每个源请求 `page * pageSize` 大小的窗口
   * （上限 maxItemsPerSource），合并后再切片，从而保证前若干页的顺序正确。
   */
  async search(input: SearchQuery): Promise<{ items: SearchHit[]; total: number }> {
    const sources = [...this.sources.values()];
    if (sources.length === 0) return { items: [], total: 0 };

    const keyword = input.keyword.trim();
    if (keyword.length === 0) return { items: [], total: 0 };

    const page = Math.max(1, Math.trunc(input.page));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(input.pageSize)));
    const window = Math.min(page * pageSize, this.maxItemsPerSource);

    const settled = await Promise.all(
      sources.map(async (source) => {
        try {
          return await source.query({ keyword, page: 1, pageSize: window });
        } catch (error) {
          this.onSourceError?.(source.id, error);
          return { items: [] as SearchHit[], total: 0 };
        }
      })
    );

    const seen = new Set<string>();
    const merged: SearchHit[] = [];
    let total = 0;

    for (const result of settled) {
      total += Number(result.total) || 0;
      for (const hit of result.items) {
        const key = `${hit.type}:${hit.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(hit);
      }
    }

    merged.sort(compareHits);

    const start = (page - 1) * pageSize;
    return { items: merged.slice(start, start + pageSize), total };
  }
}

/** 排序：发布时间倒序，缺失视为最旧；时间相同时按标题稳定排序。 */
function compareHits(left: SearchHit, right: SearchHit): number {
  const leftTime = left.publishedAt ?? '';
  const rightTime = right.publishedAt ?? '';
  if (leftTime !== rightTime) return rightTime.localeCompare(leftTime);
  return left.title.localeCompare(right.title);
}
