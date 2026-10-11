/**
 * 安装向导的 `.env` 读写。
 *
 * 设计要点：**增量更新，不重写整个文件**。
 * - 保留用户已有的注释、顺序与手写键（向导只碰它自己管理的键）；
 * - 幂等：重跑向导只会把值改成新值，不会产生重复行；
 * - 值需要时加引号（密码里可能有空格或 `#`，那会被 dotenv 当成注释）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 读取 `.env` 为键值表（不处理续行/变量插值，够用且可预测）。 */
export function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(file)) return values;

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1] as string] = unquote((match[2] ?? '').trim());
  }
  return values;
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

/** 需要引号时加双引号（含空白、`#`、引号的值）。 */
function formatValue(value: string): string {
  if (value.length === 0) return '""';
  if (/[\s#"']/.test(value)) return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return value;
}

export interface EnvUpdate {
  key: string;
  value: string;
}

export interface EnvWriteResult {
  updated: string[];
  added: string[];
}

/**
 * 写入（或更新）若干键。
 *
 * 已存在的键**原位替换**（保持上下文与注释），新键追加在文件末尾。
 */
export function upsertEnvFile(
  file: string,
  updates: readonly EnvUpdate[],
  options: { header?: string } = {}
): EnvWriteResult {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const pending = new Map(updates.map((item) => [item.key, item.value]));
  const updated: string[] = [];
  const added: string[] = [];

  // 空文件（或只有空白）不该先留一行空行，否则生成的 .env 以空行开头
  const lines = existing.trim().length === 0 ? [] : existing.split(/\r?\n/);
  const output: string[] = [];
  for (const line of lines) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line.trim());
    const key = match?.[1];
    if (key && pending.has(key)) {
      output.push(`${key}=${formatValue(pending.get(key) as string)}`);
      updated.push(key);
      pending.delete(key);
    } else {
      output.push(line);
    }
  }

  // 去掉尾部的空行，稍后统一补一个换行
  while (output.length > 0 && output[output.length - 1]?.trim() === '') output.pop();

  if (pending.size > 0) {
    if (options.header) output.push('', options.header);
    for (const [key, value] of pending) {
      output.push(`${key}=${formatValue(value)}`);
      added.push(key);
    }
  }

  writeFileSync(file, `${output.join('\n')}\n`);
  return { updated, added };
}

/** 生成高熵 `SESSION_SECRET`（base64url，48 字节）。 */
export function generateSessionSecret(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/**
 * 生成初始管理员密码。
 *
 * 形如 `rn-XXXX-XXXX-XXXX`：足够长、包含字母数字与连字符，
 * 满足"至少 8 位且不能为纯数字"的校验，同时方便抄写。
 */
export function generateAdminPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);

  let out = 'rn';
  for (const [index, byte] of bytes.entries()) {
    if (index > 0 && index % 6 === 0) out += '-';
    out += alphabet[byte % alphabet.length];
  }
  return out;
}

/** 拼 `DATABASE_URL`（密码做 URL 编码，避免 `@`、`:` 破坏连接串）。 */
export function buildDatabaseUrl(input: {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}): string {
  const credentials = `${encodeURIComponent(input.user)}${
    input.password.length > 0 ? `:${encodeURIComponent(input.password)}` : ''
  }`;
  return `mysql://${credentials}@${input.host}:${input.port}/${input.name}`;
}

/** `.env` 文件路径。 */
export function envFilePath(rootDir: string): string {
  return path.join(rootDir, '.env');
}
