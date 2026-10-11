/**
 * 运行日志读取（后台「系统 · 日志」只读视图）。
 *
 * 设计要点：
 * - **只读尾部**：日志文件会持续增长，按字节从文件末尾读取有限窗口，
 *   内存占用与文件大小无关（说明书第 10 章「性能」）；
 * - **路径归一化校验**：文件名必须落在 logsDir 内且不含目录分隔符，
 *   阻断 `../` 之类的越权读取；
 * - **宽解析**：非 JSON 行不丢弃，按原文展示，避免日志查看器"吞掉"异常输出。
 */

import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ErrorCode,
  RiceNoteError,
  type LogLevelName,
  type RuntimeLogEntry,
  type RuntimeLogFileInfo,
  type RuntimeLogQuery
} from '@ricenote/shared';

/** 每个日志文件默认最多读取的尾部字节数（2MB）。 */
const DEFAULT_TAIL_BYTES = 2 * 1024 * 1024;
/** 单次查询最多聚合的命中条数，达到上限后标记 truncated。 */
const DEFAULT_MAX_ENTRIES = 5000;
/** 单页最大条数。 */
const MAX_PAGE_SIZE = 200;

const LOG_FILE_PATTERN = /\.log$/i;
const LEVELS: readonly LogLevelName[] = ['debug', 'info', 'warn', 'error'];

export interface LogsReaderOptions {
  logsDir: string;
  tailBytes?: number;
  maxEntries?: number;
}

export interface LogsQueryResult {
  items: RuntimeLogEntry[];
  /** 扫描窗口内的命中条数（窗口含义见 {@link LogsQueryResult.truncated}）。 */
  total: number;
  scannedLines: number;
  /** 达到 maxEntries 上限而提前停止：此时 total 可能小于实际命中总数。 */
  truncated: boolean;
  /** 本次读取覆盖的文件名（按读取顺序）。 */
  files: string[];
}

export class LogsReader {
  private readonly logsDir: string;
  private readonly tailBytes: number;
  private readonly maxEntries: number;

  constructor(options: LogsReaderOptions) {
    this.logsDir = path.resolve(options.logsDir);
    this.tailBytes = Math.max(4096, options.tailBytes ?? DEFAULT_TAIL_BYTES);
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  /** 列出可读取的日志文件（按最近修改倒序）。 */
  listFiles(): RuntimeLogFileInfo[] {
    if (!existsSync(this.logsDir)) return [];

    return readdirSync(this.logsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LOG_FILE_PATTERN.test(entry.name))
      .map((entry) => {
        const stat = statSync(path.join(this.logsDir, entry.name));
        return { name: entry.name, size: stat.size, updatedAt: stat.mtime.toISOString() };
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /**
   * 查询日志。
   *
   * 读取顺序为"最新文件 → 更旧文件，同一文件内从新到旧"，
   * 因此分页取到的总是最近的记录。
   */
  query(input: RuntimeLogQuery = {}): LogsQueryResult {
    const page = Math.max(1, Math.trunc(input.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(input.pageSize ?? 20)));
    const level = input.level && input.level !== 'all' ? input.level : undefined;
    const keyword = input.keyword?.trim().toLowerCase();

    const targets = input.file
      ? [this.resolveFile(input.file)]
      : this.listFiles().map((file) => path.join(this.logsDir, file.name));

    // ISO 8601 字符串可直接按字典序比较，无需解析成 Date
    const from = normalizeBound(input.from);
    const to = normalizeBound(input.to);

    const matched: RuntimeLogEntry[] = [];
    const readFiles: string[] = [];
    let scannedLines = 0;
    let truncated = false;

    for (const filePath of targets) {
      if (truncated) break;
      const fileName = path.basename(filePath);
      const lines = this.readTailLines(filePath);
      readFiles.push(fileName);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const entry = parseLine(lines[index] ?? '', fileName, index + 1);
        scannedLines += 1;
        if (!entry) continue;
        if (level && entry.level !== level) continue;
        if (keyword && !matchesKeyword(entry, keyword)) continue;
        if (!inTimeRange(entry.timestamp, from, to)) continue;

        matched.push(entry);
        if (matched.length >= this.maxEntries) {
          truncated = true;
          break;
        }
      }
    }

    matched.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

    const start = (page - 1) * pageSize;
    return {
      items: matched.slice(start, start + pageSize),
      total: matched.length,
      scannedLines,
      truncated,
      files: readFiles
    };
  }

  /** 校验并解析日志文件名，确保不越出 logsDir。 */
  private resolveFile(name: string): string {
    const base = path.basename(name);
    if (base !== name || !LOG_FILE_PATTERN.test(base)) {
      throw new RiceNoteError(ErrorCode.LOG_PATH_UNSAFE, `非法的日志文件名：${name}`, { status: 400 });
    }

    const resolved = path.resolve(this.logsDir, base);
    if (!resolved.startsWith(`${this.logsDir}${path.sep}`)) {
      throw new RiceNoteError(ErrorCode.LOG_PATH_UNSAFE, `日志路径越出日志目录：${name}`, { status: 400 });
    }
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      throw new RiceNoteError(ErrorCode.NOT_FOUND, `日志文件不存在：${name}`, { status: 404 });
    }

    return resolved;
  }

  /** 从文件尾部读取有限字节并切分为行（不从头读取，避免大文件占满内存）。 */
  private readTailLines(filePath: string): string[] {
    const descriptor = openSync(filePath, 'r');
    try {
      const size = fstatSync(descriptor).size;
      const start = Math.max(0, size - this.tailBytes);
      const length = size - start;
      if (length <= 0) return [];

      const buffer = Buffer.allocUnsafe(length);
      const read = readSync(descriptor, buffer, 0, length, start);
      const text = buffer.subarray(0, read).toString('utf8');
      const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));

      // 未从文件头开始时，首行很可能是被截断的半行
      if (start > 0) lines.shift();
      return lines;
    } finally {
      closeSync(descriptor);
    }
  }
}

/** 宽松解析一行日志：非 JSON 行按原文保留。 */
function parseLine(raw: string, file: string, line: number): RuntimeLogEntry | undefined {
  const text = raw.trim();
  if (text.length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unparsedEntry(text, file, line);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return unparsedEntry(text, file, line);
  }

  const record = parsed as Record<string, unknown>;
  const { ts, time, level, message, ...rest } = record;

  return {
    file,
    line,
    timestamp: toText(ts ?? time),
    level: normalizeLevel(level),
    message: toText(message),
    fields: rest
  };
}

function unparsedEntry(text: string, file: string, line: number): RuntimeLogEntry {
  return { file, line, timestamp: '', level: 'info', message: text, fields: { unparsed: true } };
}

function normalizeLevel(value: unknown): LogLevelName {
  if (typeof value === 'string') {
    const lowered = value.toLowerCase() as LogLevelName;
    if (LEVELS.includes(lowered)) return lowered;
  }
  return 'info';
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** 归一化时间边界：非法值返回 undefined（视为不限制）。 */
function normalizeBound(value: string | undefined): string | undefined {
  const text = (value ?? '').trim();
  if (text.length === 0) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * 时间范围过滤。
 *
 * 未携带时间戳的行（非 JSON 输出）在启用时间过滤时一律排除——
 * 无从判断其归属时间，宁可漏掉也不要给出错误结果。
 */
function inTimeRange(timestamp: string, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (timestamp.length === 0) return false;
  if (from && timestamp < from) return false;
  if (to && timestamp > to) return false;
  return true;
}

function matchesKeyword(entry: RuntimeLogEntry, keyword: string): boolean {
  if (entry.message.toLowerCase().includes(keyword)) return true;
  for (const value of Object.values(entry.fields)) {
    if (toText(value).toLowerCase().includes(keyword)) return true;
  }
  return false;
}
