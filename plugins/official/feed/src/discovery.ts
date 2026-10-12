/**
 * `head.end` Slot：注入订阅地址的自动发现链接。
 *
 * 有了它，读者把站点地址直接粘进 RSS 阅读器即可找到订阅源，
 * 不必知道 `/feed.xml` 这个具体路径。
 *
 * 安全：属性值经 `core.html@1` 的 `escape` 转义，站点标题里的引号不会截断属性。
 */

import type { SlotComponent } from '@ricenote/plugin-sdk';
import { absoluteUrl, type CoreHtmlService } from '@ricenote/shared';
import type { FeedRuntimeLike } from './types.js';

export interface FeedDiscoveryDeps {
  runtime: FeedRuntimeLike;
  html: CoreHtmlService;
}

export function createFeedDiscoverySlot(deps: FeedDiscoveryDeps): SlotComponent {
  const { runtime, html } = deps;

  return {
    name: 'feed.discovery',
    render() {
      const href = absoluteUrl(runtime.siteUrl, '/feed.xml');
      const title = html.escape(runtime.siteTitle);
      return `\n<link rel="alternate" type="application/rss+xml" title="${title}" href="${html.escape(href)}">\n`;
    }
  };
}
