/**
 * Markdown 渲染。
 *
 * 输出**尚未消毒**的 HTML；调用方必须再经 `core.html@1` 服务的 `sanitize()`
 * 处理后才可存库或输出。这样把"渲染"与"安全"职责分开，避免遗漏。
 */

import { marked } from 'marked';

const SAFE_PROTOCOLS = /^(https?:|mailto:|\/)/i;

marked.use({
  gfm: true,
  breaks: false,
  pedantic: false
});

/** 把 Markdown 渲染为 HTML（未消毒）。 */
export async function renderMarkdown(markdown: string): Promise<string> {
  if (!markdown || markdown.trim().length === 0) return '';
  const html = await marked.parse(markdown);
  return html;
}

/**
 * 从 Markdown 中提取纯文本摘要。
 * 用于文章列表与搜索摘要，不依赖渲染结果。
 */
export function markdownToPlainText(markdown: string, length: number): string {
  const withoutCode = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ');
  const plain = withoutCode
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= length) return plain;
  return `${plain.slice(0, length).trimEnd()}…`;
}

/** 把相对链接归一化，避免站外协议注入（消毒层还会再拦截一次）。 */
export function normalizeLink(href: string): string {
  const value = href.trim();
  return SAFE_PROTOCOLS.test(value) ? value : '#';
}
