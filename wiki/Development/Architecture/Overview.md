# 分层与数据所有权

本页给你一张全局地图：**哪一层负责什么、谁拥有哪些数据、插件与主题怎么交互**。
读完它再去读具体机制页会顺很多。

> 权威设计文档：[docs/architecture/overview.md](https://github.com/ricenote/ricenote/blob/main/docs/architecture/overview.md)（本页在其基础上补充了源码位置）

---

## 1. 总体分层

```
┌──────────────────────────────────────────────────────────────┐
│  apps/server          HTTP / CLI 入口、Fastify 装配、静态托管  │
│                      启动编排(内核) / 软重启(Supervisor)       │
├──────────────────────────────────────────────────────────────┤
│  packages/core        内核：注册表 / 安全 / 渲染 / 数据库      │
│                       主题管理 / 插件管理 / 扩展点注册表        │
│  packages/plugin-sdk  插件稳定公共接口（PluginContext 类型）   │
│  packages/theme-sdk   主题 helper 类型 / 过滤器 / 设置校验器   │
│  packages/shared      DTO / 错误码 / capability 工具 / Schema  │
├──────────────────────────────────────────────────────────────┤
│  plugins/*            业务能力（全部为插件，可独立启停）        │
│  themes/*             前台外观（Nunjucks 模板 + 资源）         │
└──────────────────────────────────────────────────────────────┘
```

**关键点**：`apps/server` 只做"装配与进程生命周期"，不含业务；`packages/core` 不含任何业务概念
（不知道"文章"是什么，只提供注册表、路由、服务、事件、渲染、安全与数据库访问基础设施）。

### 包职责边界

| 包 | 负责 | **不**负责 |
| --- | --- | --- |
| `apps/server` | Fastify 装配、路由挂载与守卫接线、静态资源、CLI、进程生命周期（含软重启） | 业务规则、数据结构 |
| `packages/core` | 引导与编排、注册表（服务/事件/路由/插槽/菜单/扩展点）、插件与主题管理、数据库适配与迁移、安全控制面、渲染器与缓存 | 任何具体内容类型 |
| `packages/plugin-sdk` | 插件对外稳定接口：`PluginContext`、生命周期类型、门面封装、`definePlugin` | 实现细节 |
| `packages/theme-sdk` | 主题侧契约：上下文类型、过滤器实现（`css_color` / `date` / `excerpt` / `number`）、设置校验与 `resolveLocalizedText` | helper 运行时（helper 在 Core） |
| `packages/shared` | 错误码、capability 解析工具、slug/URL 工具、DTO、四份 JSON Schema | 运行时状态 |
| `plugins/*` | 业务能力与数据表 | 跨插件的直接耦合（只能靠 capability 契约） |
| `themes/*` | 模板与资源 | 数据、路由 |

---

## 2. 启动流程一览

完整时序见 [[启动时序|Development/Architecture/Core-Bootstrap]]，这里只给骨架：

```
loadConfig（含 JSON Schema 校验）
  → 日志（终端可读 / 文件 JSON Lines）
  → 数据库适配器 + ping 探活          ← 失败 → RN_DB_UNAVAILABLE → 诊断服务
  → 迁移协调器：ensureLedger + GET_LOCK ← 拿不到锁 → RN_MIGRATION_LOCKED
  → 注册表：服务/事件/路由/扩展点/插槽/后台菜单/HTML 缓存
  → 安全组件：会话 / CSRF / 登录限流 / 审计 / 安全网关
  → Core 迁移 + 站点信息覆盖层 + 待重启状态
  → 发布 Core 服务契约（core.security/theme/site/runtime/setup/html）
  → 主题同步
  → 插件 bootstrap（发现 → 校验 → 依赖解析 → 启动）
  → 安装任务队列
  → 渲染器
  → 运行标记 running → 释放锁 → 清待重启 → 启动摘要横幅
```

---

## 3. 插件与主题的交互方式

两者的关系可以一句话概括：

> **主题提供容器，插件提供内容；二者互不相识，只在"插槽/扩展点"与"能力契约"处相遇。**

| 交互点 | 机制 |
| --- | --- |
| 主题渲染内容 | 插件注册 `page` 路由产出 ViewModel，Core 用主题模板渲染（插件不碰 HTML 外壳） |
| 主题留挂载点 | 主题模板调用 `slot('post.comments')` 等，插件向插槽注册组件 |
| 插件依赖内容能力 | 声明 `content.posts@1` 之类的 capability，按能力而不是插件 ID 解析 |
| 主题依赖内容能力 | `theme.json` 的 `requires`，并提供 `has_feature()` 供模板判断 |
| 主题声明内容字段 | `theme.json` 的 `contentFields`，插件在读写内容时按主题声明做过滤 |

**因此**：切换主题不影响任何插件；禁用插件时主题里的相应区块自动为空。

---

## 4. 数据所有权

### 命名规则

所有表以 **`rn_` 前缀**命名，由 `scopedTableName()` 强制（`packages/core/src/database/adapter.ts`）：
表名必须匹配 `/^[a-z][a-z0-9_]{0,60}$/`，否则抛 `VALIDATION_FAILED`。

### 谁拥有哪些表

| 归属 | 表 | 说明 |
| --- | --- | --- |
| Core | `rn_plugin_migrations` | 迁移账本（含 SHA-256 校验值） |
| Core | `rn_plugins` | 插件元数据、状态、来源信息 |
| Core | `rn_site_state` | 运行标记与待重启标记 |
| Core | `rn_site_settings` | 站点信息的稀疏覆盖层 |
| Core | `rn_theme_settings` / `rn_theme_setting_revisions` | 主题设置当前值与历史 |
| Core | `rn_audit_logs` | 审计日志 |
| Core | `rn_plugin_jobs` | 插件安装任务队列 |
| `rice.identity` | `rn_identity_users` / `rn_identity_sessions` | |
| `rice.authorization` | `rn_authz_roles` / `rn_authz_role_permissions` / `rn_authz_user_roles` | |
| `rice.posts` | `rn_posts` | 含 ngram FULLTEXT 索引 |
| `rice.pages` | `rn_pages` | |
| `rice.navigation` | `rn_nav_items` | |
| `rice.taxonomy` | `rn_terms` / `rn_term_relations` | |
| `rice.media` | `rn_media` | |
| `rice.comments` | `rn_comments` | |

### 所有权约定

1. **表归属唯一**：一张表只属于一个插件；跨插件读数据请走对方提供的 **capability 契约**，不要直接查它的表。
2. **迁移归属**：每个插件自带 `migrations/*.sql`，由迁移协调器按插件启用状态执行；**插件停用不 drop 表**。
3. **插件作用域句柄**：`ctx.db.table(name)` 会拼上 `rn_` 前缀并校验字符集；
   `ctx.db` 只在声明了 `database:own` 能力时才可用（否则是拒绝桩，调用即 `RN_FORBIDDEN`）。

> ⚠️ 澄清一处常见误读：**当前实现并不提供"按插件 ID 的强制表命名空间隔离"**。
> 代码层面强制的是 `rn_` 前缀 + 表名字符集约束，以及 `database:own` 能力门。
> 插件之间"不碰对方的表"是**架构约定 + 代码评审保证**，而不是运行时强制边界。
> 需要强隔离时应通过契约访问，或自行在 SQL 层做约束。（`adapter.ts` 中的相关注释比实现更强，已在此如实标注。）

---

## 5. 安全基线

| 面 | 机制 |
| --- | --- |
| 会话 | Cookie `ricenote_session`，HMAC-SHA256 签名、常量时间比较、HttpOnly + SameSite=Lax、生产加 Secure |
| CSRF | 双重提交：Cookie `ricenote_csrf` + 与会话绑定的签名；写方法强制校验 |
| 授权 | 能力校验 fail-closed（拿不到 resolver 也拒绝），`*` 通配符 |
| 登录 | 限流：8 次 / 300 秒窗口，触发后封禁 900 秒（维度 = 用户名 + IP） |
| 审计 | 所有管理写操作写入 `rn_audit_logs`（操作者、动作、目标、IP、请求 ID、详情） |
| 日志 | 键名匹配 `(password\|passwd\|secret\|token\|credential\|authorization\|cookie)` 的值替换为 `[redacted]` |
| 富文本 | 统一经 `sanitizeRichText` 消毒并标记 `TrustedHtml`，只有受信句柄在模板中不转义 |
| 插件安装 | 三路来源 + 高风险确认 + 审计；能力白名单限制插件可用的 API |

详见 [[安全控制面|Development/Architecture/Security]]。

---

## 6. 配置的时效性

`ctx.config` 是**启动期快照**，这是很多"改了没生效"的根源：

| 变更 | 生效方式 |
| --- | --- |
| `.env` | 重启进程 |
| 站点信息 | **立即生效**（`ctx.site` 是动态取值，渲染时实时读取；缓存键含站点 revision） |
| 插件设置 / 启停 | 需重启（后台会标记"待生效"并提供一键重启） |
| 主题设置 | 后台保存后发布，立即影响渲染（缓存键含主题 revision） |

---

## 7. 相关文档

- [[启动时序|Development/Architecture/Core-Bootstrap]]
- [[插件生命周期与依赖解析|Development/Architecture/Plugin-Lifecycle]]
- [[渲染与缓存|Development/Architecture/Render-Pipeline]]
- [[数据层与迁移|Development/Architecture/Data-and-Migrations]]
- [[安全控制面|Development/Architecture/Security]]
- [[命名扩展点注册表|Development/Architecture/Extension-Registry]]
- 仓库文档：[架构总览](https://github.com/ricenote/ricenote/blob/main/docs/architecture/overview.md) ｜
  [ADR-001 模块化单体](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-001-modular-monolith.md)
