/**
 * `header.navigation` 插槽：把导航项渲染为前台链接。
 *
 * 标记约定（与旧版 pages 插件输出**保持一致**，主题无需任何改动）：
 *
 * ```html
 * <a href="/page/about" class="rn-nav-link rn-nav-link--active" aria-current="page">关于</a>
 * ```
 *
 * 两套官方主题都按 `aria-current="page"` 高亮当前项，因此"当前项判定"
 * 必须由本插槽给出，主题不需要也不应该自己算。
 * 站外链接额外带上 `rel="noopener noreferrer"`（`target="_blank"` 的必备防护）。
 */

import type { PluginContext } from '@ricenote/plugin-sdk';
import type { ContentNavigationService } from '@ricenote/shared';
import { currentPathOf, isActiveNavHref } from './nav.js';
import type { NavigationRuntime } from './runtime.js';

export function registerNavigationSlot(
  ctx: PluginContext,
  runtime: NavigationRuntime,
  service: ContentNavigationService
): void {
  ctx.slots.register(
    'header.navigation',
    {
      name: 'navigation.header',
      render: async (context) => {
        const items = await service.listRenderable();
        if (items.length === 0) return '';

        const escape = runtime.html.escape;
        const currentPath = currentPathOf(context.request?.url);

        return items
          .map((item) => {
            const active = isActiveNavHref(item.href, currentPath);
            const attributes = [
              `href="${escape(item.href)}"`,
              `class="rn-nav-link${active ? ' rn-nav-link--active' : ''}"`
            ];
            if (active) attributes.push('aria-current="page"');
            if (item.newTab) attributes.push('target="_blank"', 'rel="noopener noreferrer"');
            return `<a ${attributes.join(' ')}>${escape(item.label)}</a>`;
          })
          .join('');
      }
    },
    { priority: 20 }
  );
}
