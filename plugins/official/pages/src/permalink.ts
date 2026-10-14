/**
 * pages 侧对固定链接方案的使用（与 posts 同构，见 posts/src/permalink.ts）。
 *
 * 生成侧：页面地址统一由 `permalink.routes@1` 产出，不再自己拼 `/page/:slug`；
 * 命中侧：把路由参数还原成"按 ID 还是按缩略名"的查询条件。
 * 固定链接插件未启用时全部回退内建默认 `/page/:slug`，行为与启用前一致。
 */

import {
  PERMALINK_SCHEME_IDS,
  SERVICE_CONTRACTS,
  type PermalinkRoutesService
} from '@ricenote/shared';
import type { PagesRuntime } from './runtime.js';

export function permalinkOf(runtime: PagesRuntime): PermalinkRoutesService | undefined {
  return runtime.services.tryUse<PermalinkRoutesService>(SERVICE_CONTRACTS.PERMALINK);
}

export interface PageUrlInput {
  id: number;
  slug: string;
  /** 供第三方参数（如 `{lang}`）按请求取值。 */
  request?: unknown;
}

/** 生成页面地址；生成失败时回退内建 `/page/:slug`（绝不产出坏链接）。 */
export function pageUrl(runtime: PagesRuntime, input: PageUrlInput): string {
  const permalink = permalinkOf(runtime);
  if (!permalink) return `/page/${input.slug}`;

  return (
    permalink.build(
      PERMALINK_SCHEME_IDS.PAGE,
      { cid: input.id, slug: input.slug },
      input.request === undefined ? {} : { request: input.request }
    ) ?? `/page/${input.slug}`
  );
}

export interface PageLookup {
  byId?: number;
  bySlug?: string;
}

/** 把路由参数还原成页面查询条件；`undefined` 表示地址不合法（判 404）。 */
export function readPageLookup(
  runtime: PagesRuntime,
  params: Record<string, string>
): PageLookup | undefined {
  const permalink = permalinkOf(runtime);
  if (!permalink) {
    const slug = params.slug ?? '';
    return slug.length > 0 ? { bySlug: slug } : undefined;
  }

  const values = permalink.extract(PERMALINK_SCHEME_IDS.PAGE, params);
  if (!values) return undefined;

  const lookup: PageLookup = {};
  if (values.cid !== undefined) {
    const id = Number.parseInt(values.cid, 10);
    if (!Number.isInteger(id) || id <= 0) return undefined;
    lookup.byId = id;
  }
  if (values.slug !== undefined) lookup.bySlug = values.slug;

  if (lookup.byId === undefined && lookup.bySlug === undefined) return undefined;
  return lookup;
}
