/**
 * RSS 插件的私有工具。
 *
 * 通用能力（绝对地址拼接）已收敛到 `@ricenote/shared`；XML 转义与 RFC 822 时间格式化
 * 仓库没有全局实现（seo 插件自带了一份私有实现），而插件之间不得互相依赖，
 * 因此这里自备一份最小实现。
 */

/** XML 文本转义（标题、链接与摘要里都可能出现 `&`、`<` 与引号）。 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 截断长文本（用于摘要），超长时以省略号收尾。 */
export function clip(text: string, max: number): string {
  const value = text.trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 把 ISO 时间格式化为 RSS 2.0 要求的 RFC 822 时间戳。
 *
 * 统一按 UTC 输出并以 `GMT` 结尾：订阅源不带时区缩写会让部分阅读器猜测本地时区，
 * 导致发布时间显示偏差。无法解析的值返回 `undefined`，由调用方决定是否省略该标签。
 */
export function formatRfc822(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const pad = (input: number): string => String(input).padStart(2, '0');
  const weekday = WEEKDAYS[date.getUTCDay()] ?? 'Mon';
  const month = MONTHS[date.getUTCMonth()] ?? 'Jan';

  return (
    `${weekday}, ${pad(date.getUTCDate())} ${month} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT`
  );
}

/** 收敛为闭区间内的整数；非法值回退到 fallback。 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** 收敛为裁剪后的字符串；非字符串回退为空串。 */
export function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
