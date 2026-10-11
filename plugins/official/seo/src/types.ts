/** SEO 插件的设置与运行时依赖。 */

import type { PluginContext } from '@ricenote/plugin-sdk';
import type { ContentPostsService } from '@ricenote/shared';

export interface SeoSettings {
  enableOpenGraph: boolean;
  enableTwitterCard: boolean;
  /** Twitter 账号（形如 `@ricenote`），为空时不输出 `twitter:site`。 */
  twitterSite: string;
  enableJsonLd: boolean;
  /** 未设置封面时的默认分享图（站点相对路径或绝对 URL）。 */
  defaultOgImage: string;
  enableSitemap: boolean;
  enableRobots: boolean;
  /** 站点地图最多收录的 URL 数，防止超大站点生成巨响应。 */
  sitemapMaxUrls: number;
  /** 逐页拉取文章时的页大小。 */
  sitemapPageSize: number;
  /** robots.txt 中禁止抓取的路径前缀。 */
  robotsDisallow: string[];
}

export interface SeoRuntimeLike {
  siteId: string;
  siteTitle: string;
  siteDescription: string;
  siteUrl: string;
  language: string;
  logger: PluginContext['logger'];
  /**
   * 惰性解析内容服务（可选依赖）。
   *
   * 站点地图需要文章 URL 列表；posts 被禁用时降级为"只收录首页"，
   * 而不是让 `/sitemap.xml` 报错。
   */
  posts(): ContentPostsService | undefined;
  settings: SeoSettings;
}
