# 启动时序

`bootstrap()`（`packages/core/src/bootstrap.ts`）是整个内核的唯一入口：它把配置、数据库、注册表、安全组件、
主题、插件与渲染器按确定顺序装配起来，并在结束时产出一个内核对象。

理解它的价值：**几乎所有"启动失败"都能在这条链路上定位到具体一步**。

---

## 1. 逐步时序

| # | 阶段 | 调用 | 失败后果 |
| --- | --- | --- | --- |
| 1 | 配置加载与校验 | `loadConfig(options)` | 抛错（字段级错误信息） |
| 2 | 日志初始化 | `resolveLogFormat()` + `createLogger()` | —— |
| 3 | 启动日志 | `logger.info('RiceNote 启动中', …)` | —— |
| 4 | 数据库适配器 | `createDatabaseAdapter(config)` | —— |
| 5 | **数据库探活** | `db.ping()` | **抛 `RN_DB_UNAVAILABLE`（503）** 并关闭连接池 → 上层启动**诊断服务** |
| 6 | 迁移协调器 | `new MigrationCoordinator()` | —— |
| 7 | 迁移账本 | `migrations.ensureLedger()` | 抛错 |
| 8 | **加迁移锁** | `migrations.acquireLock()`（`GET_LOCK`） | **抛 `RN_MIGRATION_LOCKED`（503）** |
| 9 | 注册表 | `ServiceRegistry` / `EventBus` / `RouterRegistry` / `ExtensionRegistry` / `SlotRegistry` / `AdminMenuRegistry` / `HtmlCache` / Outbox | —— |
| 10 | 安全组件 | `SessionManager` / `CsrfManager` / `LoginThrottle` / `AuditLogger` / `SecurityGateway` | —— |
| 11 | **Core 迁移** | `migrations.applyCore()` | 校验值不符 → `RN_MIGRATION_FAILED`（500），拒绝启动 |
| 12 | 站点信息覆盖层 | `SiteSettingsProvider` + `ensureLoaded()` | 抛错 |
| 13 | 待重启状态 | `RestartCoordinator` + `load()` | 抛错 |
| 14 | 主题管理器 | `new ThemeManager()` | —— |
| 15 | **发布 Core 服务契约** | `services.provide('core', { security, theme, site, runtime, setup, html })` | 重复提供 → `RN_SERVICE_DUPLICATE` |
| 16 | 主题同步 | `themeManager.sync()` | 抛错 |
| 17 | **插件装配与启动** | `new PluginManager()` + `plugins.bootstrap()` | 单个插件失败**不中断全局**（记 `FAILED` 继续） |
| 18 | 安装任务队列 | `new PluginInstallRunner()` | —— |
| 19 | 渲染器 | `new ThemeRenderer()` | —— |
| 20 | 运行标记落库 | `UPDATE/INSERT rn_site_state … 'running'` | 抛错 |
| 21 | 释放迁移锁 | `migrations.releaseLock()` | —— |
| 22 | 清除待重启标记 | `restart.clearRestartRequired()` | —— |
| 23 | 启动摘要 | `printStartupBanner()` | —— |

阶段 11–22 处于同一个 `try` 中：任一异常都会**释放迁移锁 + 关闭连接池，然后原样抛出**（不做半死降级）。

> 注意阶段 20–22 的顺序：**先落 running 标记，再释放锁，最后清待重启标记**。
> 若上一次是因"待生效变更"而重启，新进程启动成功后会自动清除该标记，并在摘要中回显原因。

---

## 2. 恢复模式（recovery mode）

内核**不会因为缺少内容插件或数据库不可用而崩溃**，而是降级为可诊断的状态：

| 触发条件 | 行为 |
| --- | --- |
| **数据库不可用** | 由 `apps/server` 捕获 `RN_DB_UNAVAILABLE` 后启动**诊断服务**，渲染"数据库不可用"页面 |
| **没有任何页面路由提供者** | `GET /` 等返回 **503** 并渲染恢复页面 |
| 渲染器无可用主题 | 同上（回退页由 Core 内置的 `fallback.njk` 兜底） |

恢复页面会给出：站点标题与版本、**失败/无效插件列表**、依赖问题、清单校验问题、快速修复步骤，以及 `/api/health` 入口。

> 一个已知的实现细节：`ErrorCode.RECOVERY_MODE` 在错误码表里有定义，但**当前没有代码使用它** ——
> 恢复模式是通过 HTTP 503 + 页面实现的，不依赖该错误码。

---

## 3. `kernel.health()`

`GET /api/health` 的数据来自 `health()`，字段如下：

| 字段 | 含义 |
| --- | --- |
| `status` | `ok` \| `degraded` —— 当且仅当 ping 成功**且**无失败插件时为 `ok` |
| `version` | 应用版本 |
| `uptimeSeconds` | 已运行秒数 |
| `database` | `{ reachable, latencyMs }` |
| `plugins` | `{ started, failed, invalid }` 三个计数 |
| `theme` | `{ id, version }` 或 `null` |
| `cache` | HTML 缓存统计 |
| `node` | Node 版本 |
| `restartRequired` | 是否存在待生效变更 |

数据库完全不可用时，最小服务返回 **503 `RN_DB_UNAVAILABLE`**。

---

## 4. 启动摘要横幅

启动完成时打印一段结构化摘要（`packages/core/src/startup-banner.ts`），包含：

- 版本、环境、Node、根目录；
- 数据库 `host:port/db` 与延迟；
- 激活主题；
- 插件：已启动 / 失败 / 排除 / 无效（**失败与排除逐条列出，不静默**）；
- 路由计数（页面 / 管理 API / 原始）；
- 注册表计数（服务 / 插槽 / 事件订阅）；
- 监听地址与访问地址；
- 启动耗时；
- 若本次启动应用了待生效变更，回显原因。

> 终端输出是**可读格式**（时间对齐、级别着色、`key=value`，插件与请求 ID 前置）。
> **日志文件始终是 JSON Lines**；非 TTY 或 `LOG_FORMAT=json` 时终端也降级为 JSON。
> `resetup`/`validate` 这类不需要打印横幅的场景可关闭。

---

## 5. 关机

`kernel.shutdown()` 会：

1. 停止全部插件（`plugins.stopAll()`）；
2. 关闭数据库连接池；
3. 把 `rn_site_state.runtime_status` 写为 `stopped`。

软重启（见下）也是复用这条路径。

---

## 6. 进程内软重启

后台「待重启 → 一键重启」走的是 `ServerSupervisor`（`apps/server/src/runtime/supervisor.ts`）：

```
POST /api/admin/system/restart（权限 system.restart）
  → 立即返回 202
  → [graceMs 默认 300ms 后]
  → closing-http    : server.close()（等待 in-flight 请求结束）
  → shutting-down   : kernel.shutdown()
  → bootstrapping   : bootstrap({ rootDir })
  → listening       : 重新监听同一端口
```

- **重启期间的新请求**返回 **503 `RN_RESTART_IN_PROGRESS`**（带 `Retry-After: 5`），前端据此显示"服务重启中"而不是网络错误。
- **bootstrap 失败**时不会静默半死：回退到**诊断服务**并保留错误信息，然后抛出。
- 待重启标记持久化在 `rn_site_state`（`restart_required` / `restart_reason` / `restart_requested_at`），**跨进程重启仍可见**。

> ⚠️ 重要边界：进程内软重启**不重载模块代码**（Node ESM 缓存按 URL 生效）。
> 因此改插件/内核代码必须重启**进程**；后台按钮只解决**配置与启停**的生效。
> 见 [ADR-004 受控重启](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-004-controlled-restart.md) 与
> [ADR-012 进程内软重启](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-012-in-process-soft-restart.md)。

---

## 7. 自查入口

| 你想确认的事 | 看哪里 |
| --- | --- |
| 启动第几步失败 | 启动日志与启动摘要；按上表的错误码定位阶段 |
| 是否降级 | `GET /api/health` 的 `status` |
| 待生效变更 | `GET /api/admin/system/state` 或后台顶栏 |
| 为什么重启没生效 | 确认改的是"配置/启停"还是"代码"（后者需要重启进程） |

---

## 相关页面

- [[插件生命周期与依赖解析|Architecture-Plugin-Lifecycle]]
- [[数据层与迁移|Architecture-Data-and-Migrations]]
- [[故障排查|Troubleshooting]]
