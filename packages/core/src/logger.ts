/**
 * 结构化日志。
 *
 * - 输出 JSON Lines，便于采集与检索；
 * - 自动附加请求 ID 与插件边界字段；
 * - 内置敏感字段脱敏，避免会话密钥、密码被写入日志。
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

/** 需要脱敏的字段名（大小写不敏感）。 */
const SENSITIVE_KEY = /(password|passwd|secret|token|credential|authorization|cookie)/i;

export interface LoggerOptions {
  level: LogLevel;
  /** 写入日志文件的绝对路径；为空则只输出到 stdout。 */
  filePath?: string;
  /** 附加到每条日志的固定字段。 */
  bindings?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  /** 创建带附加字段的子日志器（例如绑定 pluginId / requestId）。 */
  child(bindings: Record<string, unknown>): Logger;
}

/** 递归脱敏：命中敏感键名的值替换为 [redacted]。 */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(inner, depth + 1);
  }
  return output;
}

class JsonLogger implements Logger {
  private readonly threshold: number;
  private fileReady = false;

  constructor(private readonly options: LoggerOptions) {
    this.threshold = LEVEL_WEIGHT[options.level];
    if (options.filePath) {
      try {
        mkdirSync(path.dirname(options.filePath), { recursive: true });
        this.fileReady = true;
      } catch {
        this.fileReady = false;
      }
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new JsonLogger({
      ...this.options,
      bindings: { ...this.options.bindings, ...bindings }
    });
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < this.threshold) return;

    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      message,
      ...this.options.bindings,
      ...(meta ? (sanitize(meta) as Record<string, unknown>) : {})
    };

    const line = `${JSON.stringify(record)}\n`;
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
    if (this.fileReady && this.options.filePath) {
      try {
        appendFileSync(this.options.filePath, line, 'utf8');
      } catch {
        /* 日志文件不可写时静默降级，不影响主流程 */
      }
    }
  }
}

/** 创建日志器。 */
export function createLogger(options: LoggerOptions): Logger {
  return new JsonLogger(options);
}

/** 解析日志级别字符串，非法值回退为 info。 */
export function parseLogLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  if (!value) return fallback;
  const normalized = value.toLowerCase() as LogLevel;
  return LOG_LEVELS.includes(normalized) ? normalized : fallback;
}
