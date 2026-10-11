/**
 * 能力（capability）匹配工具。
 *
 * 单独成模块是为了避免循环依赖：bootstrap、渲染器与路由都需要它。
 */

import { isCapability } from '@ricenote/shared';

/**
 * 判断能力列表中是否包含指定查询。
 *
 * 支持三种写法（主题作者可以只写短名）：
 * - 完整契约：`content.posts@1`
 * - 完整名称：`content.posts`
 * - 短名：`posts`
 */
export function capabilityMatches(capabilities: readonly string[], query: string): boolean {
  if (capabilities.includes(query)) return true;

  for (const raw of capabilities) {
    if (raw === query) return true;
    if (!isCapability(raw)) continue;

    const name = raw.slice(0, raw.lastIndexOf('@'));
    if (name === query) return true;
    if (name.endsWith(`.${query}`)) return true;
  }
  return false;
}
