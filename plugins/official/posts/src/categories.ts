/**
 * 批量读取文章分类（专供生成 `{category}` 路径片段）。
 *
 * 单独成模块而不放进 `permalink.ts`：后者只以**类型**方式引用 `runtime.ts`，
 * 从而保持 `runtime.ts → permalink.ts` 的单向依赖；需要真正发起查询的辅助函数
 * （依赖 `taxonomyOf`）放在这里，依赖方向始终是"调用方 → runtime/permalink"。
 *
 * 关键约定：**仅当生效的文章模板确实用到 `{category}` 时才查**，
 * 且一次查询取回全部文章（`termsOfPosts`）—— 否则列表页会退化成每篇一次查询。
 */

import type { PostsRuntime } from './runtime.js';
import { taxonomyOf } from './runtime.js';
import { categoriesOf, postTemplateUsesCategory } from './permalink.js';

export async function loadCategoryMap(
  runtime: PostsRuntime,
  postIds: number[]
): Promise<Record<number, { id: number; slug: string }[]>> {
  if (postIds.length === 0 || !postTemplateUsesCategory(runtime)) return {};

  const taxonomy = taxonomyOf(runtime);
  if (!taxonomy) return {};

  try {
    const grouped = await taxonomy.termsOfPosts(postIds);
    const output: Record<number, { id: number; slug: string }[]> = {};
    for (const [key, terms] of Object.entries(grouped)) {
      output[Number(key)] = categoriesOf(terms);
    }
    return output;
  } catch (error) {
    runtime.logger.warn('批量读取文章分类失败（地址将按“无分类”生成）', {
      error: error instanceof Error ? error.message : String(error)
    });
    return {};
  }
}
