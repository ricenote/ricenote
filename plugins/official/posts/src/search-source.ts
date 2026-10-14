/**
 * posts 插件对外暴露的可搜索数据源。
 *
 * 注册方向是"数据源拥有者主动注册到 `content.search@1`"（由 search 插件提供），
 * 因此 posts 与 search **没有编译期与启动期依赖**：search 被禁用时，
 * 这里的注册调用会静默失败，文章相关功能不受任何影响。
 *
 * 检索策略：优先使用迁移 0002 建立的 ngram FULLTEXT 索引；
 * 长度不足 2（ngram 最短分词长度）或索引不可用时回退 LIKE。
 */

import type { SearchHit, SearchSource } from '@ricenote/shared';
import { markdownToPlainText } from './markdown.js';
import {
  normalizeFulltextKeyword,
  searchPublished,
  searchPublishedFulltext,
  type PostRow
} from './repository.js';
import { loadCategoryMap } from './categories.js';
import { postUrl } from './permalink.js';
import { loadAuthorNames, type PostsRuntime } from './runtime.js';

export const POSTS_SOURCE_ID = 'posts';
export const POSTS_SOURCE_LABEL = '文章';

export function createPostsSearchSource(runtime: PostsRuntime): SearchSource {
  // 首次失败即永久回退：避免每个请求都重复触发同一个数据库错误
  let fulltextAvailable = true;

  return {
    id: POSTS_SOURCE_ID,
    label: POSTS_SOURCE_LABEL,

    async query({ keyword, page, pageSize }) {
      const trimmed = keyword.trim();
      const input = { page, pageSize };

      // 过短或清洗后为空的关键词（ngram 无法命中）直接走 LIKE
      const normalized = fulltextAvailable ? normalizeFulltextKeyword(trimmed) : undefined;

      if (normalized) {
        try {
          const result = await searchPublishedFulltext(
            runtime.db,
            runtime.siteId,
            normalized,
            input,
            runtime.logger
          );
          return { items: await toHits(runtime, result.items), total: result.total };
        } catch (error) {
          fulltextAvailable = false;
          runtime.logger.warn('FULLTEXT 检索不可用，已回退为 LIKE 匹配', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const result = await searchPublished(runtime.db, runtime.siteId, trimmed, input, runtime.logger);
      return { items: await toHits(runtime, result.items), total: result.total };
    }
  };
}

/**
 * 数据库行 → 搜索结果。
 *
 * 刻意**不**填充 terms / coverUrl：这两项需要按行查询其他插件，
 * 会给搜索结果页引入 N+1 查询。卡片模板对这些字段都有条件渲染，缺失不影响展示。
 *
 * 唯一的例外是分类：文章地址模板用到 `{category}` 时非有不可，因此改为
 * **一次批量查询**（`loadCategoryMap`）而不是逐篇查询，也不让页面缺地址。
 */
async function toHits(runtime: PostsRuntime, rows: PostRow[]): Promise<SearchHit[]> {
  const authorNames = await loadAuthorNames(runtime, rows);
  const categories = await loadCategoryMap(
    runtime,
    rows.map((row) => row.id)
  );
  const excerptLength = runtime.excerptLength;

  return rows.map((row) => {
    const publishedAt = row.published_at ? new Date(row.published_at).toISOString() : undefined;
    const authorName = authorNames[row.author_id];

    return {
      id: String(row.id),
      title: row.title,
      excerpt: row.excerpt || markdownToPlainText(row.content, excerptLength),
      url: postUrl(runtime, {
        id: row.id,
        slug: row.slug,
        publishedAt: row.published_at,
        createdAt: row.created_at,
        categories: categories[row.id] ?? []
      }),
      type: 'post',
      sourceLabel: POSTS_SOURCE_LABEL,
      ...(publishedAt ? { publishedAt } : {}),
      ...(authorName ? { authorName } : {})
    };
  });
}
