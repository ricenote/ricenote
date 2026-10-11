/**
 * 导航项的纯函数工具。
 *
 * 刻意与 IO 分离：地址校验、当前项判定与排序调整是**安全相关**且最容易出错的逻辑
 * （一个 `javascript:` 地址就是一个 XSS 入口，一个排序 off-by-one 就是"点了没反应"），
 * 因此放在这里以便单元测试直接覆盖。
 */

/** 导航地址长度上限（与 `rn_nav_items.href` 的列宽一致）。 */
export const MAX_HREF_LENGTH = 500;
/** 导航文案长度上限（与 `rn_nav_items.label` 的列宽一致）。 */
export const MAX_LABEL_LENGTH = 120;
/** 相邻导航项之间的排序间隔，留出插入空间。 */
export const SORT_STEP = 10;

/**
 * 校验并归一化导航地址。
 *
 * 只接受两类地址，其余（`javascript:`、`data:`、`mailto:`、相对路径、协议相对地址
 * `//evil.com`）一律拒绝 —— 后台写入的地址会被直接输出到前台 `<a href>`，
 * 白名单是唯一安全的做法。返回 `undefined` 表示非法。
 */
export function normalizeNavHref(raw: unknown): string | undefined {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length === 0 || text.length > MAX_HREF_LENGTH) return undefined;
  // 协议相对地址会继承当前页面的协议，既无必要也容易绕过校验，直接拒绝
  if (text.startsWith('//')) return undefined;
  // 站内绝对路径
  if (text.startsWith('/')) return text;
  // 外部绝对 URL
  if (/^https?:\/\//i.test(text)) return text;
  return undefined;
}

/** 归一化导航文案：去首尾空白、截断超长。 */
export function normalizeNavLabel(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text.length > MAX_LABEL_LENGTH ? text.slice(0, MAX_LABEL_LENGTH) : text;
}

/** 解码百分号编码；序列非法时原样返回（不因一个坏 URL 让整页渲染失败）。 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 从请求 URL 中取出不含查询串与片段、去掉尾部斜杠、并**解码百分号编码**的路径。
 *
 * 解码是必须的：HTTP 请求行里的 URL 一定是编码过的
 * （`/page/%E5%85%B3%E4%BA%8E`），而导航地址来自数据库、是原始字符
 * （`/page/关于`）。不统一解码，任何非 ASCII 地址都匹配不上，
 * "当前项高亮"会在中文站点上整体失效。
 */
export function currentPathOf(url: string | undefined): string {
  if (!url) return '';
  const path = url.split('#')[0]?.split('?')[0] ?? '';
  const decoded = safeDecode(path);
  return decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded;
}

/**
 * 判断某个导航地址是否指向当前页面。
 *
 * 只有站内路径才可能"当前"；外部链接与协议相对地址一律不算，
 * 避免站点首页恰好与某个外链 URL 的同名路径相等而误高亮。
 * 两侧都经 `currentPathOf` 归一化，因此调用方传原始 URL 或已归一化路径都可以。
 */
export function isActiveNavHref(href: string, currentPath: string): boolean {
  if (!href.startsWith('/')) return false;
  if (currentPath.length === 0) return false;
  return currentPathOf(href) === currentPathOf(currentPath);
}

/**
 * 在有序 ID 列表中把某一项上移/下移一位。
 *
 * 到达边界时返回原顺序的副本（幂等），调用方无需自己判断边界。
 */
export function moveInOrder(ids: number[], id: number, direction: 'up' | 'down'): number[] {
  const next = [...ids];
  const index = next.indexOf(id);
  if (index < 0) return next;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return next;
  const moving = next[index] as number;
  next[index] = next[target] as number;
  next[target] = moving;
  return next;
}

/** 第 `index` 项（从 0 开始）应写入的 `sort_order`。 */
export function sortOrderAt(index: number): number {
  return (index + 1) * SORT_STEP;
}
