/**
 * 后台菜单注册表。
 *
 * 插件通过它向管理后台注入导航项与统计入口；
 * Core 负责合并、排序并按当前用户的权限点过滤（无权限的项不返回给前端）。
 */

import type { AdminMenuItem, Dispose } from '@ricenote/plugin-sdk';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';

interface RegisteredMenuItem {
  pluginId: string;
  item: AdminMenuItem;
}

const ID_PATTERN = /^[a-z][a-z0-9._-]{1,80}$/;

export class AdminMenuRegistry {
  private readonly items: RegisteredMenuItem[] = [];

  add(pluginId: string, item: AdminMenuItem): Dispose {
    if (!ID_PATTERN.test(item.id)) {
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `后台菜单 ID 非法：${item.id}（仅允许小写字母、数字、点、下划线与短横线）`,
        { status: 400 }
      );
    }
    if (this.items.some((entry) => entry.item.id === item.id)) {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `后台菜单 ID 重复：${item.id}`, {
        status: 409
      });
    }
    if (!item.path.startsWith('/')) {
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `后台菜单路径必须以 / 开头：${item.path}`,
        { status: 400 }
      );
    }

    const entry: RegisteredMenuItem = { pluginId, item };
    this.items.push(entry);

    return () => {
      const index = this.items.indexOf(entry);
      if (index >= 0) this.items.splice(index, 1);
    };
  }

  /**
   * 列出菜单项。
   * @param permissions 当前用户拥有的权限点；提供时会过滤掉无权访问的项。
   */
  list(permissions?: readonly string[]): AdminMenuItem[] {
    const filtered = this.items.filter((entry) => {
      const required = entry.item.permission;
      if (!required) return true;
      if (!permissions) return true;
      return permissions.includes(required);
    });

    return filtered
      // 补上 pluginId：前端需要据此判断"这个入口属于哪个插件、当前是否可用"
      .map((entry) => ({ ...entry.item, pluginId: entry.pluginId }))
      .sort((left, right) => (right.order ?? 0) - (left.order ?? 0) || left.id.localeCompare(right.id));
  }

  /** 列出某插件注册的菜单（停用前影响分析）。 */
  ownedBy(pluginId: string): string[] {
    return this.items.filter((entry) => entry.pluginId === pluginId).map((entry) => entry.item.id).sort();
  }

  clear(): void {
    this.items.length = 0;
  }
}
