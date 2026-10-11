/**
 * 安装向导专用的「建库 + 连通性校验」。
 *
 * 为什么需要它：`createDatabaseAdapter` 必须连到**已存在**的库（配置里的库名），
 * 而全新安装时那个库还不存在 —— 这是当前安装流程里最直接的摩擦点。
 *
 * 安全：库名会被拼进 DDL（`CREATE DATABASE` 不支持参数占位），因此先做
 * **标识符白名单校验**（只允许字母、数字、下划线与 `$`），再用反引号包裹。
 */

import mysql from 'mysql2/promise';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';

export interface EnsureDatabaseInput {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

/** 合法的库名：字母开头，只含字母/数字/下划线/$，长度 1–64。 */
const DATABASE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_$]{0,63}$/;

/** 校验库名（返回错误信息；通过时返回 undefined）。 */
export function validateDatabaseName(name: string): string | undefined {
  if (name.trim().length === 0) return '库名不能为空';
  if (!DATABASE_NAME_PATTERN.test(name.trim())) {
    return '库名只能是字母开头、由字母/数字/下划线/$ 组成（长度不超过 64）';
  }
  return undefined;
}

/**
 * 确保数据库存在并可连接。
 *
 * 两步：先用**不带 database** 的连接建库（幂等），再用带库的连接做一次
 * 真实握手 —— 这样"库建好了但账号没权限"也会在向导里立刻暴露，
 * 而不是等到启动内核时才报错。
 */
export async function ensureDatabase(input: EnsureDatabaseInput): Promise<{ created: boolean }> {
  const problem = validateDatabaseName(input.name);
  if (problem) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, problem, {
      status: 400,
      details: { database: input.name }
    });
  }

  const name = input.name.trim();
  const base = {
    host: input.host,
    port: input.port,
    user: input.user,
    password: input.password,
    connectTimeout: 10_000
  };

  let created = false;
  let admin: mysql.Connection | undefined;
  try {
    admin = await mysql.createConnection(base);
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [name]
    );
    created = rows.length === 0;
    if (created) {
      // DDL 不能用参数占位；库名已在上面做过标识符白名单校验
      await admin.query(
        `CREATE DATABASE \`${name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    }
  } catch (error) {
    throw new RiceNoteError(
      ErrorCode.DB_UNAVAILABLE,
      `无法连接 MySQL（${input.host}:${input.port}）或创建数据库：${
        error instanceof Error ? error.message : String(error)
      }`,
      { status: 503, details: { host: input.host, port: input.port, database: name } }
    );
  } finally {
    await admin?.end().catch(() => undefined);
  }

  // 用目标库再握一次手：确认账号对该库有权限（避免"建好了却连不上"）
  let target: mysql.Connection | undefined;
  try {
    target = await mysql.createConnection({ ...base, database: name });
    await target.query('SELECT 1');
  } catch (error) {
    throw new RiceNoteError(
      ErrorCode.DB_UNAVAILABLE,
      `数据库 ${name} 已存在，但账号 ${input.user} 无法连接它：${
        error instanceof Error ? error.message : String(error)
      }`,
      { status: 503, details: { database: name, user: input.user } }
    );
  } finally {
    await target?.end().catch(() => undefined);
  }

  return { created };
}
