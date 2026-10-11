/**
 * 认证与权限状态。
 *
 * 前端权限仅用于**界面门控**（隐藏无权访问的入口）；
 * 真正的鉴权在服务端路由守卫中执行（fail-closed），前端不可信。
 */

import { computed, reactive } from 'vue';
import type { AuthUser, LoginResponse } from '@ricenote/shared';
import { ApiError, api, setCsrfToken } from '@/api/client';

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  pending: boolean;
}

const state = reactive<AuthState>({ user: null, ready: false, pending: false });

/** 初始化：探测当前会话（未登录不抛错）。 */
async function refresh(): Promise<void> {
  try {
    const result = await api.get<{ user: AuthUser | null; csrfToken: string | null }>('/session');
    state.user = result.user;
    setCsrfToken(result.csrfToken);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    state.user = null;
    setCsrfToken(null);
  } finally {
    state.ready = true;
  }
}

async function login(username: string, password: string): Promise<void> {
  state.pending = true;
  try {
    const result = await api.post<LoginResponse>('/session', { username, password });
    state.user = result.user;
    setCsrfToken(result.csrfToken);
  } finally {
    state.pending = false;
  }
}

async function logout(): Promise<void> {
  try {
    await api.delete('/session');
  } finally {
    state.user = null;
    setCsrfToken(null);
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

export function useAuth() {
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
    refresh,
    login,
    logout,
    can
  };
}
