/**
 * 管理 API 客户端。
 *
 * 统一处理：
 * - 会话 Cookie（同源请求自动携带）；
 * - CSRF Token（写操作自动附加 `x-csrf-token`）；
 * - 乐观锁（写操作可传 `revision`，冲突返回 409 —— 调用方据此提示用户重新加载）；
 * - 错误归一化（服务端返回 `{ error: { code, message, details } }`）。
 *
 * 该模块同时被后台 SPA 与插件后台界面使用，因此**不能**依赖任何宿主专有的东西
 * （不引用 router、不引用宿主组件），只做纯 HTTP。
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

export interface RequestOptions {
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
    throw new ApiError(response.status, normalizeErrorPayload(parsed, text, response));
  }

  return parsed as T;
}

/** 归一化错误体：服务端约定 `{ error: { code, message, details } }`。 */
function normalizeErrorPayload(
  parsed: unknown,
  text: string,
  response: Response
): ApiErrorPayload {
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    return (parsed as { error: ApiErrorPayload }).error;
  }
  return {
    code: `HTTP_${response.status}`,
    message: text || response.statusText
  };
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
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
  async list<T>(path: string, options?: RequestOptions): Promise<PaginatedResult<T>> {
    return request<PaginatedResult<T>>('GET', path, options);
  },

  /**
   * 下载二进制响应（备份 ZIP 等）。
   *
   * 走 POST 而非 GET：导出与恢复都是"显式动作"，且写方法统一由守卫做 CSRF 校验。
   * 响应体不是 JSON，因此不能复用 `request()` 的信封解包。
   */
  async download(
    path: string,
    options: { method?: 'POST' | 'GET'; body?: unknown } = {}
  ): Promise<{ blob: Blob; filename: string }> {
    const method = options.method ?? 'POST';
    const headers: Record<string, string> = {
      Accept: 'application/zip, application/octet-stream'
    };
    if (method !== 'GET' && csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }

    const response = await fetch(`/api/admin${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(options.body === undefined
        ? {}
        : {
            body: JSON.stringify(options.body),
            headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
          })
    });

    if (!response.ok) {
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = undefined;
      }
      throw new ApiError(response.status, normalizeErrorPayload(parsed, text, response));
    }

    return {
      blob: await response.blob(),
      filename: filenameOf(response.headers.get('content-disposition'))
    };
  }
};

/** 从 `Content-Disposition` 解析文件名。 */
function filenameOf(disposition: string | null): string {
  const matched = disposition?.match(/filename="?([^";]+)"?/i);
  return matched?.[1] ?? 'download.bin';
}

/** 触发浏览器下载（供下载类操作复用）。 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
