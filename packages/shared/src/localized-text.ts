/**
 * 可本地化展示文案的解析。
 *
 * 放在 shared 而不是 theme-sdk：主题设置、插件设置（`settingsSchema`）、
 * 内容字段、以及**权限点声明**都要解析 `LocalizedText`，
 * 而插件只能依赖 `@ricenote/shared` / `@ricenote/plugin-sdk`（不依赖 theme-sdk），
 * 因此解析算法必须落在共同依赖上，否则每处都会抄一份、各自漂移。
 */

import type { LocalizedText } from './manifests.js';

/**
 * 解析可本地化的展示文案。
 *
 * 匹配顺序：精确语言标签（`zh-CN`）→ 基础语言（`zh`）→ `en` → 首个非空值 → `fallback`。
 * 传入字符串时原样返回，因此未声明多语言的 Manifest 行为完全不变。
 */
export function resolveLocalizedText(
  value: LocalizedText | undefined,
  locale: string,
  fallback = ''
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return value.length > 0 ? value : fallback;

  const entries = Object.entries(value).filter(
    ([, text]) => typeof text === 'string' && text.length > 0
  );
  if (entries.length === 0) return fallback;

  const lookup = new Map(entries.map(([key, text]) => [key.trim().toLowerCase(), text]));
  const normalized = locale.trim().toLowerCase();

  const exact = lookup.get(normalized);
  if (exact !== undefined) return exact;

  const base = normalized.split('-')[0];
  if (base) {
    const baseHit = lookup.get(base);
    if (baseHit !== undefined) return baseHit;
  }

  const english = lookup.get('en');
  if (english !== undefined) return english;

  return entries[0]?.[1] ?? fallback;
}
