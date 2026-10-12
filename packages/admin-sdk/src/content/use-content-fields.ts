/**
 * 当前启用主题声明的「内容自定义字段」元数据（`GET /api/admin/content-fields`）。
 *
 * 与 `use-extensions` 同一套口径：模块级单次拉取 + 缓存（一会话只请求一次）、
 * 失败不抛错（退化为空 + 只 `console.warn` 一次）。
 *
 * 为什么默认自带取数：字段声明的来源是**主题**，文章与页面编辑页都要用同一份；
 * 若要求每个编辑页各自取一遍，就会重复实现错误处理与降级，口径必然漂移。
 * 因此 `ContentFields` 组件默认自取，同时保留 `fields` prop 允许宿主外部覆盖
 * （便于预览、测试，或未来改由宿主统一下发）。
 */

import { reactive } from 'vue';
import type { ContentFieldDto, ContentFieldsDto } from '@ricenote/shared';
import { api } from '../api/client.js';

interface ContentFieldsState {
  fields: ContentFieldDto[];
  themeId?: string;
  ready: boolean;
}

const state = reactive<ContentFieldsState>({ fields: [], ready: false });

let loaded = false;
let inflight: Promise<void> | null = null;
let warned = false;

async function run(): Promise<void> {
  try {
    const result = await api.get<ContentFieldsDto>('/content-fields');
    state.fields = Array.isArray(result?.fields) ? result.fields : [];
    state.themeId = result?.themeId;
  } catch (error) {
    // 未登录 / 网络异常都不应打断编辑页：退化为"无字段声明"
    state.fields = [];
    state.themeId = undefined;
    if (!warned) {
      warned = true;
      console.warn('[admin-sdk] 内容自定义字段声明加载失败，已退化为无字段', error);
    }
  } finally {
    state.ready = true;
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

/** 强制重新拉取（换主题后刷新声明）。 */
async function refresh(): Promise<void> {
  inflight = null;
  loaded = false;
  await ensureLoaded();
}

export interface ContentFieldsApi {
  readonly fields: ContentFieldDto[];
  /** 声明来源主题 ID（换主题后字段集会变化，界面据此解释原因）。 */
  readonly themeId?: string;
  readonly ready: boolean;
  refresh(): Promise<void>;
}

export function useContentFields(): ContentFieldsApi {
  void ensureLoaded();
  return {
    get fields() {
      return state.fields;
    },
    get themeId() {
      return state.themeId;
    },
    get ready() {
      return state.ready;
    },
    refresh
  };
}
