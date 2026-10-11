/**
 * Markdown 渲染。
 *
 * 输出**尚未消毒**的 HTML；调用方必须再经 `core.html@1` 服务的 `sanitize()`
 * 处理后才可存库或输出。这样把"渲染"与"安全"职责分开，避免遗漏。
 *
 * 与 posts 插件的实现刻意保持一致：全站同一套 Markdown 方言，
 * 避免"同一段文字在文章页与页面里渲染不同"的困惑。
 */

import { marked } from 'marked';

marked.use({
  gfm: true,
  breaks: false,
  pedantic: false
});

/** 把 Markdown 渲染为 HTML（未消毒）。 */
export async function renderMarkdown(markdown: string): Promise<string> {
  if (!markdown || markdown.trim().length === 0) return '';
  return marked.parse(markdown);
}

/** 从 Markdown 中提取纯文本（用于 meta description 兜底）。 */
export function markdownToPlainText(markdown: string, length: number): string {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
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
