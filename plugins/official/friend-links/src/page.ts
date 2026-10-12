/**
 * 前台 `/links` 页面：「友情链接」。
 *
 * 这是本插件**给主题的接口**：页面把友链列表放进 ViewModel 的 `data.friendLinks`，
 * Core 渲染时会把 `data` 铺开成模板顶层变量，主题因此可以逐条渲染
 * `{% for link in friendLinks %}`，元素上带 `name` / `url` / `avatarUrl` / `description`。
 *
 * 主题需要在 `theme.json` 的 `templates` 里声明 `"links": "links.njk"` 并提供该模板，
 * 否则会回落到主题的 `fallback.njk`（两套官方主题已声明）。
 */

import type { PageRouteSpec, PluginContext } from '@ricenote/plugin-sdk';
import { FRIEND_LINKS_CACHE_TAG, type FriendLinksService } from './service.js';

/** 前台页面标题。 */
export const LINKS_PAGE_TITLE = '友情链接';

/** 路由名（主题可用 `url('links')` 生成链接）与前台路径。 */
export const LINKS_PAGE_ROUTE = 'links';
export const LINKS_PAGE_PATH = '/links';

export function registerLinksPage(
  ctx: PluginContext,
  deps: { service: FriendLinksService }
): void {
  const route: PageRouteSpec = {
    name: LINKS_PAGE_ROUTE,
    path: LINKS_PAGE_PATH,
    // kind 决定主题模板：主题声明 templates.links 即用 links.njk
    kind: 'links',
    cacheable: true,
    handler: async () => ({
      kind: 'links',
      title: LINKS_PAGE_TITLE,
      canonicalUrl: LINKS_PAGE_PATH,
      data: { friendLinks: await deps.service.listRenderable() },
      cacheTags: [FRIEND_LINKS_CACHE_TAG]
    })
  };

  ctx.routes.page(route);
}
