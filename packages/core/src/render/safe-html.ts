/**
 * HTML 安全化。
 *
 * 规则：
 * - 任何来自用户输入的富文本，必须先经 `sanitizeRichText` 消毒并包装为 `TrustedHtml`；
 * - 只有 `TrustedHtml` 才会被渲染器标记为 Nunjucks 安全值（不转义）；
 * - 普通字符串在模板中一律自动转义；
 * - 主题设置中的颜色等敏感值必须走白名单过滤器（见 theme-sdk）。
 */

import sanitizeHtml from 'sanitize-html';

/**
 * 受信任 HTML 的标记类型。
 *
 * 使用类而非 Symbol 标记，便于渲染器在遍历 Theme Context 时可靠识别。
 */
export class TrustedHtml {
  /** 结构标记，使该类型与 `TrustedHtmlHandle` 契约兼容。 */
  public readonly __trustedHtml = true as const;
  public readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

/** 把已确认安全的 HTML 包装为 TrustedHtml。 */
export function markTrusted(html: string): TrustedHtml {
  return new TrustedHtml(html);
}

/** 判断是否为受信任 HTML。 */
export function isTrusted(value: unknown): value is TrustedHtml {
  return value instanceof TrustedHtml;
}

const DEFAULT_ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code', 'kbd', 'samp',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'div', 'span', 'section', 'article', 'aside', 'header', 'footer',
  'video', 'audio', 'source', 'track'
];

const DEFAULT_ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'rel', 'target'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
  video: ['src', 'poster', 'controls', 'width', 'height', 'preload'],
  audio: ['src', 'controls', 'preload'],
  source: ['src', 'type'],
  '*': ['class', 'id', 'title', 'lang', 'dir']
};

export interface SanitizeOptions {
  /** 追加允许的标签（在默认白名单之上）。 */
  extraTags?: string[];
  /** 是否允许 `iframe`（默认禁止；仅内置播放器等可信场景可开启）。 */
  allowIframe?: boolean;
  /** 允许的 iframe 来源域名白名单。 */
  iframeHosts?: string[];
}

/**
 * 消毒富文本。
 *
 * 安全基线：
 * - 禁止所有脚本、事件属性与 `data:`/`javascript:` 协议；
 * - 外链自动补 `rel="noopener noreferrer"` 与 `target="_blank"`；
 * - 仅允许 http/https/mailto 协议。
 */
export function sanitizeRichText(dirty: string, options: SanitizeOptions = {}): TrustedHtml {
  const allowedTags = [...DEFAULT_ALLOWED_TAGS, ...(options.extraTags ?? [])];
  if (options.allowIframe) allowedTags.push('iframe');

  const allowedAttributes: sanitizeHtml.IOptions['allowedAttributes'] = {
    ...DEFAULT_ALLOWED_ATTRIBUTES
  };
  if (options.allowIframe) {
    allowedAttributes.iframe = ['src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'loading'];
  }

  const cleaned = sanitizeHtml(dirty ?? '', {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'], video: ['http', 'https'], audio: ['http', 'https'], source: ['http', 'https'] },
    allowProtocolRelative: false,
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href ?? '';
        const isExternal = /^https?:\/\//i.test(href);
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(isExternal ? { rel: 'noopener noreferrer', target: '_blank' } : {})
          }
        };
      },
      ...(options.allowIframe && options.iframeHosts?.length
        ? {
            iframe: (tagName: string, attribs: Record<string, string>) => {
              const src = attribs.src ?? '';
              let allowed = false;
              try {
                const parsed = new URL(src);
                allowed = options.iframeHosts!.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
              } catch {
                allowed = false;
              }
              return allowed ? { tagName, attribs } : { tagName: 'span', attribs: {} };
            }
          }
        : {})
    }
  });

  return markTrusted(cleaned);
}

/** 转义纯文本为 HTML 安全字符串（用于在拼接场景手动转义）。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
