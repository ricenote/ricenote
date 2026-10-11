/**
 * 管理 API 客户端。
 *
 * 统一处理：
 * - 会话 Cookie（同源请求自动携带）；
 * - CSRF Token（写操作自动附加 `x-csrf-token`）；
 * - 主题设置乐观锁（写操作可传 `revision`，冲突返回 409 —— 调用方据此提示用户重新加载）；
 * - 错误归一化（服务端返回 `{ error: { code, message, details } }`）。
 */

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.details = payload.details ?? {};
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

let csrfToken: string | null = null;

/** 由认证流程写入 / 清除 CSRF Token。 */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

interface RequestOptions {
  body?: unknown;
  /** 使用 multipart/form-data 提交（自动跳过 JSON 序列化）。 */
  formData?: FormData;
  signal?: AbortSignal;
  /** 静默模式：401 时不抛出，用于初始化探测。 */
  allowAnonymous?: boolean;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`/api/admin${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(body === undefined ? {} : { body }),
    ...(options.signal ? { signal: options.signal } : {})
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const errorPayload =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? ((parsed as { error: ApiErrorPayload }).error as ApiErrorPayload)
        : { code: `HTTP_${response.status}`, message: text || response.statusText };

    throw new ApiError(response.status, errorPayload);
  }

  return parsed as T;
}

/** 解包 `{ data }` 信封。 */
async function unwrap<T>(promise: Promise<{ data: T }>): Promise<T> {
  const result = await promise;
  return result.data;
}

export const api = {
  raw: request,

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    const result = await request<{ data: T }>('GET', path, options);
    return result.data;
  },

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const result = await request<{ data: T }>('POST', path, { ...options, body });
    return result.data;
  },

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const result = await request<{ data: T }>('PUT', path, { ...options, body });
    return result.data;
  },

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    const result = await request<{ data: T }>('DELETE', path, options);
    return result.data;
  },

  /** 上传（multipart/form-data）。 */
  async upload<T>(path: string, formData: FormData): Promise<T> {
    const result = await request<{ data: T }>('POST', path, { formData });
    return result.data;
  },

  /** 分页列表（保留 total/page/pageSize 元信息）。 */
  async list<T>(
    path: string,
    options?: RequestOptions
  ): Promise<{ data: T[]; total: number; page: number; pageSize: number }> {
    return request<{ data: T[]; total: number; page: number; pageSize: number }>('GET', path, options);
  }
};
