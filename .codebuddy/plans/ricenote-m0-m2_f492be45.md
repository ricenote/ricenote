---
name: ricenote-m0-m2
overview: 按《RiceNote 项目规划与架构说明书 v1.0》实现 M0→M2：搭建 pnpm Monorepo 与架构基线（Manifest JSON Schema、ADR、Plugin/Theme API 契约），实现可独立启动的 Core 底座（插件/依赖/服务/事件/路由/主题/渲染/数据库/安全网关），并交付 identity、authorization、posts、taxonomy、media 五个官方插件与 Vue 3 管理后台，达成"能登录、写作、发布、浏览"的内容 MVP。数据库 MySQL 8.4 + Drizzle，前台 Nunjucks 服务端渲染，默认提供 minimal 主题。
design:
  architecture:
    framework: vue
    component: shadcn
  styleKeywords:
    - 现代简约
    - 柔和渐变
    - 微交互动效
    - 内容优先
  fontSystem:
    fontFamily: PingFang SC, Helvetica Neue, system-ui
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 16px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#0E7C66"
      - "#12A38A"
      - "#3DD9B0"
    background:
      - "#F6F7F5"
      - "#FFFFFF"
      - "#0E1512"
    text:
      - "#1A2B26"
      - "#5B6B66"
      - "#FFFFFF"
    functional:
      - "#16A34A"
      - "#F59E0B"
      - "#E5484D"
      - "#2D7FF9"
todos:
  - id: scaffold-monorepo
    content: 搭建 pnpm monorepo 脚手架与 shared/plugin-sdk/theme-sdk 基础包及 docker-compose
    status: completed
  - id: schemas-docs
    content: 编写 Plugin/Theme Manifest JSON Schema、校验 CLI 与 ADR/API 文档
    status: completed
    dependencies:
      - scaffold-monorepo
  - id: db-migration
    content: 实现数据库适配层、迁移协调器与 Core 元数据表
    status: completed
    dependencies:
      - scaffold-monorepo
  - id: plugin-kernel
    content: 实现插件运行时内核与 Bootstrap，含 Hello 示例插件启停验证
    status: completed
    dependencies:
      - db-migration
      - schemas-docs
  - id: theme-render
    content: 实现主题管理器、Nunjucks 渲染内核与 minimal 默认主题
    status: completed
    dependencies:
      - scaffold-monorepo
      - schemas-docs
  - id: server-entry
    content: 实现 Fastify 服务入口、公开站点 SSR、API/后台挂载与恢复模式
    status: completed
    dependencies:
      - plugin-kernel
      - theme-render
  - id: plugins-identity-authz
    content: 实现 identity 与 authorization 插件（用户、会话、角色权限）
    status: completed
    dependencies:
      - plugin-kernel
      - db-migration
  - id: plugins-content
    content: 实现 posts、taxonomy、media 插件（文章、分类标签、媒体库）
    status: completed
    dependencies:
      - plugin-kernel
      - db-migration
      - plugins-identity-authz
  - id: admin-spa
    content: 实现 Vue 3 管理后台登录/仪表盘/内容/外观/扩展页面
    status: completed
    dependencies:
      - server-entry
      - plugins-content
  - id: tests-verification
    content: 用 [skill:playwright-cli] 与集成测试验证插件启停、主题渲染与登录写作发布闭环，并经 [skill:lsp-code-analysis] 校验契约一致性
    status: completed
    dependencies:
      - server-entry
      - plugins-content
      - admin-spa
---

## Product Overview

RiceNote 是一个"插件优先"的模块化博客与内容管理系统。核心（Core）只提供引导、安全边界、插件/主题注册、路由、服务、事件、数据库访问与渲染基础设施；文章、评论、用户权限、分类标签、搜索等全部业务能力均以独立插件实现。前端界面通过主题系统灵活更换。系统采用模块化单体架构，面向个人 VPS 易部署。

本次交付范围锁定为规格说明书的 **M0 → M2**：架构基线 + 可运行核心底座 + 内容 MVP（能登录、写作、发布、浏览）。

## Core Features

- **契约基线（M0）**：冻结 Plugin API v1、Theme API v1、插件与主题 Manifest 的 JSON Schema，并提供校验 CLI 与 ADR 文档。
- **核心底座（M1）**：实现 Bootstrap 启动与恢复模式、插件管理器、依赖解析器、服务注册表、事件总线、路由注册表、主题管理器、Nunjucks 渲染器、数据库适配器与安全网关；达成"核心可独立启动 + Hello 插件可启停"。
- **插件系统**：插件以目录形式安装，通过 Manifest 声明 id、版本、依赖（capability 契约）、能力与迁移；支持依赖拓扑排序、循环检测、启停受控重启；禁用被依赖插件时明确阻止并提示。所有功能低耦合、可独立开发与启停。
- **主题系统**：主题 = theme.json + templates/*.njk + assets/*，零构建即可开发；支持模板回退、标准 Slot 插槽、站点信息/文章/URL/资源等模板 helper；后台可按 Manifest 声明的字段自动生成设置表单。
- **内容 MVP（M2）**：identity（登录/会话）、authorization（角色权限）、posts（文章写作发布）、taxonomy（分类标签）、media（媒体库）五个官方插件，配合 Vue 3 管理后台完成登录、写作、发布、浏览闭环。
- **管理后台**：含仪表盘、内容管理、外观（主题与设置）、扩展（插件启停与依赖）等分区，作为独立 SPA 不侵入前台主题；UI 基于 **shadcn-vue** 组件体系。
- **安全与运维**：认证会话边界、CSRF、能力校验与操作审计；主题 ZIP 安装的路径穿越防护；请求 ID 与结构化日志、健康检查、数据库迁移锁与串行编排。

## Visual Effect

前台为极简、阅读优先的博客呈现；后台为现代简约、扁平利落的管理控制台，操作路径清晰，主题设置表单随主题声明自动生成。

## Tech Stack Selection

严格遵循规格说明书第 2 章；管理后台 UI 组件库按用户确认细化为 shadcn-vue：

| 层次 | 技术 | 说明 |
| --- | --- | --- |
| 语言/运行时 | TypeScript + Node.js LTS | 服务端、SDK、工具链统一 |
| HTTP 框架 | Fastify | 路由、hook、封装成熟；业务插件层另建 |
| 数据库 | MySQL 8.4 LTS + Drizzle | 明确 Schema、迁移与类型安全 |
| 校验 | JSON Schema + Ajv | Manifest、主题设置、API 输入校验 |
| 管理后台 | Vue 3 + Vite + Vue Router | 独立 SPA，UI 不侵入主题 |
| 后台 UI 组件 | **shadcn-vue**（Tailwind CSS + Reka UI 底层） | 源码内联式组件，可完全自定义主题令牌；不使用玻璃拟态与阴影 |
| 后台图标 | lucide-vue-next | 与 shadcn 默认图标体系一致 |
| 前台主题 | Nunjucks + 原生 CSS/JS | 零构建，默认服务端渲染 |
| 包组织 | pnpm workspace | Core/SDK/官方插件分包 |
| 部署 | Docker Compose + Nginx | 一键部署与 TLS 终止 |


> 说明：shadcn/ui 原生为 React；本项目按用户确认使用其官方社区 Vue 移植版 **shadcn-vue**，保持说明书"管理后台 Vue 3"的架构基线不漂移，故**无需修改说明书第 2 章**，仅在 ADR 中追加一条 UI 组件库选型记录。

## Implementation Approach

采用"分层内核 + 契约驱动 + 目录即插件"策略。Core 拆分为 **基础设施层**（Bootstrap/Config/Logger/Database Adapter）、**契约层**（Service Registry / Event Bus / Router Registry / Slot Registry / Security Gateway）、**管理层**（Plugin Manager / Dependency Resolver / Theme Manager）与**渲染层**（Nunjucks Renderer）。

关键决策：

1. **契约先于实现**：先用 JSON Schema + TS 接口冻结 Plugin API v1 与 Theme API v1（M0），所有插件与主题只依赖 `@ricenote/plugin-sdk`、`@ricenote/theme-sdk`，禁止跨插件直接 import 内部文件。
2. **依赖按 capability 解析**：依赖键优先匹配 `provides` 的能力契约（如 `content.posts@1`），仅在确需特定实现时才用插件 ID；启动前做拓扑排序与循环检测，失败明确报错。
3. **启停采用受控重启（ADR-004）**：v1 不承诺运行时热卸载 Fastify 路由；`stop()` 必须通过上下文提供的句柄注销事件/服务/路由/Slot，避免泄漏。
4. **注册表提供注销句柄**：`ctx.on()`、`ctx.routes.add()`、`ctx.services.provide()` 均返回 `dispose`，保证插件禁用时资源可逆。
5. **迁移由 Core 串行编排并加锁**：插件 migrations 交由 Database Adapter 在锁保护下按序执行，并写入 `rn_plugin_migrations` 校验值；启停不自动 drop 表。
6. **主题三层配置**：`effective = defaults + publishedOverrides`（预览时叠加 `draftOverrides`），保存用 revision 乐观锁，冲突返回 409。
7. **渲染安全**：Nunjucks 默认自动转义，正文经消毒标记 `TrustedHtml`，配置色值经 `css_color` 白名单过滤器，Slot 片段按受信任协议输出。

性能与可靠性：首页 HTML 采用服务端缓存 + 主题/插件版本失效键；静态资源指纹化长缓存；MySQL 关键列索引与分页；事件订阅按优先级排序且单订阅错误隔离，异步不可丢事件使用 Outbox（预留接口，M2 仅内存实现 + 标记）。

## Architecture Design

```mermaid
flowchart TD
  B[浏览器 / 搜索引擎] --> N[Nginx]
  N --> F[Fastify Server]
  F --> PR[公开站点路由<br/>Page Provider 插件 → Renderer]
  F --> AR[/api/admin/*<br/>会话/CSRF/授权]
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
  PM --> DR --> SR
  PM --> EB & RR
  PM --> DA
  F --> CORE
  CORE --> P[官方插件<br/>identity / authorization / posts / taxonomy / media]
  CORE --> T[主题<br/>minimal / default]
  DA --> DB[(MySQL 8.4)]
  RD --> T
```

模块关系（对齐文档第 5 章职责边界）：

- **Bootstrap**：加载配置 → 初始化 Database Adapter → 注册 Core 服务 → 发现并校验插件 → 依赖解析 → 启动插件 → 挂载路由 → 监听；任一业务插件缺失时进入恢复模式（安装/维护界面）。
- **Plugin Manager**：发现 `plugins/**`、校验 Manifest、管理 `DISCOVERED→VALIDATED→INSTALLED→ENABLED→STARTED→STOPPED/DISABLED` 生命周期，FAILED 独立记录。
- **Dependency Resolver**：校验 apiVersion、按 capability 建图、拓扑排序、循环/版本冲突报错。
- **Service Registry / Event Bus / Router Registry**：契约发布与调用、带优先级的订阅与失败记录、路由合并与 URL 生成及冲突检测。
- **Theme Manager + Renderer**：主题校验/安装/预览/切换/回滚；Nunjucks 编译、模板回退（主题模板→fallback.njk→Core 默认模板）、Slot 聚合、helper 与缓存。
- **Security Gateway**：会话边界、能力校验、CSRF、审计写入 `rn_audit_logs`，且不因权限插件被禁用而放行管理操作。

## Directory Structure

即在现有空工作区基础上从零搭建 monorepo（工作区当前仅有规格文档 `RiceNote 项目规划与架构说明书 v1.0.md`）。

```
ricenote/
├── package.json                        # [NEW] 根脚本：dev/build/test/lint/validate（pnpm -r 编排）
├── pnpm-workspace.yaml                 # [NEW] workspace：apps/* packages/* plugins/official/*
├── tsconfig.base.json                  # [NEW] TS strict + @ricenote/* 路径别名
├── .env.example                        # [NEW] DATABASE_URL/SESSION_SECRET/PORT/STORAGE_DIR
├── docker-compose.yml                  # [NEW] MySQL8.4 + server + Nginx
├── docs/
│   ├── architecture/overview.md        # [NEW] 总体架构与边界（对齐文档第3/5章）
│   ├── plugin-api/v1.md                # [NEW] Plugin API v1：Manifest/生命周期/上下文/能力
│   ├── theme-api/v1.md                 # [NEW] Theme API v1：theme.json/上下文/helper/Slot
│   └── adr/ADR-001..006.md             # [NEW] 记录文档第13章关键决策与待定项默认取值；ADR-006 记录后台 UI 采用 shadcn-vue
├── packages/
│   ├── shared/src/
│   │   ├── manifests/plugin.schema.json # [NEW] 插件 Manifest JSON Schema
│   │   ├── manifests/theme.schema.json  # [NEW] 主题 Manifest JSON Schema（含 settings 字段类型白名单）
│   │   ├── capability.ts                # [NEW] capability 解析/版本区间匹配工具
│   │   ├── errors.ts                    # [NEW] 统一错误码（Manifest/依赖/路由冲突/409 等）
│   │   └── types/dto.ts                 # [NEW] REST DTO 与主题设置类型
│   ├── plugin-sdk/src/
│   │   ├── index.ts                     # [NEW] 公共导出（definePlugin/PluginManifest/PluginContext）
│   │   ├── context.ts                   # [NEW] PluginContext 契约（logger/config/db/services/events/routes/slots/adminMenu）
│   │   └── plugin.ts                    # [NEW] Plugin 接口（setup/start/stop）与 definePlugin
│   ├── theme-sdk/src/
│   │   ├── index.ts                     # [NEW] 主题作者依赖的类型与校验器入口
│   │   ├── helpers.ts                   # [NEW] helper 类型：site/page/post/posts/theme/viewer
│   │   ├── filters.ts                   # [NEW] css_color/date/excerpt 等过滤器契约
│   │   └── validator.ts                 # [NEW] theme.json 设置字段校验（白名单/默认值）
│   └── core/src/
│       ├── bootstrap.ts                 # [NEW] 组装内核与启动编排、健康检查、恢复模式入口
│       ├── logger.ts                    # [NEW] 结构化日志（请求ID/插件边界）
│       ├── config/{loader,schema}.ts    # [NEW] 配置加载与环境校验（Ajv）
│       ├── database/
│       │   ├── client.ts                # [NEW] Drizzle + MySQL 连接池
│       │   ├── adapter.ts               # [NEW] 事务/命名约束（rn_ 前缀）/插件自有表隔离
│       │   ├── migrate-coordinator.ts   # [NEW] 迁移串行编排 + 锁 + rn_plugin_migrations 校验值
│       │   └── schema/core.ts           # [NEW] Core 元数据表；schema/theme.ts、schema/audit.ts
│       ├── plugins/
│       │   ├── manager.ts               # [NEW] 发现/校验/启停/升级/健康
│       │   ├── loader.ts                # [NEW] Manifest 加载与 entry 动态导入
│       │   ├── dependency-resolver.ts   # [NEW] capability 解析/拓扑排序/循环检测
│       │   └── lifecycle.ts             # [NEW] 状态机与 FAILED 记录
│       ├── services/registry.ts         # [NEW] 契约发布/调用/失效处理 + dispose 句柄
│       ├── events/bus.ts                # [NEW] 订阅/发布/优先级/失败记录 + outbox.ts（预留）
│       ├── routing/{registry,url}.ts    # [NEW] 路由合并/冲突检测/命名路由 URL 生成
│       ├── themes/
│       │   ├── manager.ts               # [NEW] 校验/安装/预览/切换/回滚/缓存失效
│       │   ├── settings.ts              # [NEW] 三层配置合成 + revision 乐观锁
│       │   └── zip-guard.ts             # [NEW] ZIP 限额/Zip Slip/符号链接/路径归一化校验
│       ├── render/
│       │   ├── renderer.ts              # [NEW] Nunjucks 环境/编译/模板回退
│       │   ├── context.ts               # [NEW] Theme Context 构建
│       │   ├── slots.ts                 # [NEW] Slot 注册/排序/错误隔离
│       │   ├── safe-html.ts             # [NEW] TrustedHtml 消毒
│       │   └── cache.ts                 # [NEW] HTML 缓存与失效
│       └── security/{gateway,session,csrf,audit}.ts  # [NEW] 能力校验/会话/CSRF/审计
├── apps/
│   ├── server/src/
│   │   ├── index.ts                     # [NEW] 进程入口
│   │   ├── bootstrap.ts                 # [NEW] 调用 core.bootstrap 并暴露 Fastify
│   │   ├── http/{server,public-routes,admin-routes,static}.ts  # [NEW] 服务/公开路由/管理路由/静态资源
│   │   ├── cli/{index,validate}.ts      # [NEW] ricenote CLI：migrate/plugin/theme/validate
│   │   └── recovery/recovery-mode.ts    # [NEW] 无业务插件时的安装/维护界面
│   └── admin/src/
│       ├── main.ts / App.vue / router.ts
│       ├── index.css                    # [NEW] Tailwind 入口 + shadcn-vue 设计令牌（柠檬黄主色，无玻璃效果、无阴影）
│       ├── lib/utils.ts                 # [NEW] cn() 合并工具（clsx + tailwind-merge）
│       ├── api/client.ts                # [NEW] 带 CSRF 与 If-Match 的 API 客户端
│       ├── stores/{auth,theme,plugin}.ts
│       ├── layouts/AdminLayout.vue      # [NEW] 顶栏 + 侧边导航
│       ├── components/ui/*              # [NEW] shadcn-vue 内联组件（button/card/input/table/dialog/dropdown-menu/sonner 等，card 变体去除 shadow 类）
│       ├── components/{DataTable,ThemeSettingForm,PluginCard,MediaPicker}.vue
│       └── views/{Login,Dashboard,Posts,PostEditor,Taxonomy,Media,Themes,ThemeSettings,Plugins,Settings}.vue
├── plugins/official/
│   ├── hello/{manifest.json,src/index.ts}          # [M1] 启停验证示例插件
│   ├── identity/{manifest.json,src,drizzle,migrations}   # rn_identity_users/sessions
│   ├── authorization/{manifest.json,src}           # 角色/能力校验
│   ├── posts/{manifest.json,src,drizzle,migrations}      # rn_posts
│   ├── taxonomy/{manifest.json,src,drizzle,migrations}   # rn_terms/rn_term_relations
│   └── media/{manifest.json,src,drizzle,migrations}      # 上传与媒体元数据
├── themes/
│   ├── minimal/{theme.json,templates/*.njk,assets/*}   # [M2] 极简阅读主题
│   └── default/{theme.json,templates/*.njk,assets/*}   # [M2] 占位，M3 完善
├── storage/{uploads,cache,logs}/.gitkeep
└── tests/{integration,e2e,fixtures}/
```

（`plugins/official/{comments,search,seo}` 属 M4，本次仅保留预留约定，不创建实现。）

## Key Code Structures

```ts
// packages/shared/src/manifests/plugin.schema.json（字段契约，节选语义）
// schemaVersion=1, id, version, apiVersion, entry,
// requires: Record<capability|pluginId, semverRange>,
// provides: string[]（如 "content.posts@1"）,
// capabilities: ("routes:public"|"database:own"|"events:publish"|...)[],
// migrations?: string

// packages/plugin-sdk/src/index.ts
export interface PluginContext {
  manifest: PluginManifest;
  logger: PluginLogger;
  config: PluginConfigReader;           // 读取该插件命名空间配置
  db: PluginDatabase;                   // 仅限自有表/受管迁移，禁止跨插件联表
  services: ServiceRegistryFacade;      // provide()/use() 返回句柄
  events: EventBusFacade;               // on(event, handler, priority) => Unsubscribe
  routes: RouteRegistryFacade;          // add(method, path, handler) => Dispose
  slots: SlotRegistryFacade;            // register(slotName, component, priority) => Dispose
  adminMenu: AdminMenuRegistry;         // 向后台注入菜单/统计
}

export interface Plugin {
  setup?(ctx: PluginContext): void | Promise<void>;
  start?(ctx: PluginContext): void | Promise<void>;
  stop?(ctx: PluginContext): void | Promise<void>;  // 必须注销全部句柄
}
export declare function definePlugin(p: Plugin): Plugin;
```

```ts
// packages/theme-sdk/src/index.ts（主题 Manifest 关键类型，节选）
export type ThemeSettingFieldType =
  | "text" | "textarea" | "color" | "boolean" | "number" | "select" | "image" | "url";

export interface ThemeSettingField {
  type: ThemeSettingFieldType;
  label: string;
  description?: string;
  default?: unknown;
  min?: number; max?: number; maxLength?: number;
  options?: { label: string; value: string }[];
}
export interface ThemeManifest {
  schemaVersion: 1; id: string; name: string; version: string;
  apiVersion: string; engine: "nunjucks";
  templates: Record<string, string>;              // { home, post, 404, ... }
  settings?: Record<string, { label: string; fields: Record<string, ThemeSettingField> }>;
}
```

## Implementation Notes

- **契约一致性**：Core 只暴露 SDK 公共接口，插件/主题一律经 `@ricenote/plugin-sdk`、`@ricenote/theme-sdk` 引用，杜绝跨包内部 import；改动 SDK 需同步 `docs/plugin-api`、`docs/theme-api` 与 ADR。
- **注销与泄漏控制**：所有注册表 API 返回 `Dispose`，`stop()` 必须全部调用；集成测试需断言插件禁用后服务/事件/路由/Slot 均不可见。
- **迁移安全**：`database:own` 能力的插件迁移统一经 `migrate-coordinator` 加锁串行执行；禁停不 drop 表，升级前记录校验值以便回滚检查。
- **渲染性能**：Nunjucks 环境预编译模板并按主题版本缓存在内存；首页 HTML 缓存键 = `theme_id + revision + 插件启用集合`，任一变化即失效，避免脏读；Slot 单组件 try/catch 隔离，异常降级为空片段。
- **安全边界**：主题只声明展示，不得访问数据库或注册 `/admin`、`/api` 核心路由；ZIP 解压在临时目录完成限额与路径归一化校验后再落盘；用户 HTML 必须经 `safe-html` 消毒并标记 `TrustedHtml` 方可直出。
- **配置校验默认值**：文档待定项按建议取值（v1 单站点，表保留 `site_id` 扩展点）写入 ADR；所有 Manifest/设置字段服务端二次校验，前端校验仅作体验。
- **日志规范**：复用统一 logger，携带请求 ID 与插件边界，禁止输出会话密钥与用户敏感数据，错误信息可定位但不倾倒大对象。
- **UI 组件规范**：后台一律使用 shadcn-vue 内联组件（`components/ui/*`），通过 CSS 变量（设计令牌）控制外观，禁止硬编码颜色类；组件源码属于项目源码，可按需修改。shadcn-vue 默认 `card` 等组件自带 `shadow-sm`，接入时须**移除全部 `shadow-*` 类**。

## 设计定位

RiceNote 后台为内容创作者使用的管理控制台，前台为阅读优先的极简博客。后台采用**现代简约 + 扁平利落**风格：以**柠檬浅黄**为主色（`#FDE047`，辅以深色前景保证对比度）、中性灰白底、清晰分隔线与层级、克制的微交互；**不使用玻璃拟态（glassmorphism）、不使用背景模糊与半透明磨砂面板、全站不使用任何阴影**——卡片为实色 + 1px 细边框，层级只靠边框与背景色区分。后台基于 Vue 3 + Vite + Vue Router + **shadcn-vue** 构建，独立 SPA 不侵入主题。前台 minimal 主题强调留白、排版层级与阅读舒适度。

## 后台设计系统（设计令牌）

在 `apps/admin/src/index.css` 以 CSS 变量定义令牌，由 Tailwind 主题消费；shadcn-vue 组件自动继承。**全程无玻璃效果、无阴影**（不出现 `backdrop-blur`、半透明磨砂面板、`box-shadow`）。

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* 主色：柠檬浅黄 */
    --primary: 50 98% 58%;            /* #FDE047 附近 */
    --primary-foreground: 26 30% 12%; /* 深色文字保证对比度，禁止白字压黄底 */
    --primary-hover: 46 96% 50%;
    /* 中性 */
    --background: 60 9% 98%;
    --foreground: 24 10% 10%;
    --card: 0 0% 100%;
    --card-foreground: 24 10% 10%;
    --muted: 60 5% 94%;
    --muted-foreground: 25 6% 45%;
    --border: 20 6% 88%;
    --input: 20 6% 88%;
    --ring: 50 98% 58%;
    --radius: 0.625rem;
    /* 阴影一律为 none，占位以兼容 shadcn-vue 默认工具类 */
    --shadow: none;
    /* 功能色 */
    --success: 142 71% 45%;
    --warning: 38 92% 50%;
    --destructive: 0 72% 51%;
    --info: 217 91% 60%;
  }
}
```

- **对比度约束**：主色为浅黄，主按钮一律「浅黄底 + 深色文字」；边框以 `--border` 描边。
- **无阴影约束（硬性）**：全站禁止 `box-shadow` / Tailwind `shadow-*` / `drop-shadow-*`；卡片层级仅由 1px 边框与背景色差表达；浮层（Dialog/Dropdown/Sheet）同样仅用边框 + 背景色区分，不投影。
- **图标**：`lucide-vue-next`，尺寸 16/18/20，描边 1.75。
- **动效**：仅 `transition-colors` / `transition-transform duration-200`，`prefers-reduced-motion` 下全部关闭。

## 前台 minimal 主题

服务端 Nunjucks 渲染的响应式博客：顶部站点标题导航、文章卡片列表（封面 + 摘要 + 日期）、文章详情页正文排版优化、页脚版权；配色随主题设置（accentColor/layoutWidth/fontFamily）实时生效。主题为独立配色体系，**不受后台主色影响**（默认 accentColor 仍为规格文档建议的 `#89A9C7`）。

## 后台页面规划（5 个核心页面）

1. **登录页**：居中实色卡片，站点 Logo、账号/密码输入（shadcn-vue `Input` + `Label`）、错误提示、进入按钮（浅黄主按钮 + 深色文字）；背景为柔和线性渐变，**无模糊、无玻璃层、无投影**。
2. **仪表盘**：站点状态卡片（版本/运行状态/告警）、内容与用户统计卡、快捷操作入口、插件健康概览。
3. **内容管理**：左侧文章列表（状态筛选、搜索、分页），右侧/独立文章编辑器（标题 + 正文 + 分类标签 + 状态 + 保存/发布），含媒体选择。
4. **外观中心**：主题卡片网格（预览图、版本、激活状态）、主题设置表单（按 theme.json 自动生成字段分组）、预览/保存发布/恢复默认。
5. **扩展中心**：插件卡片列表（名称、版本、状态徽标）、启用/禁用/设置、依赖关系展示与冲突提示。

## 单页区块设计

- **登录页**：品牌区 / 实色登录卡（shadcn-vue `Card`，去投影） / 表单校验反馈 / 底部版本信息（4 块）。
- **仪表盘**：顶栏（站点切换 + 用户菜单）/ 站点状态卡 / 统计卡组 / 快捷操作 / 插件健康列表 / 侧边导航（6 块）。
- **内容管理**：侧边导航 / 工具栏（筛选 + 搜索 + 新建）/ 文章数据表（shadcn-vue `Table`）/ 分页 / 编辑器抽屉（标题/正文/分类/媒体/发布）（5 块）。
- **外观中心**：顶部标签（已安装/主题设置）/ 主题卡片网格 / 设置表单分区分组 / 底部操作条（预览/保存发布/恢复默认）（4 块）。
- **扩展中心**：顶部说明 + 风险提示 / 插件卡片网格 / 卡片操作（启停/设置）/ 依赖与状态徽标（4 块）。

## 交互与响应式

统一顶栏 + 左侧导航；卡片 hover **仅 deepening 边框颜色与背景色**（不使用阴影、模糊或发光）；启停/保存操作配 `sonner` Toast 反馈，Toast 同样去投影；表单字段即时校验；`prefers-reduced-motion` 下关闭动效。桌面优先，窄屏侧栏折叠为抽屉（shadcn-vue `Sheet`，去投影），表格转卡片。

## Agent Extensions

### Skill

- **lsp-code-analysis**
- Purpose: 在 pnpm monorepo 多包协作开发中，快速定位 Core 模块、SDK 契约与插件实现之间的定义与引用关系，做契约一致性与影响面检查。
- Expected outcome: 确认 SDK 接口与各插件/主题引用点一致，避免契约漂移与跨包非法 import。
- **playwright-cli**
- Purpose: 对管理后台执行端到端验证，覆盖登录、写作、发布、浏览与主题相关交互。
- Expected outcome: 产出可复现的 E2E 通过记录（截图/步骤），验证 M2 "能登录、写作、发布、浏览" 退出标准。