/**
 * 后台菜单状态。
 *
 * 菜单是"插件后台入口"的**唯一来源**：侧栏渲染、插件页面路由注册、
 * "插件未启用"提示都读它，因此必须全局共享、只请求一次。
 *
 * 服务端 `/menu` 返回两类条目：
 * - 常规条目：插件已启动，可正常打开；
 * - `available: false`：插件声明了该页面但当前未启用 —— 侧栏不展示，
 *   但会注册路由，从而让直接访问该书签时给出明确提示而不是 404。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { AdminMenuItem } from '@ricenote/shared';
import { api } from '@ricenote/admin-sdk';

const items = ref<AdminMenuItem[]>([]);
const loaded = ref(false);
let inflight: Promise<void> | null = null;

/** 拉取菜单（并发去重）；`force` 用于登录后或插件启停后刷新。 */
async function load(force = false): Promise<void> {
  if (loaded.value && !force) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      items.value = await api.get<AdminMenuItem[]>('/menu');
      loaded.value = true;
    } catch {
      // 菜单不可用不应阻塞后台：侧栏仍会显示 Core 自有入口
      items.value = [];
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export interface AdminMenuApi {
  readonly items: Ref<AdminMenuItem[]>;
  readonly loaded: Ref<boolean>;
  /** 侧栏可见的插件入口（过滤掉"插件已停用"的占位项）。 */
  readonly visibleItems: ComputedRef<AdminMenuItem[]>;
  /** 插件自带后台界面的条目（含不可用项，用于注册路由）。 */
  readonly pluginPages: ComputedRef<AdminMenuItem[]>;
  findByPath(path: string): AdminMenuItem | undefined;
  load(force?: boolean): Promise<void>;
  /** 退出登录时清空，避免下个用户看到上一个用户的菜单。 */
  reset(): void;
}

export function useAdminMenu(): AdminMenuApi {
  return {
    items,
    loaded,
    // 隐藏页面（如由列表页跳转进入的独立编辑页）不进侧栏，但仍留在 pluginPages 里注册路由
    visibleItems: computed(() =>
      items.value.filter((item) => item.available !== false && item.hidden !== true)
    ),
    pluginPages: computed(() => items.value.filter((item) => Boolean(item.entryUrl))),
    findByPath: (path: string) => items.value.find((item) => item.path === path),
    load,
    reset: () => {
      items.value = [];
      loaded.value = false;
    }
  };
}
