/** RSS 订阅插件的设置与运行时依赖。 */

import type { ContentPostsService } from '@ricenote/shared';

export interface FeedSettings {
  /** 是否提供订阅地址；为假时既不注册路由也不注入自动发现链接。 */
  enableFeed: boolean;
  /** 订阅最多输出多少篇最新文章。 */
  itemLimit: number;
  /** 是否输出正文全文（关闭时只输出摘要）。 */
  fullText: boolean;
  /** 订阅结果的缓存时间（秒）。 */
  cacheMaxAge: number;
}

export interface FeedRuntimeLike {
  siteTitle: string;
  siteDescription: string;
  siteUrl: string;
  language: string;
  settings: FeedSettings;
  /**
   * 惰性解析内容服务（可选依赖）。
   *
   * 订阅内容全部来自已发布文章；posts 被禁用时降级为"只有站点信息的空订阅源"，
   * 而不是让 `/feed.xml` 报错。
   */
  posts(): ContentPostsService | undefined;
}
