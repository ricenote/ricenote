/**
 * 迁移协调器。
 *
 * 设计要点（说明书第 8 章）：
 * - 所有迁移（Core 与插件）由 Core **串行编排并加锁**执行；
 * - 每个迁移记录 SHA-256 校验值；历史迁移被篡改时拒绝启动；
 * - 插件停用不 drop 表，迁移只做前向演进；
 * - 使用独立的、开启 `multipleStatements` 的连接执行 DDL，主连接池保持收紧。
 */

import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import type { RiceNoteConfig } from '../config/loader.js';
import type { Logger } from '../logger.js';
import { CORE_MIGRATIONS, type CoreMigration } from './core-migrations.js';

/** 迁移锁名称：全局唯一，避免多实例并发迁移。 */
export const MIGRATION_LOCK_NAME = 'ricenote:migrate';
const MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

export interface MigrationSource {
  /** 归属：`core` 或 `plugin:<pluginId>`。 */
  scope: string;
  migrations: CoreMigration[];
}

export interface MigrationOutcome {
  scope: string;
  applied: string[];
  skipped: string[];
}

interface LedgerRow extends mysql.RowDataPacket {
  migration: string;
  checksum: string;
}

/** 计算迁移内容的 SHA-256 校验值（忽略行尾差异）。 */
export function checksumOf(sql: string): string {
  const normalized = sql.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export class MigrationCoordinator {
  private readonly connectionOptions: mysql.ConnectionOptions;

  constructor(
    config: RiceNoteConfig,
    private readonly logger: Logger
  ) {
    this.connectionOptions = {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
      charset: 'utf8mb4_unicode_ci',
      // 迁移文件包含多条语句，必须开启多语句支持
      multipleStatements: true
    };
  }

  /** 创建迁移编排表（幂等），必须在任何迁移前调用。 */
  async ensureLedger(): Promise<void> {
    const connection = await this.connect();
    try {
      await connection.query(`
CREATE TABLE IF NOT EXISTS rn_plugin_migrations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope       VARCHAR(160)    NOT NULL,
  migration   VARCHAR(255)    NOT NULL,
  checksum    VARCHAR(64)     NOT NULL,
  applied_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_plugin_migrations (scope, migration)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`);
    } finally {
      await connection.end();
    }
  }

  /** 获取全局迁移锁；返回是否成功。 */
  async acquireLock(): Promise<boolean> {
    const connection = await this.connect();
    try {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT GET_LOCK(?, ?) AS acquired',
        [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS]
      );
      const acquired = Number((rows[0] as { acquired?: number } | undefined)?.acquired ?? 0);
      return acquired === 1;
    } finally {
      await connection.end();
    }
  }

  /** 释放全局迁移锁。 */
  async releaseLock(): Promise<void> {
    const connection = await this.connect();
    try {
      await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK_NAME]);
    } finally {
      await connection.end();
    }
  }

  /** 执行 Core 迁移。 */
  async applyCore(): Promise<MigrationOutcome> {
    return this.apply({ scope: 'core', migrations: CORE_MIGRATIONS });
  }

  /**
   * 执行一组迁移：
   * 1. 读取已应用记录；
   * 2. 校验已应用迁移的 checksum 未被篡改；
   * 3. 顺序执行未应用的迁移并落库。
   */
  async apply(source: MigrationSource): Promise<MigrationOutcome> {
    const connection = await this.connect();
    const applied: string[] = [];
    const skipped: string[] = [];

    try {
      const [rows] = await connection.query<LedgerRow[]>(
        'SELECT migration, checksum FROM rn_plugin_migrations WHERE scope = ?',
        [source.scope]
      );
      const ledger = new Map(rows.map((row) => [row.migration, row.checksum]));

      for (const migration of source.migrations) {
        const checksum = checksumOf(migration.sql);
        const recorded = ledger.get(migration.name);

        if (recorded !== undefined) {
          if (recorded !== checksum) {
            throw new RiceNoteError(
              ErrorCode.MIGRATION_FAILED,
              `迁移 ${source.scope}/${migration.name} 的内容已被修改（checksum 不一致）`,
              {
                status: 500,
                details: { scope: source.scope, migration: migration.name, recorded, actual: checksum }
              }
            );
          }
          skipped.push(migration.name);
          continue;
        }

        this.logger.info('执行迁移', { scope: source.scope, migration: migration.name });
        await connection.query(migration.sql);
        await connection.query(
          'INSERT INTO rn_plugin_migrations (scope, migration, checksum, applied_at) VALUES (?, ?, ?, NOW())',
          [source.scope, migration.name, checksum]
        );
        applied.push(migration.name);
      }
    } finally {
      await connection.end();
    }

    return { scope: source.scope, applied, skipped };
  }

  private connect(): Promise<mysql.Connection> {
    return mysql.createConnection(this.connectionOptions);
  }
}
