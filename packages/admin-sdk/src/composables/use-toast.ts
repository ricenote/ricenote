/**
 * 轻量提示条状态（无第三方依赖）。
 *
 * 全局单例：宿主挂载一次 `<Toaster />`，插件页面调用 `useToast()` 即可弹出提示，
 * 提示条渲染在宿主最外层，因此不会被插件的容器样式裁剪。
 */

import { reactive } from 'vue';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

/** 自动消失时间：错误与警告多留一会儿，便于阅读。 */
const DURATION_MS: Record<ToastTone, number> = {
  success: 3600,
  info: 4200,
  warning: 6000,
  error: 7000
};

let sequence = 0;

const state = reactive<{ items: ToastItem[] }>({ items: [] });

export interface ToastApi {
  readonly items: ToastItem[];
  push(message: string, tone?: ToastTone): void;
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  dismiss(id: number): void;
}

export function useToast(): ToastApi {
  const dismiss = (id: number): void => {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items.splice(index, 1);
  };

  const push = (message: string, tone: ToastTone = 'info'): void => {
    const id = ++sequence;
    state.items.push({ id, tone, message });
    window.setTimeout(() => dismiss(id), DURATION_MS[tone]);
  };

  return {
    items: state.items,
    push,
    success: (message) => push(message, 'success'),
    error: (message) => push(message, 'error'),
    info: (message) => push(message, 'info'),
    warning: (message) => push(message, 'warning'),
    dismiss
  };
}
