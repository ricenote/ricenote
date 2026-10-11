/**
 * RiceNote 统一错误码与错误类型。
 *
 * 约定：
 * - 所有对外错误都携带稳定的字符串错误码，便于前端与文档引用；
 * - `status` 为建议的 HTTP 状态码，供 HTTP 层直接使用；
 * - `details` 仅存放可安全外露的结构化信息，禁止放入敏感数据。
 */

export const ErrorCode = {
  /* Manifest 与契约 */
  MANIFEST_NOT_FOUND: 'RN_MANIFEST_NOT_FOUND',
  MANIFEST_INVALID: 'RN_MANIFEST_INVALID',
  MANIFEST_ENTRY_INVALID: 'RN_MANIFEST_ENTRY_INVALID',
  API_VERSION_UNSUPPORTED: 'RN_API_VERSION_UNSUPPORTED',

  /* 依赖解析 */
  DEPENDENCY_MISSING: 'RN_DEPENDENCY_MISSING',
  DEPENDENCY_VERSION_CONFLICT: 'RN_DEPENDENCY_VERSION_CONFLICT',
  DEPENDENCY_CYCLE: 'RN_DEPENDENCY_CYCLE',
  DEPENDENCY_DISABLED: 'RN_DEPENDENCY_DISABLED',

  /* 生命周期 */
  PLUGIN_NOT_FOUND: 'RN_PLUGIN_NOT_FOUND',
  PLUGIN_STATE_INVALID: 'RN_PLUGIN_STATE_INVALID',
  PLUGIN_LOAD_FAILED: 'RN_PLUGIN_LOAD_FAILED',
  PLUGIN_START_FAILED: 'RN_PLUGIN_START_FAILED',
  PLUGIN_STOP_FAILED: 'RN_PLUGIN_STOP_FAILED',

  /* 注册表 */
  SERVICE_DUPLICATE: 'RN_SERVICE_DUPLICATE',
  SERVICE_NOT_FOUND: 'RN_SERVICE_NOT_FOUND',
  ROUTE_CONFLICT: 'RN_ROUTE_CONFLICT',
  SLOT_DUPLICATE: 'RN_SLOT_DUPLICATE',

  /* 主题 */
  THEME_NOT_FOUND: 'RN_THEME_NOT_FOUND',
  THEME_INVALID: 'RN_THEME_INVALID',
  THEME_TEMPLATE_MISSING: 'RN_THEME_TEMPLATE_MISSING',
  THEME_SETTING_INVALID: 'RN_THEME_SETTING_INVALID',
  THEME_ARCHIVE_UNSAFE: 'RN_THEME_ARCHIVE_UNSAFE',

  /* 插件包安装 */
  PLUGIN_ARCHIVE_UNSAFE: 'RN_PLUGIN_ARCHIVE_UNSAFE',
  PLUGIN_INSTALL_FAILED: 'RN_PLUGIN_INSTALL_FAILED',

  /* 系统：日志与备份 */
  LOG_PATH_UNSAFE: 'RN_LOG_PATH_UNSAFE',
  BACKUP_FAILED: 'RN_BACKUP_FAILED',
  BACKUP_TOOL_MISSING: 'RN_BACKUP_TOOL_MISSING',
  RESTORE_FAILED: 'RN_RESTORE_FAILED',

  /* 数据库与迁移 */
  DB_UNAVAILABLE: 'RN_DB_UNAVAILABLE',
  MIGRATION_LOCKED: 'RN_MIGRATION_LOCKED',
  MIGRATION_FAILED: 'RN_MIGRATION_FAILED',

  /* 安全 */
  UNAUTHENTICATED: 'RN_UNAUTHENTICATED',
  FORBIDDEN: 'RN_FORBIDDEN',
  CSRF_INVALID: 'RN_CSRF_INVALID',
  RATE_LIMITED: 'RN_RATE_LIMITED',

  /* 通用 */
  VALIDATION_FAILED: 'RN_VALIDATION_FAILED',
  NOT_FOUND: 'RN_NOT_FOUND',
  REVISION_CONFLICT: 'RN_REVISION_CONFLICT',
  RECOVERY_MODE: 'RN_RECOVERY_MODE',
  INTERNAL: 'RN_INTERNAL'
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface RiceNoteErrorOptions {
  status?: number;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/** RiceNote 领域错误：携带稳定错误码与建议 HTTP 状态码。 */
export class RiceNoteError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: Record<string, unknown>;

  constructor(code: string, message: string, options: RiceNoteErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RiceNoteError';
    this.code = code;
    this.status = options.status ?? 500;
    this.details = options.details ?? {};
  }

  /** 转为可安全返回给客户端的最小结构。 */
  toJSON(): { error: { code: string; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(Object.keys(this.details).length > 0 ? { details: this.details } : {})
      }
    };
  }
}

/** 判断是否为 RiceNote 领域错误。 */
export function isRiceNoteError(value: unknown): value is RiceNoteError {
  return value instanceof RiceNoteError;
}

export function notFound(message: string, details?: Record<string, unknown>): RiceNoteError {
  return new RiceNoteError(ErrorCode.NOT_FOUND, message, { status: 404, details });
}

export function validationFailed(message: string, details?: Record<string, unknown>): RiceNoteError {
  return new RiceNoteError(ErrorCode.VALIDATION_FAILED, message, { status: 400, details });
}

export function unauthenticated(message = '未登录或会话已失效'): RiceNoteError {
  return new RiceNoteError(ErrorCode.UNAUTHENTICATED, message, { status: 401 });
}

export function forbidden(message = '当前身份无权执行该操作'): RiceNoteError {
  return new RiceNoteError(ErrorCode.FORBIDDEN, message, { status: 403 });
}

export function conflict(
  code: string,
  message: string,
  details?: Record<string, unknown>
): RiceNoteError {
  return new RiceNoteError(code, message, { status: 409, details });
}

export function internal(message: string, cause?: unknown): RiceNoteError {
  return new RiceNoteError(ErrorCode.INTERNAL, message, { status: 500, cause });
}
