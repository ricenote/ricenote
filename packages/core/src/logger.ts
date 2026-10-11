/**
 * 结构化日志。
 *
 * 双通道输出（关键设计）：
 * - **日志文件**永远是 JSON Lines：可被 `LogsReader` / 采集器稳定解析；
 * - **终端**默认人可读（对齐、着色、键值对），仅在交互式终端或显式
 *   `LOG_FORMAT=pretty` 时启用，非 TTY（CI、被重定向到文件）自动降级为 JSON，
 *   避免把控制字符写进流水线。
 *
 * 另外内置敏感字段脱敏，避免会话密钥、密码被写入日志。
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

/** 终端输出格式。 */
export type LogFormat = 'pretty' | 'json';

/**
 * 解析终端输出格式。
 *
 * 优先级：显式参数 → `LOG_FORMAT` 环境变量 → TTY 自动判断。
 * 非交互式环境（被重定向、CI）默认 JSON，避免控制字符污染管道。
 */
export function resolveLogFormat(value?: string): LogFormat {
  const explicit = (value ?? process.env.LOG_FORMAT ?? '').trim().toLowerCase();
  if (explicit === 'pretty') return 'pretty';
  if (explicit === 'json') return 'json';
  return process.stdout.isTTY === true ? 'pretty' : 'json';
}

/** 终端着色开关：非 TTY 或显式 NO_COLOR 时关闭。 */
function useColor(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}

const COLOR: Record<LogLevel, string> = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m'
};
const RESET = '\u001b[0m';
const DIM = '\u001b[90m';

export interface LoggerOptions {
  level: LogLevel;
  /** 写入日志文件的绝对路径；为空则只输出到 stdout。 */
  filePath?: string;
  /** 附加到每条日志的固定字段。 */
  bindings?: Record<string, unknown>;
  /** 终端输出格式；缺省自动判断。日志文件不受影响，始终为 JSON Lines。 */
  format?: LogFormat;
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
  private readonly format: LogFormat;
  private fileReady = false;

  constructor(private readonly options: LoggerOptions) {
    this.threshold = LEVEL_WEIGHT[options.level];
    this.format = options.format ?? resolveLogFormat();
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

    const jsonLine = `${JSON.stringify(record)}\n`;
    const consoleLine = this.format === 'pretty' ? prettyLine(record, useColor()) : jsonLine;

    if (level === 'error' || level === 'warn') {
      process.stderr.write(consoleLine);
    } else {
      process.stdout.write(consoleLine);
    }

    // 文件始终写结构化 JSON：终端格式只影响人眼，不影响可检索性
    if (this.fileReady && this.options.filePath) {
      try {
        appendFileSync(this.options.filePath, jsonLine, 'utf8');
      } catch {
        /* 日志文件不可写时静默降级，不影响主流程 */
      }
    }
  }
}

/** 把一条日志记录渲染为人可读的一行。 */
function prettyLine(record: Record<string, unknown>, color: boolean): string {
  const { ts, level, message, ...rest } = record;
  const { bindings, fields } = splitFields(rest);

  const time = typeof ts === 'string' ? ts.slice(11, 19) : '--:--:--';
  const levelText = String(level ?? 'info').toUpperCase().padEnd(5);
  const scope = bindings.length > 0 ? ` ${bindings.join(' ')}` : '';
  const suffix = fields.length > 0 ? `  ${fields.join(' ')}` : '';

  if (!color) return `${time} ${levelText}${scope}${message}${suffix}\n`;
  const tint = COLOR[(level as LogLevel) ?? 'info'] ?? '';
  return `${DIM}${time}${RESET} ${tint}${levelText}${RESET}${DIM}${scope}${RESET} ${String(message)}${DIM}${suffix}${RESET}\n`;
}

/**
 * 拆分附加字段。
 *
 * 插件作用域（`plugin` / `requestId` 等）提到消息之前便于扫读，
 * 业务字段以 `key=value` 排在消息之后。
 */
function splitFields(rest: Record<string, unknown>): { bindings: string[]; fields: string[] } {
  const bindings: string[] = [];
  const fields: string[] = [];
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (key === 'plugin' || key === 'requestId') {
      bindings.push(`[${text}]`);
      continue;
    }
    fields.push(`${key}=${truncate(text)}`);
  }
  return { bindings, fields };
}

function truncate(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
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
