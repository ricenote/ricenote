# 插件生命周期与依赖解析

本页讲清三件事：插件**是怎么被发现的**、**状态是怎么流转的**、**依赖是怎么被解析并排序的**。

相关源码：`packages/core/src/plugins/`（`manager.ts`、`lifecycle.ts`、`dependency-resolver.ts`、`manifest.ts`、`admin-menu.ts`、`admin-pages.ts`）、
`packages/core/src/capabilities.ts`、`packages/shared/src/capability.ts`。

---

## 1. 插件发现

### 发现根目录

插件从三个来源被扫描（`pluginDiscoveryRoots(config)`）：

| 顺序 | 配置 | 默认值 | 用途 |
| --- | --- | --- | --- |
| 1 | `paths.pluginsDir` | `./plugins/official` | 官方插件（随仓库分发） |
| 2 | `paths.pluginsInstallDir` | `./plugins/third-party` | 从后台/CLI 安装的插件 |
| 3 | `paths.localPluginDirs` | 空 | `RICENOTE_LOCAL_PLUGINS` 声明的本地开发目录 |

**同一个函数被四处共用**：内核启动、`pnpm validate`、`plugin` 命令、安装向导 —— 保证"大家看到的是同一批插件"。

发现规约是**"目录即插件"**：一个目录里有合法的 `manifest.json` 就是一个插件。跨根目录会做去重，
同 ID 出现在多处会被识别为冲突（而不是静默选一个）。

### 被跳过的目录

发现机制**刻意跳过**两类目录：

1. 以 `.` 开头的目录；
2. 形如 `.incoming-<hex>` / `.backup-<hex>` 的安装器瞬时目录。

它们通常带着完整的 `manifest.json`，一旦被当成插件目录就会造成"同一 ID 两个来源"的冲突 ——
把一次可自愈的清理失败放大成"插件加载不上"的故障。跳过它们让这类问题自动消失。

---

## 2. 状态机

```
DISCOVERED ──► VALIDATED ──► INSTALLED ──► ENABLED ──► STARTED
                            │              │            │
                            │              │            └──► STOPPED ──┐
                            │              │                          │
                            │              └──► DISABLED ◄────────────┘
                            │                     │
        （任一步出错）──────┴─────────────────────┴──► FAILED
```

允许的迁移（仅这些）：

| 从 | 可到 |
| --- | --- |
| `DISCOVERED` | `VALIDATED` / `FAILED` |
| `VALIDATED` | `INSTALLED` / `FAILED` |
| `INSTALLED` | `ENABLED` / `FAILED` |
| `ENABLED` | `STARTED` / `DISABLED` / `FAILED` |
| `STARTED` | `STOPPED` / `FAILED` |
| `STOPPED` | `ENABLED` / `DISABLED` / `FAILED` |
| `DISABLED` | `ENABLED` / `FAILED` |
| `FAILED` | `DISCOVERED` / `VALIDATED` / `INSTALLED` / `ENABLED` / `DISABLED` |

非法迁移会抛 `RN_PLUGIN_STATE_INVALID`（409）。状态与 `last_error` 持久化在 `rn_plugins` 表中。

### FAILED 是怎么记录的

插件启动抛错时：

1. 记为 `FAILED` 并写入错误信息（`rn_plugins.state` / `last_error`）；
2. 记录一条 `error` 级日志；
3. **尽力安全停止**该插件（清理它已注册的资源）；
4. **继续启动其它插件** —— 单个插件失败不会让整个内核起不来。

### 启用与停用

| 操作 | 行为 |
| --- | --- |
| `enable(id)` | 插件不存在 → `RN_PLUGIN_NOT_FOUND`（404）；已启用则直接返回 `{ restartRequired: true }`；否则写 `enabled=true` + 状态 `ENABLED`。**不会立即启动** |
| `disable(id)` | 先找**已启用的反向依赖**（`findDependents`）；存在则抛 `RN_DEPENDENCY_DISABLED`（409）；否则写 `enabled=false` + `DISABLED` |

> 因此"改了插件启停必须重启进程"不是偷懒，而是刻意的：受控重启让"半加载状态"不可能存在。
> 见 [ADR-004](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-004-controlled-restart.md)。

---

## 3. 依赖解析

### capability 优先

插件依赖写的是**能力契约**（如 `content.posts@1`）而不是插件 ID。解析顺序：

1. 如果依赖键是 capability（含 `@` 形态），先查**能力索引** `findProvider(capabilityIndex, key)`；
2. 找到提供者后再校验**版本区间**是否满足；
3. 非 capability 的键按**插件 ID** 依赖处理。

`findProvider` 的匹配分两步，**先精确、再按 name+major**，这是为了**避免前缀误匹配**：

```
① raw 完全相等            → 命中（要求 major 一致）
② 解析 name + major 相等  → 命中
```

`has_feature()`（模板侧）用的是同一套匹配函数，支持三种写法：

```
① 完整契约：content.posts@1
② 全名：    posts
③ 短名：    content.posts        ← 用 endsWith('.' + query) 匹配，避免前缀误匹配
```

### 拓扑排序（稳定）

用 Kahn 算法排序，并做**稳定性保证**：

- 初始入队按字典序排序；
- 后续入队也按字典序插入。

结果是**同样的输入永远得到同样的启动顺序**（可复现，便于排查"为什么这次顺序不同"）。

### 依赖问题的表达方式

解析器把问题作为**数据**（`DependencyProblem[]`）返回，而不是直接抛异常，类型有：

| kind | 含义 |
| --- | --- |
| `missing` | 依赖的能力/插件找不到 |
| `version` | 找到提供者但版本区间不满足 |
| `cycle` | 存在循环依赖 |

内核再根据这些问题决定"剔除哪些插件、哪些记为 FAILED"：

**迭代剔除算法**（最多 6 轮）：每轮重新解析依赖，收集因剔除而**新坏掉（newlyBroken）**的插件，
从候选集中剔除；收敛后把剩下有问题的标记为 `FAILED`。

这样"一个插件坏了"不会导致它的所有下游都抛异常炸掉，而是被逐层、可解释地标记出来。

> 实现细节：`ErrorCode.DEPENDENCY_VERSION_CONFLICT` 与 `DEPENDENCY_CYCLE` 在错误码表中有定义，
> 但当前路径下依赖问题走的是 `DependencyProblem` 数据流（`DEPENDENCY_DISABLED` 用于停用场景，
> `DEPENDENCY_MISSING` 用于安装任务场景）。

---

## 4. 能力白名单

插件能调用哪些 Core API，由 `manifest.json` 的 `capabilities` **显式声明**。完整清单（12 项）：

| 能力 | 允许做什么 |
| --- | --- |
| `database:own` | 使用 `ctx.db`（否则拿到的是拒绝桩） |
| `routes:public` | 注册公开页面路由与原始路由 |
| `routes:admin` | 注册管理 API 路由 |
| `services:provide` | 提供跨插件服务契约 |
| `services:consume` | 消费其它插件的服务契约 |
| `events:publish` | 发布事件 |
| `events:subscribe` | 订阅事件 |
| `slots:register` | 注册渲染插槽组件（render 贡献的别名） |
| `extensions:declare` | 声明命名扩展点 |
| `extensions:contribute` | 向扩展点贡献 |
| `admin:menu` | 以命令式 API 添加后台菜单（声明式 `admin.pages` 不需要） |
| `media:store` | 写入媒体存储 |

**执行方式**：`context-factory.ts` 在构建 `PluginContext` 时逐项检查，未声明即替换为拒绝桩：

```
forbidden(pluginId, capability, api) → 抛 RN_FORBIDDEN（403）
```

拒绝是**显式的**（403 + 明确的能力名），不是静默降级 —— 这样插件作者第一时间就知道自己漏了声明。

---

## 5. 零残留断言（`assertNoLeaks`）

`assertNoLeaks()` 会遍历**已停止插件**在各注册表中的残留，检查这些维度：

- 路由：page / raw / adminApi
- 服务、插槽、后台菜单、事件订阅
- 扩展点：声明（render/admin/server）与贡献

一旦发现残留，抛 `RN_PLUGIN_STOP_FAILED`（500）。

> **现状说明**：该断言目前**仅由测试调用**（内核集成测试与扩展点测试），
> 生产代码中未调用。它的价值是把"插件可独立启停"变成**可测试承诺** ——
> 每次插件启停相关的改动，集成测试都会替你检查是否有资源泄漏。

---

## 6. 后台菜单与"已声明未注册"

两条路径产生后台入口：

1. **声明式**（推荐）：`manifest.json` 的 `admin.pages[]`，声明 `id/label/path/icon/order/permission/entry`（可选 `hidden`）；
2. **命令式**：`ctx.adminMenu.add(item)`，需要 `admin:menu` 能力。

注册表规则（`admin-menu.ts`）：ID 必须匹配正则、不可重复、`path` 必须以 `/` 开头，违规抛 `VALIDATION_FAILED`。
**排序：`order` 降序，同分按 `id` 字典序升序。**

菜单下发给前端时按当前用户权限过滤（`list(permissions)`）。

### `declaredAdminPages()`

用于生成"**已声明但未注册**"的占位信息（后台 404 页的兜底提示）：

- 列出**全部已声明**的后台页面（含未启动插件的）；
- 跳过 `entry` 文件不存在的页；
- 样式文件缺失时不下发 `styleUrl`；
- 返回 `available: isStarted(pluginId)`。

因此"插件未启用 → 插件页面给出明确提示"而不是白屏，正是靠这里的数据。

---

## 7. 安装与升级为什么不在启动路径上

安装（`plugins/install/`）走的是**独立的任务队列**（表 `rn_plugin_jobs`），全局串行、同类任务去重、带步骤与日志。
编排为 `resolve → prepare → commit`，任一步失败回滚。

它**不参与 `bootstrap()`**：内核对 `RICENOTE_PLUGINS` 声明式清单**只核对不安装**，
启动期不做隐式磁盘修改。详见 [[插件安装与更新|Plugins/Install-and-Update]]。

---

## 8. 自查入口

| 问题 | 命令 / 接口 |
| --- | --- |
| 插件当前状态与来源 | `pnpm plugin` |
| 谁依赖谁（反向依赖） | `pnpm plugin` 输出 + `findDependents` 的判定 |
| 清单是否合法 | `pnpm validate` |
| 依赖解析失败的详情 | 启动摘要中的失败/排除插件段 |
| 启停是否生效 | 必须重启进程；后台顶栏"待重启" |

---

## 相关页面

- [[manifest 逐字段参考|Development/Plugin-API/Manifest-Reference]]
- [[命名扩展点注册表|Development/Architecture/Extension-Registry]]
- [[插件安装与更新|Plugins/Install-and-Update]]
- 仓库文档：[hooks-inventory 的生命周期与状态机章节](https://github.com/ricenote/ricenote/blob/main/docs/architecture/hooks-inventory.md)
