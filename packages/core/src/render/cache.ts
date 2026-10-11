/**
 * 服务端 HTML 缓存。
 *
 * 缓存键由 `主题 ID + 设置 revision + 已启用插件集合 + 请求路径` 组成，
 * 因此任一要素变化都会自然失效，避免脏读。
 * 额外支持按 tag 精确失效（例如文章更新后只清掉相关页面）。
 */

interface CacheEntry {
  html: string;
  expiresAt: number;
  tags: Set<string>;
}

export interface HtmlCacheOptions {
  enabled: boolean;
  /** 生存时间（秒），0 表示不缓存。 */
  ttlSeconds: number;
  /** 最大条目数，超出按最早过期淘汰。 */
  maxEntries?: number;
  /** 可注入的时间源（测试用）。 */
  now?: () => number;
}

export interface HtmlCacheStats {
  enabled: boolean;
  entries: number;
  hits: number;
  misses: number;
  invalidations: number;
}

export class HtmlCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly tags = new Map<string, Set<string>>();
  private hits = 0;
  private misses = 0;
  private invalidations = 0;
  private readonly now: () => number;

  constructor(private readonly options: HtmlCacheOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  get enabled(): boolean {
    return this.options.enabled && this.options.ttlSeconds > 0;
  }

  /**
   * 生成缓存键。
   *
   * `siteRevision` 为站点信息（标题/描述/地址/Logo 等）的覆盖层版本号：
   * 站点信息可在不重启的前提下被后台修改，纳入缓存键可保证旧 HTML 不会残留。
   */
  static buildKey(parts: {
    themeId: string;
    revision: number;
    pluginsKey: string;
    path: string;
    siteRevision?: number;
  }): string {
    const site = parts.siteRevision ?? 0;
    return `${parts.themeId}|r${parts.revision}|s${site}|p${parts.pluginsKey}|${parts.path}`;
  }

  get(key: string): string | undefined {
    if (!this.enabled) return undefined;
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.remove(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.html;
  }

  set(key: string, html: string, tags: string[] = []): void {
    if (!this.enabled) return;
    this.remove(key);
    this.evictIfNeeded();

    const entry: CacheEntry = {
      html,
      expiresAt: this.now() + this.options.ttlSeconds * 1000,
      tags: new Set(tags)
    };
    this.entries.set(key, entry);
    for (const tag of entry.tags) {
      const bucket = this.tags.get(tag) ?? new Set<string>();
      bucket.add(key);
      this.tags.set(tag, bucket);
    }
  }

  /** 按标签失效（例如 `post:12`）。 */
  invalidateTag(tag: string): number {
    const bucket = this.tags.get(tag);
    if (!bucket) return 0;
    let removed = 0;
    for (const key of [...bucket]) {
      if (this.entries.has(key)) {
        this.remove(key);
        removed += 1;
      }
    }
    this.tags.delete(tag);
    this.invalidations += removed;
    return removed;
  }

  invalidateTags(tags: string[]): number {
    return tags.reduce((total, tag) => total + this.invalidateTag(tag), 0);
  }

  /** 全量清空（主题切换、插件启停后调用）。 */
  clear(): void {
    this.invalidations += this.entries.size;
    this.entries.clear();
    this.tags.clear();
  }

  stats(): HtmlCacheStats {
    return {
      enabled: this.enabled,
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      invalidations: this.invalidations
    };
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    for (const tag of entry.tags) {
      const bucket = this.tags.get(tag);
      if (!bucket) continue;
      bucket.delete(key);
      if (bucket.size === 0) this.tags.delete(tag);
    }
  }

  private evictIfNeeded(): void {
    const max = this.options.maxEntries ?? 500;
    if (this.entries.size < max) return;
    // 淘汰最早过期的一批（约 10%）
    const sorted = [...this.entries.entries()].sort((left, right) => left[1].expiresAt - right[1].expiresAt);
    const target = Math.max(1, Math.floor(max * 0.1));
    for (let index = 0; index < target && index < sorted.length; index += 1) {
      const key = sorted[index]?.[0];
      if (key) this.remove(key);
    }
  }
}
