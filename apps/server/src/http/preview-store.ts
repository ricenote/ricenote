/**
 * 主题设置预览令牌。
 *
 * 设计要点（说明书 7.4）：
 * - 预览草稿**永不写入公开设置**，只保存在服务端内存中并由短时令牌索引；
 * - 令牌绑定管理员、主题 ID、配置版本与过期时间；
 * - 令牌过期或进程重启后自动失效（内存实现），因此不需要额外的清理任务。
 */

import { randomBytes } from 'node:crypto';
import type { ThemeSettingValues } from '@ricenote/shared';

interface PreviewEntry {
  token: string;
  themeId: string;
  adminId: number;
  baseRevision: number;
  values: ThemeSettingValues;
  expiresAt: number;
}

export class PreviewStore {
  private readonly entries = new Map<string, PreviewEntry>();

  constructor(
    private readonly ttlSeconds: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** 创建预览令牌。 */
  create(input: {
    themeId: string;
    adminId: number;
    baseRevision: number;
    values: ThemeSettingValues;
  }): { token: string; expiresAt: Date } {
    this.prune();
    const token = randomBytes(24).toString('base64url');
    const expiresAt = this.now() + this.ttlSeconds * 1000;
    this.entries.set(token, {
      token,
      themeId: input.themeId,
      adminId: input.adminId,
      baseRevision: input.baseRevision,
      values: input.values,
      expiresAt
    });
    return { token, expiresAt: new Date(expiresAt) };
  }

  /** 读取令牌对应的草稿值。 */
  get(token: string): PreviewEntry | undefined {
    const entry = this.entries.get(token);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      return undefined;
    }
    return entry;
  }

  /** 主动失效（保存发布后调用）。 */
  revoke(token: string): void {
    this.entries.delete(token);
  }

  /** 失效某管理员的全部预览令牌。 */
  revokeByAdmin(adminId: number): number {
    let removed = 0;
    for (const [token, entry] of this.entries) {
      if (entry.adminId === adminId) {
        this.entries.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token);
    }
    // 防御性上限：避免长时间运行下无限增长
    if (this.entries.size > 200) {
      const sorted = [...this.entries.values()].sort((left, right) => left.expiresAt - right.expiresAt);
      for (const entry of sorted.slice(0, this.entries.size - 200)) {
        this.entries.delete(entry.token);
      }
    }
  }
}

export type { PreviewEntry };
