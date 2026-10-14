/**
 * 基于命名路由的 URL 生成。
 *
 * 模板中通过 `{{ url('post.show', { slug: post.slug }) }}` 使用，
 * 参数会做 URL 编码，缺失参数会明确报错而不是生成坏链接。
 */

import { ErrorCode, RiceNoteError, absoluteUrl } from '@ricenote/shared';

/**
 * 站点绝对地址拼接。
 *
 * 实现位于 `@ricenote/shared`：插件不能 import Core，因此跨包共用的实现
 * 必须落在契约包中，这里只做再导出以保持 Core 的既有导入路径不变。
 */
export { absoluteUrl };

const PARAM_PATTERN = /:([A-Za-z_][A-Za-z0-9_]*)/g;
/**
 * 比较用的参数形态：允许参数后跟正则约束 `:slug(^[^/]+\.html$)`。
 *
 * 路径替换（`ctx.routes.overridePath`）登记的模式来自第三方插件，
 * 归一化时要连约束一起吃掉，否则"同一结构、不同约束"会被误判为不同路径。
 */
const PARAM_SIGNATURE_PATTERN = /:([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?/g;

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

/** 生成用于比较的路由签名（忽略参数名与正则约束差异，仅比较结构）。 */
export function routeSignature(method: string, path: string): string {
  const structural = normalizePath(path).replace(PARAM_SIGNATURE_PATTERN, ':p');
  return `${method.toUpperCase()} ${structural}`;
}
