/**
 * 运行状态与重启流程。
 *
 * 交互约定（与顶栏「重启」按钮一致）：
 * - 按钮只在**存在待生效变更**时出现（避免噪声）；
 * - 点击后前端先收到 202，随后服务端开始软重启，期间请求会返回 503；
 * - 前端轮询等待服务恢复，并在检测到 `startedAt` 变化后结束等待，
 *   从而确认"新进程已经在跑"，而不是"旧进程又活了"。
 *
 * 插件后台界面在保存了"需要重启才生效"的设置后，可以调用 `markPending()`
 * 让顶栏按钮**立刻**出现，无需等待下一次轮询。
 */

import { computed, reactive, type ComputedRef } from 'vue';
import type { SystemStateDto } from '@ricenote/shared';
import { ApiError, api } from '../api/client.js';

interface SystemState {
  value: SystemStateDto | null;
  /** 前端正在进行重启等待。 */
  restarting: boolean;
  /** 当前等待阶段的提示文案。 */
  phase: string;
}

const state = reactive<SystemState>({ value: null, restarting: false, phase: '' });

/** 轮询间隔与上限：软重启通常在数秒内完成，60 秒仍未恢复视为异常。 */
const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 60_000;

async function refresh(): Promise<SystemStateDto | null> {
  try {
    state.value = await api.get<SystemStateDto>('/system/state');
    return state.value;
  } catch {
    // 重启期间该端点是 503/连接失败，属于预期情况，不打扰用户
    return null;
  }
}

/** 记录待生效状态（供插件设置等页面在保存成功后即时反映）。 */
function markPending(reason?: string): void {
  state.value = {
    ...(state.value ?? { restartRequired: true }),
    restartRequired: true,
    ...(reason === undefined ? {} : { reason })
  } as SystemStateDto;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等待服务恢复：先等健康检查通过，再等 `startedAt` 变化。 */
async function waitUntilBack(previousStartedAt: string): Promise<boolean> {
  const deadline = Date.now() + MAX_WAIT_MS;

  // 阶段一：等待 HTTP 恢复响应
  state.phase = '正在等待服务恢复…';
  while (Date.now() < deadline) {
    try {
      const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
      if (response.ok) break;
    } catch {
      /* 连接被拒：仍在关停/启动中 */
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // 阶段二：等待新进程完成装配（startedAt 变化）
  state.phase = '正在等待服务准备就绪…';
  while (Date.now() < deadline) {
    const current = await refresh();
    if (current && current.startedAt !== previousStartedAt) return true;
    await sleep(POLL_INTERVAL_MS);
  }

  return false;
}

/**
 * 触发重启并等待完成。
 *
 * @returns 是否确认服务已由新进程接管。
 */
async function restart(reason?: string): Promise<boolean> {
  const previous = state.value?.startedAt ?? '';
  state.restarting = true;
  state.phase = '正在请求重启…';

  try {
    await api.post('/system/restart', reason ? { reason } : {});
  } catch (error) {
    state.restarting = false;
    state.phase = '';
    throw error;
  }

  const recovered = await waitUntilBack(previous);
  state.restarting = false;
  state.phase = '';
  await refresh();
  return recovered;
}

export interface SystemStateApi {
  readonly value: SystemStateDto | null;
  readonly restarting: boolean;
  readonly phase: string;
  readonly restartRequired: ComputedRef<boolean>;
  readonly pendingReason: ComputedRef<string>;
  refresh(): Promise<SystemStateDto | null>;
  markPending(reason?: string): void;
  restart(reason?: string): Promise<boolean>;
}

export function useSystemState(): SystemStateApi {
  return {
    get value() {
      return state.value;
    },
    get restarting() {
      return state.restarting;
    },
    get phase() {
      return state.phase;
    },
    restartRequired: computed(() => state.value?.restartRequired === true),
    pendingReason: computed(() => state.value?.reason ?? ''),
    refresh,
    markPending,
    restart
  };
}

/** 判断错误是否表示"服务正在重启"（前端据此展示等待提示而不是报错）。 */
export function isRestartingError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'RN_RESTART_IN_PROGRESS';
}
