/**
 * URL 纯函数工具。
 *
 * 放在 shared 而不是 Core：插件只能依赖 `@ricenote/shared` 与 `@ricenote/plugin-sdk`，
 * 不能 import Core（依赖方向：Core ← 插件）。因此跨包共用的 URL 工具必须落在
 * 契约包里，否则每个插件都会复制一份。
 */

/** 拼接站点绝对地址；入参已是绝对 URL 时原样返回。 */
export function absoluteUrl(siteUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  const base = siteUrl.replace(/\/+$/, '');
  const suffix = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${suffix === '/' ? '' : suffix}`;
}

/** 去掉查询串与片段，得到用于 canonical / og:url 的纯路径。 */
export function stripQuery(url: string): string {
  const query = url.indexOf('?');
  const hash = url.indexOf('#');
  const end = [query, hash].filter((value) => value >= 0).sort((left, right) => left - right)[0];
  return end === undefined ? url : url.slice(0, end);
}
