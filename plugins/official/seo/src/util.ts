/**
 * SEO 插件的私有工具。
 *
 * 通用能力（绝对地址拼接、内联脚本安全序列化）已收敛到 `@ricenote/shared`，
 * 这里只保留站点地图特有的 XML 处理与文案截断。
 */

/** XML 文本转义（站点地图的 loc 中可能出现 & 与引号）。 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 截断长文本（用于 description）。 */
export function clip(text: string, max: number): string {
  const value = text.trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
