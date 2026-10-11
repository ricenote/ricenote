# RiceNote 架构总览

> 本文是《RiceNote 项目规划与架构说明书 v1.0》的可执行落地版本，描述 M0–M2 已实现的实际结构。

## 1. 总体分层

```mermaid
flowchart TD
  B[浏览器 / 搜索引擎] --> N[Nginx]
  N --> F[Fastify Server]
  F --> PR[公开站点路由<br/>Page Provider 插件 → Renderer]
  F --> AR[/api/admin/*<br/>会话 / CSRF / 授权]
  subgraph CORE[Core 内核]
    BS[Bootstrap / 恢复模式]
    PM[Plugin Manager]
    DR[Dependency Resolver]
    SR[Service Registry]
    EB[Event Bus]
    RR[Router Registry]
    TM[Theme Manager]
    RD[Nunjucks Renderer / Slot]
    DA[Database Adapter / 迁移锁]
    SG[Security Gateway]
  end
  PM --> DR
  DR --> SR
  PM --> EB
  PM --> RR
  PM --> DA
  F --> CORE
  CORE --> P[官方插件<br/>identity / authorization / posts / taxonomy / media]
  CORE --> T[主题<br/>minimal / default]
  DA --> DB[(MySQL)]
  RD --> T
```

Core 进一步分为四层：

| 层 | 模块 | 职责 |
| --- | --- | --- |
| 基础设施层 | `bootstrap` / `config` / `logger` / `database` | 启动编排、配置校验、结构化日志、连接池与迁移协调 |
| 契约层 | `services` / `events` / `routing` / `render/slots` / `security` | 服务注册、事件总线、路由注册、Slot 聚合、能力校验 |
| 管理层 | `plugins` / `themes` | 插件发现与生命周期、依赖解析、主题安装/预览/切换 |
| 渲染层 | `render` | Nunjucks 环境、模板回退、Theme Context、HTML 缓存 |

## 2. 启动流程

```
加载配置(env + 校验)
  → 初始化 Logger
  → 连接 MySQL（失败则进入恢复模式：仅提供安装/维护界面）
  → 执行 Core 迁移 + 插件迁移（加锁、串行、记录校验值）
  → 注册 Core 服务
  → 发现插件（扫描 PLUGINS_DIR）
  → 校验 Manifest（JSON Schema）
  → 依赖解析（capability 优先、拓扑排序、循环检测）
  → 按序 setup / start
  → 组装 Router Registry → 挂载 Fastify 路由
  → 装配主题（读取激活主题、合成设置）
  → 监听端口
```

全部插件启动完成后，Core 会广播 **`core.runtime.started.v1`** 生命周期事件。
这是"需要其他插件已就绪"的初始化逻辑的唯一正确挂载点——例如 identity 插件
通过它创建初始管理员，从而确保 authorization 插件（依赖 identity、启动更晚）
已经完成 `identity.user.created.v1` 的订阅，避免事件丢失导致管理员拿不到角色。

任一环节失败都会记录到 `rn_plugins`/日志，并保持"核心可用"：无任何内容插件时，
公开站点回落到恢复模式页面（安装与维护指引），而不是白屏或崩溃。

## 3. 模块职责边界

| 模块 | 职责 | 不承担 |
| --- | --- | --- |
| Bootstrap | 启动、健康检查、恢复模式 | 任何文章业务 |
| Plugin Manager | 发现 / 校验 / 启停 / 升级 / 健康 | 插件业务 SQL |
| Dependency Resolver | 校验 apiVersion、依赖图、循环检测 | 隐式加载未声明依赖 |
| Service Registry | 契约发布、调用、失效处理 | 跨插件直接 import |
| Event Bus | 订阅、发布、优先级、失败记录 | 替代强一致事务 |
| Router Registry | 合并路由、冲突检测、生成 URL | 允许主题注册后台路由 |
| Theme Manager | 校验、安装、预览、切换、回滚 | 执行主题自带服务端 JS |
| Renderer | Nunjucks / 缓存 / Slot / HTML 安全 | 任意 DB 查询 |
| Database Adapter | 连接 / 事务 / 命名约束 / 迁移锁 | 自动跨插件联表 |
| Security Gateway | 会话边界、能力校验、操作审计 | 默认放行被禁用的权限插件 |
| Plugin Installer | 插件包 ZIP 两阶段安全校验与落盘 | 运行时热加载插件 |
| Logs Reader | 运行日志尾部读取、级别/时间过滤、路径归一化 | 写入或轮转日志 |
| Backup Service | 备份打包、包内预览、恢复前快照、快照回滚 | 定时调度与保留策略 |

## 4. 插件与主题的交互方式

这是本系统最关键的一条契约链：

1. **插件只提供数据**：插件通过 `ctx.routes.page()` 注册页面路由，返回 `PageViewModel`
   （包含 `kind`、`title` 与 `data`），不产出 HTML。
2. **主题只决定展示**：主题在 `theme.json` 的 `templates` 中声明页面类型到模板文件的映射
   （`home → index.njk` 等），Renderer 依据 ViewModel 的 `kind` 选择模板。
3. **渲染器居中协调**：Renderer 组装 Theme Context（`site / page / theme / viewer / post / posts / pagination`），
   注入 helper（`theme_asset` / `url` / `slot` / `has_feature`）与过滤器（`css_color` / `date` / `excerpt`）。
4. **Slot 让插件反向注入展示**：插件通过 `ctx.slots.register('post.comments', component)` 向主题的
   标准挂载点注入 HTML 片段；主题用 `{{ slot('post.comments', { postId: post.id }) }}` 声明挂载点。
   插件被禁用时 Slot 自动为空，主题无需改动。
   约定：**外层容器与标题由主题提供，插件只输出"区块内容"**（例如 `comments` 插件不输出
   `<section>`/`<h2>`，只输出计数、列表、分页与表单）。
   另外 `url()` 在路由未注册时降级为 `#` 并告警一次，使"模板引用了可选插件的路由"不会升级为整页白屏。
5. **模板回退**：主题模板 → 主题 `fallback.njk` → Core 内置兼容模板，三级回退保证任何主题都能渲染。

因此"换主题不改插件、换插件不改主题"成立：唯一的耦合面是 **kind 名称**、
**ViewModel 的 data 字段约定** 与 **Slot 名称**，三者都是版本化的公开契约。

## 5. 数据所有权

| 所有权 | 表 | 职责 |
| --- | --- | --- |
| Core | `rn_plugins` | 插件安装状态、版本与健康 |
| Core | `rn_plugin_migrations` | 插件迁移日志、校验值 |
| Core | `rn_themes` | 已安装主题清单、路径与版本 |
| Core | `rn_site_state` | `active_theme_id` 与运行状态 |
| Core | `rn_theme_settings` | 每主题设置快照与 revision |
| Core | `rn_theme_setting_revisions` | 设置发布历史、回滚 |
| Core | `rn_audit_logs` | 管理操作审计 |
| identity 插件 | `rn_identity_users` / `rn_identity_sessions` | 用户与登录会话 |
| authorization 插件 | `rn_authz_roles` / `rn_authz_role_permissions` / `rn_authz_user_roles` | 角色与权限 |
| posts 插件 | `rn_posts` | 文章及状态 |
| taxonomy 插件 | `rn_terms` / `rn_term_relations` | 分类标签与关联 |
| media 插件 | `rn_media` | 上传媒体元数据 |
| comments 插件 | `rn_comments` | 评论、嵌套关系与四态审核状态 |

跨插件协作只允许通过**服务契约**与**公开 ID**，禁止对他人表建外键或非受控联表。
表名统一 `rn_` 前缀，插件自有表使用 `rn_<插件短名>_<名称>` 由 `ctx.db.table()` 生成。

`rice.search` 与 `rice.seo` **不持有任何数据表**：前者只维护内存中的数据源注册表，
后者的检索实现与索引（`rn_posts` 的 ngram FULLTEXT）都归数据源插件所有。

### 插件目录

| 目录 | 用途 | 内置标记 |
| --- | --- | --- |
| `plugins/official` | 官方插件（随发行版提供） | `builtin = true` |
| `plugins/third-party` | 后台 ZIP 上传安装的第三方插件 | `builtin = false` |

两者都会被内核发现（`discoverPluginsFrom()`），ID 去重跨全部根目录生效。
第三方插件的可执行文件路径为 `config.paths.pluginsInstallDir`（环境变量 `PLUGINS_INSTALL_DIR`）。

## 6. 安全基线

- 管理面：HttpOnly + SameSite Cookie 会话、CSRF Token、能力校验、操作审计。
- 渲染面：Nunjucks 自动转义；用户富文本经消毒并标记 `TrustedHtml`；主题配置中的颜色
  经 `css_color` 白名单过滤器；Slot 片段按受信任协议输出。
- 安装面：主题与**插件**包均先在临时目录完成大小限额、Zip Slip / 符号链接穿越、
  扩展名白名单与路径归一化校验后才落盘（同一实现，见 ADR-007）。
- 备份面：恢复先做只读预览、再自动生成当前状态快照，最后才覆盖数据（见 ADR-008）。
- 运行时：请求 ID 贯穿日志；插件错误边界隔离；`stop()` 必须注销全部注册项以防泄漏。

## 7. 系统能力（日志与备份）

这两项属于"站点运维"而非业务，因此由 Core 直接提供，但同样经管理守卫
（认证 → CSRF → 权限 → 审计）暴露，权限点为 `system.maintain`（仅管理员角色通过 `*` 天然具备）。

| 端点 | 说明 |
| --- | --- |
| `GET /api/admin/logs` | 只读运行日志：级别 / 时间范围 / 关键字 / 文件过滤 + 分页 |
| `GET /api/admin/backup/snapshots` | 恢复前快照列表 |
| `POST /api/admin/backup/export` | 流式导出备份 ZIP（数据库 + 上传文件 + 清单） |
| `POST /api/admin/backup/inspect` | 只读解析备份包，供恢复前确认 |
| `POST /api/admin/backup/restore` | 上传备份包恢复（自动快照） |
| `POST /api/admin/backup/snapshots/:name/restore` | 从历史快照回滚 |
| `GET` / `DELETE /api/admin/backup/snapshots/:name` | 下载 / 删除快照 |

设计要点：日志**只读文件尾部**并做文件名归一化校验，内存占用与文件大小无关；
备份走**流式**打包，密码经临时 `--defaults-extra-file` 传递而不进入命令行。

## 8. 相关文档

- [Plugin API v1](../plugin-api/v1.md)
- [Theme API v1](../theme-api/v1.md)
- [架构决策记录](../adr/)
