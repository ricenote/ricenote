/**
 * 插件生命周期状态机。
 *
 * DISCOVERED → VALIDATED → INSTALLED → ENABLED → STARTED → STOPPED / DISABLED
 * 任一环节异常进入 FAILED（独立记录，不阻塞其他插件）。
 */

import { ErrorCode, RiceNoteError, type PluginState } from '@ricenote/shared';

/** 允许的状态迁移。 */
export const ALLOWED_TRANSITIONS: Record<PluginState, PluginState[]> = {
  DISCOVERED: ['VALIDATED', 'FAILED'],
  VALIDATED: ['INSTALLED', 'FAILED'],
  INSTALLED: ['ENABLED', 'FAILED'],
  ENABLED: ['STARTED', 'DISABLED', 'FAILED'],
  STARTED: ['STOPPED', 'FAILED'],
  STOPPED: ['ENABLED', 'DISABLED', 'FAILED'],
  DISABLED: ['ENABLED', 'FAILED'],
  FAILED: ['DISCOVERED', 'VALIDATED', 'INSTALLED', 'ENABLED', 'DISABLED']
};

export function canTransition(from: PluginState, to: PluginState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: PluginState, to: PluginState, pluginId: string): void {
  if (canTransition(from, to)) return;
  throw new RiceNoteError(
    ErrorCode.PLUGIN_STATE_INVALID,
    `插件 ${pluginId} 不允许从 ${from} 迁移到 ${to}`,
    { status: 409, details: { pluginId, from, to, allowed: ALLOWED_TRANSITIONS[from] } }
  );
}

/** 状态对应的展示语义（供后台渲染状态徽标）。 */
export function describeState(state: PluginState): { label: string; tone: 'ok' | 'warn' | 'error' | 'idle' } {
  switch (state) {
    case 'STARTED':
      return { label: '运行中', tone: 'ok' };
    case 'ENABLED':
      return { label: '已启用（待重启）', tone: 'warn' };
    case 'STOPPED':
      return { label: '已停止', tone: 'idle' };
    case 'DISABLED':
      return { label: '已禁用', tone: 'idle' };
    case 'FAILED':
      return { label: '失败', tone: 'error' };
    case 'INSTALLED':
      return { label: '已安装', tone: 'idle' };
    case 'VALIDATED':
      return { label: '已校验', tone: 'idle' };
    default:
      return { label: '已发现', tone: 'idle' };
  }
}

/** 运行期插件状态记录。 */
import type { PluginSourceInfo } from '@ricenote/shared';

export interface PluginRecord {
  id: string;
  state: PluginState;
  enabled: boolean;
  startedAt?: number;
  stoppedAt?: number;
  lastError?: string;
  /**
   * 来源元数据（registry / git / local）。
   *
   * 与 `lastError` 一样属于"展示用元数据"而非生命周期状态，因此不参与状态机校验，
   * 但需要在内存记录里保留一份，避免后台列表每次都回查数据库。
   */
  source?: PluginSourceInfo;
}
