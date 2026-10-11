/**
 * Slug 生成与校验。
 *
 * 规则：
 * - 保留 Unicode 字母与数字（含中文），其余字符折叠为连字符；
 * - 连续连字符压缩、首尾去连字符、长度上限 160；
 * - 中文标题会得到由中文字符组成的 slug（URL 会做百分号编码），
 *   若调用方更希望拼音或英文，可在保存前显式传入 slug。
 */

const MAX_LENGTH = 160;
const INVALID_SLUG = /[^a-z0-9\u4e00-\u9fa5-]+/gi;

/** 由任意文本生成 slug。 */
export function slugify(input: string, fallback = 'item'): string {
  const normalized = (input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  const slug = normalized
    .replace(/[\s_]+/g, '-')
    .replace(INVALID_SLUG, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH);

  return slug.length > 0 ? slug : `${fallback}-${Date.now().toString(36)}`;
}

/** 校验并归一化调用方显式提供的 slug。 */
export function normalizeSlug(input: string, fallback = 'item'): string {
  return slugify(input, fallback);
}

/** 判断字符串是否是合法 slug（保存前校验用）。 */
export function isValidSlug(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_LENGTH) return false;
  return /^[a-z0-9\u4e00-\u9fa5]+(?:-[a-z0-9\u4e00-\u9fa5]+)*$/.test(value);
}
