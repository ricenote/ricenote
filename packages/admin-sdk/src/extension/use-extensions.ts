/**
 * 后台命名扩展点的"贡献读取 + 裁决"。
 *
 * 内核（服务端）已经把"插件启用且启动成功 + admin 作用域 + 当前用户权限"过滤完，
 * 下发给前端的只是**可渲染的安全子集**；前端只做两件事：
 * 1. 整个会话只拉一次（模块级单例，避免每个插槽各拉一遍）；
 * 2. 与内核一致的 `effectiveFor(point)` 裁决，供插槽决定渲染什么。
 *
 * 失败（未登录 / 网络）绝不抛错：退化为"无贡献"，只告警一次，
 * 否则每个插槽、每次渲染都会往控制台刷同一条警告，噪声淹没真正的问题。
 */

import { reactive } from 'vue';
import type {
  AdminExtensionContributionDto,
  AdminExtensionPointDto,
  AdminExtensionsDto
} from '@ricenote/shared';
import { api } from '../api/client.js';

interface ExtensionsState {
  points: AdminExtensionPointDto[];
  contributions: AdminExtensionContributionDto[];
  ready: boolean;
  pending: boolean;
}

const state = reactive<ExtensionsState>({
  points: [],
  contributions: [],
  ready: false,
  pending: false
});

/** 已成功/已尝试加载过：防止同一会话重复请求。 */
let loaded = false;
/** 并发调用共享的同一个请求。 */
let inflight: Promise<void> | null = null;
/** 告警去重：一个会话只 warn 一次。 */
let warned = false;

async function run(): Promise<void> {
  state.pending = true;
  try {
    const result = await api.get<AdminExtensionsDto>('/extensions');
    state.points = Array.isArray(result?.points) ? result.points : [];
    state.contributions = Array.isArray(result?.contributions) ? result.contributions : [];
  } catch (error) {
    // 未登录 / 网络异常都不应打断界面：退化为"无贡献"即可
    state.points = [];
    state.contributions = [];
    if (!warned) {
      warned = true;
      console.warn('[admin-sdk] 后台扩展点贡献加载失败，已退化为无贡献渲染', error);
    }
  } finally {
    state.ready = true;
    state.pending = false;
  }
}

/** 会话内只拉一次；并发调用共享同一个 Promise。 */
function ensureLoaded(): Promise<void> {
  if (inflight) return inflight;
  if (loaded) return Promise.resolve();
  inflight = run().finally(() => {
    loaded = true;
    inflight = null;
  });
  return inflight;
}

/** 强制重新拉取（供"扩展中心"等场景在启用/停用插件后刷新）。 */
async function refresh(): Promise<void> {
  inflight = null;
  loaded = false;
  await ensureLoaded();
}

/**
 * 取某扩展点的**生效贡献**，与内核裁决口径保持一致。
 *
 * - 存在 `replace` 贡献时：`replace` 整体替换默认内容，只返回胜出者。
 *   胜出规则 = `order` 最大；同分时内核按**插件注册顺序**取先注册者，
 *   但客户端拿不到注册顺序，故用 `pluginId` 字典序兜底（升序取第一）。
 * - 否则：返回全部 `append` 贡献，按 `order` **降序**（order 越大越靠前）。
 */
function effectiveFor(point: string): AdminExtensionContributionDto[] {
  const relevant = state.contributions.filter((item) => item.point === point);

  const replaces = relevant.filter((item) => item.mode === 'replace');
  if (replaces.length > 0) {
    const winner = replaces.reduce((best, current) => {
      if (current.order !== best.order) return current.order > best.order ? current : best;
      // 同分：客户端无注册顺序，用 pluginId 字典序兜底（越小越先）
      return current.pluginId < best.pluginId ? current : best;
    });
    return [winner];
  }

  return [...relevant].sort((a, b) => b.order - a.order);
}

export interface AdminExtensionsApi {
  /** 全部扩展点声明（可用于文档/调试展示）。 */
  readonly points: AdminExtensionPointDto[];
  /** 全部贡献（未裁决）。 */
  readonly contributions: AdminExtensionContributionDto[];
  /** 是否已完成首次加载（成功或失败都会置 true）。 */
  readonly ready: boolean;
  refresh(): Promise<void>;
  /** 某扩展点的生效贡献（含 replace 裁决与 order 降序）。 */
  effectiveFor(point: string): AdminExtensionContributionDto[];
}

export function useAdminExtensions(): AdminExtensionsApi {
  void ensureLoaded();
  return {
    get points() {
      return state.points;
    },
    get contributions() {
      return state.contributions;
    },
    get ready() {
      return state.ready;
    },
    refresh,
    effectiveFor
  };
}
