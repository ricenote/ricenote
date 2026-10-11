/**
 * `head.end` Slot：注入社交分享卡片与结构化数据。
 *
 * 分工说明：`<link rel="canonical">` 与 `<title>` / `<meta name="description">`
 * 由**主题**声明（主题最了解自己的页面语义），本插件只补充：
 * Open Graph、Twitter Card、`robots` 指令与 JSON-LD。
 * 刻意不重复输出 canonical，避免同一页面出现两个 canonical 反而伤害 SEO。
 *
 * 安全：所有属性值经 HTML 转义；JSON-LD 中的 `<`、`>`、`&` 与行分隔符
 * 被替换为 Unicode 转义序列，防止 `</script>` 提前闭合导致脚本注入。
 */

import type { SlotComponent } from '@ricenote/plugin-sdk';
import {
  absoluteUrl,
  safeJsonForInlineScript,
  stripQuery,
  type CoreHtmlService,
  type CoreThemeService
} from '@ricenote/shared';
import type { SeoRuntimeLike } from './types.js';
import { clip } from './util.js';

/** 无需被搜索引擎收录的页面类型。 */
const NO_INDEX_KINDS = new Set(['search', '404']);

export interface SeoMetaDeps {
  runtime: SeoRuntimeLike;
  html: CoreHtmlService;
  theme: CoreThemeService;
}

export function createSeoMetaSlot(deps: SeoMetaDeps): SlotComponent {
  const { runtime, html } = deps;

  return {
    name: 'seo.meta',
    async render(context) {
      const settings = runtime.settings;
      const siteUrl = runtime.siteUrl;
      const kind = context.kind;

      const requestUrl = context.request?.url ?? '/';
      const pathname = stripQuery(requestUrl);
      const pageUrl = absoluteUrl(siteUrl, pathname);

      const post = context.data.post as SeoPostLike | undefined;
      const term = context.data.term as { name?: string; type?: string } | undefined;
      const pageTitle = (context.data.title as string | undefined) ?? runtime.siteTitle;

      const title = resolveTitle({ kind, post, term, pageTitle, siteTitle: runtime.siteTitle });
      const description = resolveDescription({
        kind,
        post,
        pageTitle,
        siteDescription: runtime.siteDescription,
        fallback: (context.data.seoDescription as string | undefined) ?? ''
      });

      const lines: string[] = [];
      const escape = html.escape;

      if (settings.enableOpenGraph) {
        const ogType = kind === 'post' ? 'article' : 'website';
        lines.push(metaProperty('og:site_name', runtime.siteTitle, escape));
        lines.push(metaProperty('og:type', ogType, escape));
        lines.push(metaProperty('og:title', title, escape));
        lines.push(metaProperty('og:description', description, escape));
        lines.push(metaProperty('og:url', pageUrl, escape));
        lines.push(metaProperty('og:locale', toOgLocale(runtime.language), escape));

        const image = post?.coverUrl
          ? absoluteUrl(siteUrl, post.coverUrl)
          : settings.defaultOgImage
            ? absoluteUrl(siteUrl, settings.defaultOgImage)
            : '';
        if (image) lines.push(metaProperty('og:image', image, escape));

        if (kind === 'post' && post?.publishedAt) {
          lines.push(metaProperty('article:published_time', post.publishedAt, escape));
        }
        if (kind === 'post' && post?.updatedAt) {
          lines.push(metaProperty('article:modified_time', post.updatedAt, escape));
        }
      }

      if (settings.enableTwitterCard) {
        lines.push(metaName('twitter:card', post?.coverUrl ? 'summary_large_image' : 'summary', escape));
        lines.push(metaName('twitter:title', title, escape));
        lines.push(metaName('twitter:description', description, escape));
        if (settings.twitterSite) {
          lines.push(metaName('twitter:site', settings.twitterSite, escape));
        }
      }

      if (NO_INDEX_KINDS.has(kind)) {
        lines.push(metaName('robots', 'noindex,follow', escape));
      }

      if (settings.enableJsonLd) {
        const payload = buildJsonLd({
          kind,
          post,
          term,
          title,
          description,
          absoluteUrl: pageUrl,
          siteUrl,
          siteTitle: runtime.siteTitle,
          siteDescription: runtime.siteDescription
        });
        if (payload) {
          lines.push(
            `<script type="application/ld+json">${safeJsonForInlineScript(payload)}</script>`
          );
        }
      }

      if (lines.length === 0) return '';
      return `\n${lines.join('\n')}\n`;
    }
  };
}

/* ------------------------------ 文案解析 ------------------------------ */

interface SeoPostLike {
  title?: string;
  excerpt?: string;
  url?: string;
  authorName?: string;
  coverUrl?: string;
  publishedAt?: string;
  updatedAt?: string;
}

interface TitleInput {
  kind: string;
  post?: SeoPostLike | undefined;
  term?: { name?: string } | undefined;
  pageTitle: string;
  siteTitle: string;
}

function resolveTitle(input: TitleInput): string {
  if (input.kind === 'post' && input.post?.title) {
    return `${input.post.title} · ${input.siteTitle}`;
  }
  if (input.term?.name) return `${input.term.name} · ${input.siteTitle}`;
  return input.pageTitle || input.siteTitle;
}

interface DescriptionInput {
  kind: string;
  post?: SeoPostLike | undefined;
  pageTitle: string;
  siteDescription: string;
  fallback: string;
}

function resolveDescription(input: DescriptionInput): string {
  const candidate =
    input.post?.excerpt?.trim() || input.fallback.trim() || input.pageTitle.trim() || input.siteDescription;
  return clip(candidate, 200);
}

/* ------------------------------ 结构化数据 ------------------------------ */

interface JsonLdInput {
  kind: string;
  post?: SeoPostLike | undefined;
  term?: { name?: string } | undefined;
  title: string;
  description: string;
  absoluteUrl: string;
  siteUrl: string;
  siteTitle: string;
  siteDescription: string;
}

function buildJsonLd(input: JsonLdInput): Record<string, unknown> | undefined {
  const publisher = { '@type': 'Organization', name: input.siteTitle, url: input.siteUrl };

  if (input.kind === 'post' && input.post) {
    return {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: clip(input.post.title ?? input.title, 110),
      description: input.description,
      mainEntityOfPage: { '@type': 'WebPage', '@id': input.absoluteUrl },
      ...(input.post.publishedAt ? { datePublished: input.post.publishedAt } : {}),
      ...(input.post.updatedAt ? { dateModified: input.post.updatedAt } : {}),
      ...(input.post.authorName ? { author: { '@type': 'Person', name: input.post.authorName } } : {}),
      ...(input.post.coverUrl ? { image: absoluteUrl(input.siteUrl, input.post.coverUrl) } : {}),
      publisher
    };
  }

  if (input.kind === 'home') {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: input.siteTitle,
      description: input.siteDescription,
      url: input.siteUrl,
      publisher
    };
  }

  if (input.kind === 'archive' && input.term?.name) {
    return {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: input.term.name,
      description: input.description,
      url: input.absoluteUrl,
      isPartOf: { '@type': 'WebSite', name: input.siteTitle, url: input.siteUrl }
    };
  }

  // search / 404 等页面不输出结构化数据
  return undefined;
}

/* ------------------------------ 工具函数 ------------------------------ */

function metaProperty(property: string, content: string, escape: (text: string) => string): string {
  return `<meta property="${escape(property)}" content="${escape(content)}">`;
}

function metaName(name: string, content: string, escape: (text: string) => string): string {
  return `<meta name="${escape(name)}" content="${escape(content)}">`;
}

/** `zh-CN` → `zh_CN`（Open Graph 的 locale 格式）。 */
function toOgLocale(language: string): string {
  return language.replace('-', '_');
}
