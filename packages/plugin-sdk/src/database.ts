/**
 * 插件数据库访问契约。
 *
 * 设计约束（对应说明书第 8 章）：
 * - 插件只能操作自己拥有的表，禁止跨插件联表；
 * - 表名统一遵循 `rn_<插件短名>_<名称>` 命名约束，由 `table()` 生成；
 * - 迁移由 Core 的迁移协调器串行加锁执行，插件不自行执行 DDL；
 * - 复杂查询可通过 `orm` 使用 Drizzle 的类型安全能力（插件自行安装 drizzle-orm）。
 */

export interface ExecuteOutcome {
  affectedRows: number;
  insertId: number;
}

export interface PluginDatabase {
  /** 所属插件 ID。 */
  readonly pluginId: string;
  /**
   * Drizzle ORM 句柄（Core 内部使用 Drizzle + mysql2）。
   * 类型为 unknown 以避免 SDK 强制插件安装 drizzle-orm；
   * 需要类型安全查询的插件可安装 drizzle-orm 后自行断言。
   */
  readonly orm: unknown;
  /** 参数化只读查询。 */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** 参数化写入 / DDL，返回影响行数与自增 ID。 */
  execute(sql: string, params?: readonly unknown[]): Promise<ExecuteOutcome>;
  /** 事务包装：回调内共享同一连接与事务上下文。 */
  transaction<T>(fn: (tx: PluginDatabase) => Promise<T>): Promise<T>;
  /** 按命名约束生成属于该插件的表名。 */
  table(name: string): string;
}
