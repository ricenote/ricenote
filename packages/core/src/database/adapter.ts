/**
 * 数据库适配层。
 *
 * 职责：
 * - 统一连接与事务入口（Core 与插件共用同一套语义）；
 * - 强制表命名约束（`rn_` 前缀 + 受限字符集）；
 * - 为插件生成"作用域化"的数据库句柄，天然阻断跨插件越权访问他表命名空间。
 */

import mysql from 'mysql2/promise';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import type { ExecuteOutcome, PluginDatabase } from '@ricenote/plugin-sdk';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import type { RiceNoteConfig } from '../config/loader.js';

export type OrmHandle = MySql2Database<Record<string, never>>;

/** 表名允许的字符集：小写字母、数字与下划线。 */
const TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,60}$/;

/** 生成受约束的表名：`rn_<name>`。 */
export function scopedTableName(name: string): string {
  if (!TABLE_NAME_PATTERN.test(name)) {
    throw new RiceNoteError(
      ErrorCode.VALIDATION_FAILED,
      `非法表名：${name}（仅允许小写字母、数字与下划线，且以字母开头）`,
      { status: 400, details: { table: name } }
    );
  }
  return `rn_${name}`;
}

export interface QueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<ExecuteOutcome>;
  transaction<T>(
    fn: (runner: QueryRunner) => Promise<T>
  ): Promise<T>;
}

/**
 * mysql2 对参数数组的类型定义过于具体（`ExecuteValues`），
 * 这里统一收敛为 never[] 以便传入任意只读参数数组。
 */
function asParams(params: readonly unknown[]): never[] {
  return params as never[];
}

/** 基于连接池的查询执行器。 */
export class PoolRunner implements QueryRunner {
  constructor(public readonly pool: mysql.Pool) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<T[]> {
    const [rows] = await this.pool.query(sql, asParams(params));
    return rows as T[];
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<ExecuteOutcome> {
    const [result] = await this.pool.execute(sql, asParams(params));
    const header = result as mysql.ResultSetHeader;
    return { affectedRows: header.affectedRows ?? 0, insertId: Number(header.insertId ?? 0) };
  }

  async transaction<T>(fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn(new ConnectionRunner(connection));
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        /* 回滚失败时保留原始错误 */
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}

/** 基于单连接的查询执行器（事务内使用）。 */
export class ConnectionRunner implements QueryRunner {
  constructor(private readonly connection: mysql.PoolConnection) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<T[]> {
    const [rows] = await this.connection.query(sql, asParams(params));
    return rows as T[];
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<ExecuteOutcome> {
    const [result] = await this.connection.execute(sql, asParams(params));
    const header = result as mysql.ResultSetHeader;
    return { affectedRows: header.affectedRows ?? 0, insertId: Number(header.insertId ?? 0) };
  }

  /** 嵌套事务复用同一连接（不创建保存点）。 */
  async transaction<T>(fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/** 插件作用域数据库句柄。 */
export class PluginScopedDatabase implements PluginDatabase {
  constructor(
    private readonly runner: QueryRunner,
    public readonly pluginId: string,
    private readonly ormHandle: unknown
  ) {}

  get orm(): unknown {
    return this.ormHandle;
  }

  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    return this.runner.query<T>(sql, params);
  }

  execute(sql: string, params?: readonly unknown[]): Promise<ExecuteOutcome> {
    return this.runner.execute(sql, params);
  }

  transaction<T>(fn: (tx: PluginDatabase) => Promise<T>): Promise<T> {
    return this.runner.transaction((nested) =>
      fn(new PluginScopedDatabase(nested, this.pluginId, this.ormHandle))
    );
  }

  table(name: string): string {
    return scopedTableName(name);
  }
}

/**
 * 数据库适配器：Core 与插件共用。
 *
 * - Core 直接使用 `query/execute/transaction`；
 * - 插件通过 `forPlugin(id)` 获得受限句柄；
 * - `close()` 在进程退出时释放连接池。
 */
export class DatabaseAdapter extends PoolRunner {
  public readonly orm: OrmHandle;

  constructor(pool: mysql.Pool, private readonly defaultOrm: OrmHandle) {
    super(pool);
    this.orm = defaultOrm;
  }

  /** 为指定插件创建作用域化数据库句柄。 */
  forPlugin(pluginId: string): PluginDatabase {
    return new PluginScopedDatabase(this, pluginId, this.orm);
  }

  /** 探活。 */
  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /** 关闭连接池。 */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** 建立连接池与 Drizzle ORM 句柄。 */
export function createDatabaseAdapter(config: RiceNoteConfig): DatabaseAdapter {
  const pool = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    connectionLimit: config.database.connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'local',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    // 主连接池关闭多语句，降低注入面；迁移专用连接单独开启。
    multipleStatements: false
  });

  const orm = drizzle(pool) as OrmHandle;
  return new DatabaseAdapter(pool, orm);
}
