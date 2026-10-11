/**
 * 统一的"加载 → 数据 / 错误 / 重试"状态机。
 *
 * 后台管理页面几乎都是这个形状：拉一次数据、出错给提示、可重试、写操作后重载。
 * 把它收进 SDK，插件页面就不必各自重复实现（也让错误处理口径一致）。
 */

import { ref, shallowRef, type Ref } from 'vue';
import { ApiError } from '../api/client.js';

export interface AsyncDataOptions {
  /** 是否在创建时立即加载（默认 true）。 */
  immediate?: boolean;
  /** 错误文案转换：默认取 ApiError.message，否则用兜底文案。 */
  messageOf?: (error: unknown) => string;
}

export interface AsyncDataApi<T> {
  readonly data: Ref<T | null>;
  readonly loading: Ref<boolean>;
  readonly error: Ref<string | null>;
  /** 重新加载；并发调用以最后一次为准（旧请求结果会被丢弃）。 */
  reload(): Promise<T | null>;
}

export function useAsyncData<T>(
  loader: () => Promise<T>,
  options: AsyncDataOptions = {}
): AsyncDataApi<T> {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let sequence = 0;

  const messageOf =
    options.messageOf ??
    ((cause: unknown): string =>
      cause instanceof ApiError ? cause.message : '操作失败，请稍后重试');

  async function reload(): Promise<T | null> {
    const current = ++sequence;
    loading.value = true;
    error.value = null;
    try {
      const result = await loader();
      // 只接受最后一次请求的结果，避免慢请求覆盖新数据
      if (current !== sequence) return null;
      data.value = result;
      return result;
    } catch (cause) {
      if (current === sequence) error.value = messageOf(cause);
      return null;
    } finally {
      if (current === sequence) loading.value = false;
    }
  }

  if (options.immediate !== false) {
    void reload();
  }

  return { data, loading, error, reload };
}
