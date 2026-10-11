/**
 * 当前登录者与权限。
 *
 * 这是**全局单例状态**：后台 SPA 与所有插件后台界面共享同一份，
 * 插件因此可以 `useSession().can('page.manage')` 做界面门控。
 *
 * 注意：前端权限只用于"隐藏无权限入口"，真正的鉴权在服务端守卫（fail-closed）。
 */

import { computed, reactive, type ComputedRef } from 'vue';
import type { AuthUser, LoginResponse } from '@ricenote/shared';
import { ApiError, api, setCsrfToken } from '../api/client.js';

interface SessionState {
  user: AuthUser | null;
  ready: boolean;
  pending: boolean;
}

const state = reactive<SessionState>({ user: null, ready: false, pending: false });

interface SessionPayload {
  user: AuthUser | null;
  csrfToken: string | null;
}

/** 应用一次会话结果（登录、探测、外部注入共用）。 */
function apply(payload: SessionPayload): void {
  state.user = payload.user;
  setCsrfToken(payload.csrfToken);
}

/** 初始化：探测当前会话（未登录不抛错）。 */
async function refresh(): Promise<void> {
  try {
    const result = await api.get<SessionPayload>('/session');
    apply(result);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    apply({ user: null, csrfToken: null });
  } finally {
    state.ready = true;
  }
}

async function login(username: string, password: string): Promise<void> {
  state.pending = true;
  try {
    const result = await api.post<LoginResponse>('/session', { username, password });
    apply({ user: result.user, csrfToken: result.csrfToken });
  } finally {
    state.pending = false;
  }
}

async function logout(): Promise<void> {
  try {
    await api.delete('/session');
  } finally {
    apply({ user: null, csrfToken: null });
  }
}

/** 判断是否拥有某权限点（`*` 代表全部权限）。 */
function can(permission: string | undefined): boolean {
  if (!permission) return true;
  const user = state.user;
  if (!user) return false;
  if (user.permissions.includes('*')) return true;
  return user.permissions.includes(permission);
}

export interface SessionApi {
  readonly user: AuthUser | null;
  readonly ready: boolean;
  readonly pending: boolean;
  readonly isAuthenticated: ComputedRef<boolean>;
  readonly displayName: ComputedRef<string>;
  can(permission: string | undefined): boolean;
  refresh(): Promise<void>;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

export function useSession(): SessionApi {
  return {
    get user() {
      return state.user;
    },
    get ready() {
      return state.ready;
    },
    get pending() {
      return state.pending;
    },
    isAuthenticated: computed(() => state.user !== null),
    displayName: computed(() => state.user?.displayName || state.user?.username || '未登录'),
    can,
    refresh,
    login,
    logout
  };
}
