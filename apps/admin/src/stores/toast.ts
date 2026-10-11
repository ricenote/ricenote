import { reactive } from 'vue';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

let sequence = 0;

const state = reactive<{ items: ToastItem[] }>({ items: [] });

/** 轻量 Toast 状态（无第三方依赖）。 */
export function useToast(): {
  items: ToastItem[];
  push: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  dismiss: (id: number) => void;
} {
  const push = (message: string, tone: ToastTone = 'info'): void => {
    const id = ++sequence;
    state.items.push({ id, tone, message });
    window.setTimeout(() => dismiss(id), 4200);
  };

  const dismiss = (id: number): void => {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items.splice(index, 1);
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
