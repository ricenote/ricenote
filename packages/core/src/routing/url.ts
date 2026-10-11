/**
 * 基于命名路由的 URL 生成。
 *
 * 模板中通过 `{{ url('post.show', { slug: post.slug }) }}` 使用，
 * 参数会做 URL 编码，缺失参数会明确报错而不是生成坏链接。
 */

import { ErrorCode, RiceNoteError } from '@ricenote/shared';

const PARAM_PATTERN = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/** 把路径模板与参数合成为具体路径（不含站点前缀）。 */
export function buildPath(
  pattern: string,
  params: Record<string, string | number> = {}
): string {
  const used = new Set<string>();
  const filled = pattern.replace(PARAM_PATTERN, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') {
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `生成 URL 失败：路由 ${pattern} 缺少参数 ${name}`,
        { status: 500, details: { pattern, param: name } }
      );
    }
    used.add(name);
    return encodeURIComponent(String(value));
  });

  const extras = Object.keys(params).filter((key) => !used.has(key));
  if (extras.length === 0) return filled;

  const query = new URLSearchParams();
  for (const key of extras) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix.length > 0 ? `${filled}?${suffix}` : filled;
}

/** 拼接站点绝对地址。 */
export function absoluteUrl(siteUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = siteUrl.replace(/\/+$/, '');
  const suffix = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${suffix}`;
}

/** 归一化路径：确保以 `/` 开头、去掉重复斜杠与末尾斜杠（根路径除外）。 */
export function normalizePath(path: string): string {
  let normalized = path.trim();
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/{2,}/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/, '');
  }
  return normalized === '' ? '/' : normalized;
}

/** 生成用于比较的路由签名（忽略参数名差异，仅比较结构）。 */
export function routeSignature(method: string, path: string): string {
  const structural = normalizePath(path).replace(PARAM_PATTERN, ':p');
  return `${method.toUpperCase()} ${structural}`;
}
