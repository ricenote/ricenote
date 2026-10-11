/**
 * Nunjucks 自定义过滤器契约与实现。
 *
 * 安全要点：主题设置中的颜色会被写入 `style` 属性，
 * 因此 `css_color` 必须做严格白名单校验，绝不能直接透传任意字符串。
 */

/** 合法的 CSS 颜色白名单：十六进制、rgb()/rgba()、hsl()/hsla()、具名颜色。 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR =
  /^(?:rgb|rgba|hsl|hsla)\(\s*-?\d+(?:\.\d+)?%?\s*(?:,\s*-?\d+(?:\.\d+)?%?\s*){2,3}\)$/;
const NAMED_COLOR = /^[a-zA-Z]{3,20}$/;

/**
 * 严格校验并归一化 CSS 颜色；非法值回退为 `fallback`（默认 transparent）。
 * 用于把主题设置安全地注入 `<style>` 或内联 style 属性。
 */
export function cssColor(value: unknown, fallback = 'transparent'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return fallback;
  if (HEX_COLOR.test(trimmed)) return trimmed;
  if (FUNC_COLOR.test(trimmed)) return trimmed;
  if (NAMED_COLOR.test(trimmed)) return trimmed.toLowerCase();
  return fallback;
}

/** 判断是否为合法 CSS 颜色（供服务端字段校验复用）。 */
export function isValidCssColor(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return false;
  return HEX_COLOR.test(trimmed) || FUNC_COLOR.test(trimmed) || NAMED_COLOR.test(trimmed);
}

/**
 * 日期格式化：支持 `YYYY-MM-DD`、`YYYY-MM-DD HH:mm`、`YYYY年MM月DD日`。
 * 传入非法日期时返回空字符串，避免模板输出 `Invalid Date`。
 */
export function formatDate(value: unknown, pattern = 'YYYY-MM-DD'): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';

  const pad = (input: number): string => String(input).padStart(2, '0');
  const map: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds())
  };
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => map[token] ?? token);
}

/**
 * 截取纯文本摘要。
 * - 自动剥离 HTML 标签，避免把标签算入长度；
 * - 合并连续空白；
 * - 超出长度时按字符截断并追加省略号。
 */
export function excerpt(value: unknown, length = 120, suffix = '…'): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  const plain = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const max = Number.isFinite(length) && length > 0 ? Math.floor(length) : 120;
  if (plain.length <= max) return plain;
  return plain.slice(0, max).trimEnd() + suffix;
}

/** 数字安全化：模板中避免 `NaN` 或字符串拼接。 */
export function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 主题模板可用的全部过滤器。 */
export const THEME_FILTERS = {
  css_color: cssColor,
  date: formatDate,
  excerpt,
  number: toNumber
} as const;

export type ThemeFilterName = keyof typeof THEME_FILTERS;
