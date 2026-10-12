# 数据层与迁移

相关源码：`packages/core/src/database/`（`adapter.ts`、`migrate-coordinator.ts`、`schema/core.ts`、`core-migrations.ts`）、
`packages/core/src/plugins/plugin-store.ts`。

---

## 1. 数据库适配层

### 连接池

- 用 `mysql2` 创建连接池，`multipleStatements: false`（**禁止多语句**，降低注入放大面）；
- 池上限由 `DB_CONNECTION_LIMIT` 控制（默认 10）。

### 事务

统一的 `QueryRunner` 接口：

```ts
transaction<T>(fn: (runner: QueryRunner) => Promise<T>): Promise<T>
```

- 池级别开启事务（begin / commit / rollback / release）；
- 在事务内再次调用 `transaction()` 会**复用同一连接**（正确的嵌套语义，不会死锁）。

### 表命名约束

`scopedTableName(name)` 强制：

```
必须匹配 /^[a-z][a-z0-9_]{0,60}$/，否则抛 VALIDATION_FAILED
返回 `rn_<name>`
```

这是"所有表以 `rn_` 开头"这条约定的落地方式 —— 插件无法注册任意名字的表。

### 插件作用域句柄

```ts
db.forPlugin(pluginId)   // 返回 PluginScopedDatabase
ctx.db.table('posts')    // 在插件上下文里使用
```

**能力门**：`ctx.db` 只有在清单声明了 `database:own` 时才可用；否则拿到的是拒绝桩，调用即抛 `RN_FORBIDDEN`（403）。

> ⚠️ **如实澄清一处误读**：源码注释中曾表述为"天然阻断跨插件越权访问他表命名空间"，
> 但**当前实现强制的只有 `rn_` 前缀与表名字符集约束**，**没有**按插件 ID 生成前缀（如 `rn_<pluginId>_`），
> 也没有针对"插件 A 查询插件 B 的表"的运行时拦截。
> 也就是说：*不越界访问他表* 是**架构约定 + 代码评审**保证的，不是强制边界。
> 需要硬隔离时请通过对方的 capability 契约读取数据。

---

## 2. 迁移协调器

### 账本

迁移记录在**核心表** `rn_plugin_migrations` 中（`ensureLedger()` 创建），字段含迁移标识与 **SHA-256 校验值**。

### 加锁

- 锁名：`ricenote:migrate`
- 超时：30 秒
- 实现：MySQL 的 `SELECT GET_LOCK(?, ?)` / `RELEASE_LOCK`

因此**多个进程同时启动**时，只有一个会执行迁移，其余等待或拿到 `RN_MIGRATION_LOCKED`（503）。
这让并发的容器扩缩容不会踩库。

### 执行

`apply(source)`：

1. 读已应用的迁移记录；
2. 对每个"已应用"的迁移**重新计算 checksum 并比对**；
3. 按顺序执行尚未应用的迁移，执行后写入记录（含 checksum）。

### 校验值防线（最重要的一条）

checksum 的计算范围是：

```
sha256( sql.replace(/\r\n/g, '\n').trim() )     // 十六进制
```

**统一换行符、去掉首尾空白** —— 这是为了让"仅行尾风格不同"的编辑不误报。

一旦发现**已应用**的迁移内容与记录不符，抛 `RN_MIGRATION_FAILED`（500），**拒绝启动**。

> 为什么这么严：迁移一旦执行就改变了库结构，而**迁移不可逆**（只有前向演进）。
> 允许"悄悄改历史"会让不同环境的库结构无声地分叉。
> 正确做法是**新增一个迁移文件**。

### 幂等

重复执行是安全的：已应用的迁移会被跳过（`pnpm migrate` 会打印"新增 N 项，跳过 M 项"）。

---

## 3. 数据演进的三条规矩

| 规矩 | 原因 |
| --- | --- |
| **不要修改已应用的迁移文件** | SHA-256 校验会让内核拒绝启动 |
| **迁移不可逆，升级前必须备份** | 没有 down 迁移；回退代码不会回退库结构 |
| **插件停用不删表** | 重新启用后数据仍在；删数据只能显式做 |

插件停用只删除 `rn_plugins` 中的元数据记录，**数据表保留**。这一点在 `manager.forget()` 与
`plugin-store.remove()` 中都有明确注释。

---

## 4. Core 表一览

| 表 | 用途 |
| --- | --- |
| `rn_plugin_migrations` | 迁移账本（标识 + checksum + 应用时间） |
| `rn_plugins` | 插件元数据：状态、启用标记、`last_error`、来源（`source_type` / `source_spec` / `source_ref` / `resolved_version` / `integrity` / `installed_via`） |
| `rn_site_state` | 运行标记（`runtime_status`）、待重启（`restart_required` / `restart_reason` / `restart_requested_at`） |
| `rn_site_settings` | 站点信息的**稀疏覆盖**（只存被改过的字段） |
| `rn_theme_settings` / `rn_theme_setting_revisions` | 主题设置当前值与历史（同事务写入，支撑回滚） |
| `rn_audit_logs` | 审计：`site_id` / `actor_id` / `actor_name` / `action` / `target_type` / `target_id` / `ip` / `request_id` / `detail_json` / `created_at` |
| `rn_plugin_jobs` | 插件安装任务：串行队列、步骤与进度、末尾 64KB 日志、错误原因、操作者与起止时间 |

---

## 5. 站点信息的"稀疏覆盖"模型

```
生效值 = .env 默认值 + 数据库稀疏覆盖
```

- 后台「系统设置」只写**被改动的字段**；清空某字段即回落到 `.env` 默认值；
- `ctx.site` 是**动态取值**（渲染时实时读取），因此站点信息**无需重启**即可生效；
- 站点信息有独立的 `revision`，参与 HTML 缓存键 —— 改完标题，旧缓存自动失效。

相比之下 `ctx.config` 是**启动期快照**：改 `.env` 必须重启。
这个区分是理解"为什么有的配置改了立刻生效、有的必须重启"的钥匙。

---

## 6. 自查入口

| 想做 | 怎么做 |
| --- | --- |
| 看已应用的迁移 | 查表 `rn_plugin_migrations` |
| 验证迁移是否会被跳过 | `pnpm migrate` 输出"新增 N，跳过 M" |
| 排查校验值不匹配 | 找出被改动的迁移文件并恢复原样 |
| 备份 | 后台「备份与恢复」（`mysqldump` + `storage/uploads` + 清单，流式 ZIP） |
| 恢复 | 上传备份 → **只读预览** → 恢复（自动先做当前状态快照） |

备份工具缺失时接口返回结构化 `RN_BACKUP_TOOL_MISSING`（503），而不是 500 —— 便于前端给出可操作提示。
MySQL 客户端未在 PATH 时用 `MYSQLDUMP_BIN` / `MYSQL_BIN` 指定绝对路径。

---

## 相关页面

- [[启动时序|Development/Architecture/Core-Bootstrap]]
- [[安全控制面|Development/Architecture/Security]]
- [[升级已部署实例|Upgrading]]
- [[故障排查|Troubleshooting]]
