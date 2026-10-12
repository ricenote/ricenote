# Changelog

本项目的所有显著变更都会记录在此文件中。

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
并且本项目遵守 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [Unreleased]

### Added（GitHub Wiki 文档站）

- **新增 `wiki/` 内容源（37 个页面）与一条可重复执行的发布通路**：内容源纳入版本库、可 review，
  发布则是**镜像同步** —— 以 `wiki/` 为准增删页面，因此"下掉一个页面"也能生效，
  而不是只增不减；无变化时直接跳过并以 0 退出，适合放进流水线而不产生噪音提交。
- **面向使用者与部署者的手册**（15 页）：快速开始、安装向导（全部参数与"必须安装的两项插件"）、
  环境变量参考（逐项对照配置加载器，含"改完要不要重启"）、容器化部署与反向代理
  （如实写明 `docker-compose.yml` 引用的 `docker/server.Dockerfile` 与 `docker/nginx.conf`
  当前仓库尚未提供）、升级已部署实例、后台功能导览、命令行参考、主题与外观、
  官方插件一览（11 个官方 + 第三方示例）、插件安装与更新、FAQ、故障排查。
- **深度开发者文档**（22 页），刻意**不复制** `docs/` 正文，而是逐项展开：
  - **逐项 API 参考**：`PluginContext` 每个门面方法与能力门、`manifest.json` 每个字段、
    17 个跨插件服务契约逐方法签名与降级语义、主题全部 helper 与过滤器；
  - **从零写插件的完整教程**：脚手架 → 清单逐字段 → 迁移与数据 → 插槽 →
    管理 API → 声明式设置 → 零构建后台界面 → 事件与启动时序 → 测试 → 本地调试 → 打包发布，
    全程给出可直接复制的代码；
  - **内核机制源码级剖析**：启动时序（含每步失败后果与恢复模式）、插件发现与依赖解析
    （capability 优先、稳定拓扑排序、迭代剔除）、生命周期状态机、插槽「占位符 + 渲染后替换」、
    HTML 缓存键构成与标签失效、迁移协调器与 SHA-256 校验值防线、会话/CSRF/能力校验/审计链路、
    命名扩展点三作用域模型；
  - 另含扩展点全量清单、ADR 索引与维护发布指南。
- **发布器 `scripts/publish-wiki.mjs`**（零新增依赖，仅用 Node 内置模块），
  对应 `pnpm wiki:publish` 与 `pnpm wiki:check`：
  - **不硬编码默认分支**：用 `git symbolic-ref` 探测（Wiki 仓库历史上可能是 `master`），
    并正确处理**空仓库首次推送**（HEAD 尚未诞生）；
  - **离线自查** `--check`：必须有 `Home.md`、禁止仓库相对链接（wiki 是独立仓库，相对路径必然失效）、
    内部链接目标必须存在；围栏代码块与行内代码被豁免（文档里需要直接写出链接语法本身）；
  - **失败给中文指引而非原始 git 报错**：Wiki 未启用 / 未创建首页面时直接说明
    "Settings → Features 勾选 Wikis 并创建第一个页面"；提交缺少 git 身份、推送无权限同样给出可执行的修复步骤；
  - **凭据不进日志**：打印远端地址时掩码凭据段，并设置 `GIT_TERMINAL_PROMPT=0`
    避免非交互环境被凭据提示挂死；
  - `--dry-run` 可先看将新增/修改/删除的页面再决定是否推送。

### Changed（后台文案面向普通用户）

- **后台管理界面不再暴露技术细节**。定位是面向普通用户的产品，因此删掉了解释原理/机制/字段的
  说明性文字（如重启的"关停插件与数据库连接、监听同一端口、期间返回 503"、扩展中心的
  "capability 契约解析依赖（ADR-004）"、插件安装的"核心进程内运行、无真实安全沙箱"、
  系统设置的"运行时能力/插槽与事件"技术描述等），并把技术词统一改写成用户语言：
  「落盘」→保存/写入、「落库」→写入数据库、`.env`/环境变量→部署配置、数据库→站点数据、
  `HttpOnly Cookie`/`CSRF Token` 等直接删去。
- **内部标识不再直接显示**：插件状态（`STARTED`/`ENABLED`/`FAILED`…）与日志级别
  （`debug`/`info`/`warn`/`error`）改为中文展示；插件 ID、`apiVersion`、`revision`、
  文件 `path:line`、`User-Agent`/IP 哈希等对用户无意义的标识一并隐藏或改写。
- **插件卡片文案同步**：11 个官方插件 `manifest.json` 的 `description` 与官方目录
  `packages/shared/manifests/plugin-catalog.json` 的 `description` 一起改写为面向用户的表述
  （原「通过 header.navigation 插槽输出到前台」「在 head.end 注入 Open Graph / JSON-LD」
  「Core 的安全网关据此执行 fail-closed 鉴权」等）。两组描述保持逐条一致；
  插件的 `settingsSchema` 标签与说明**本次未动**。
- **覆盖三处用户可见文案**：核心后台 `apps/admin/src`、官方插件自带后台界面
  `plugins/official/*/admin`（零构建 ESM 源文件，热改即生效）、共享组件库
  `packages/admin-sdk/src`。
- **功能项与注释不动**：日志级别选项、输入占位示例、版本号等仍保留；**代码注释一律未改**，
  插件的服务端源码、`docs/`、`wiki/` 与测试用例均在本次范围之外。

### Fixed（wiki 页面命名：改为扁平）

- **wiki 页面从「目录式」改为「扁平前缀式」命名**。根因是 **GitHub Wiki 不支持用目录组织页面** ——
  文件名决定页面标题，而标题中不允许出现 `/`（GitHub 官方文档「Adding or editing wiki pages」
  明确列出禁用字符 `\ / : * ? " < > |`）。原先按 `Plugins/`、`Development/Architecture/`
  组织，推送后 GitHub **丢掉目录、只取文件名当标题**，于是三个 `Overview.md`、两个 `Settings.md`
  争同一个 `wiki/Overview` / `wiki/Settings` 地址，绝大多数页面无法按预期 URL 打开
  （`wiki/_pages` 列表里同名标题重复出现，可复现）。
  现改为连字符前缀（`Plugins-Install-and-Update.md`、`Architecture-Core-Bootstrap.md`、
  `Plugin-API-Tutorial.md`），**侧栏仍按原分组呈现**，读者观感不变；
  迁移由一次性脚本 `scripts/migrate-wiki-layout.mjs` 完成（24 个文件重命名 + 193 处内部链接改写，
  幂等、支持 `--dry-run`，并自动清理空目录）。真实远端预演结果：新增 24 个扁平页面、
  更新 10 个（链接改写）、删除 24 个旧目录路径页面。
- **`pnpm wiki:check` 新增两条硬校验**，让这类问题在本地就被拦住，而不是等推上去发现页面打不开：
  ① **文件名不得包含目录分隔符**（GitHub 会丢目录）；
  ② **页面标题规范化后必须全局唯一**（GitHub 把连字符显示为空格，故 `Foo-Bar.md` 与 `Foo Bar.md`
  在读者眼里是同一个标题）。
- `wiki/Contributing.md` 的「页面命名与结构」「链接约定」两节据实重写：讲清目录为何必须平铺、
  连字符在标题栏会被显示为空格、以及正确的链接语法顺序（`[[显示文本|页面名]]`，**显示文本在前**）——
  后者是本次批量改写中自查出来的一处说明性错误。

### Docs（同上）

- README 增补「GitHub Wiki」小节：内容源位置、两条命令、首次发布的前置条件与页面写法规约。
- 编写开发者文档时**逐条核对了实现**，并把发现的「文档声称 vs 代码实际」偏差如实写进 wiki
  （而不是照抄旧说明），共 10 处：`theme.json` 的设置字段是 `settings` 而非 `settingsSchema`；
  `site.logoUrl` 等可选字段未设置时是 `undefined`（键不存在）而非空字符串；
  `absoluteUrl` 不是模板 helper（模板用 `site_url`）；`json` 过滤器不在 `THEME_FILTERS` 中而由 Core 单独注册；
  模板回退实现是 5 步（含 `pageTemplates` 键与显式文件名两种"显式模板"来源）；
  `pnpm theme install` 命令并不存在（安装向导结束语引用了它，主题安装实际入口是后台）；
  错误码常量不携带与 HTTP status 的集中映射；`assertNoLeaks()` 目前仅由测试调用；
  插件作用域数据库句柄没有按插件 ID 的表名前缀（隔离靠约定与评审，非运行时强制）；
  `.env.example` 中的 `LOG_FORMAT` / `NO_COLOR` / `DB_ROOT_PASSWORD` 未被配置加载器消费。

## [0.5.1] - 2026-10-12

> 补丁版本：在 0.5.0 的基础上移除示例插件 `rice.hello`（官方插件集 12 → 11）、
> 补上「升级已部署实例」文档，并修掉后台深链丢查询参数（会把"编辑文章"变成"重复新建"）。
> **插件声明的宿主区间不需要跟着改**：它们写的是 `^0.5.0`（含 `>=0.5.0 <0.6.0`），补丁升级仍在其范围内 ——
> 宿主处于 `0.x` 阶段时只有**次版本号**跃迁才会跨出区间，那才需要一起提升。

第五个里程碑版本（在"插件平台化"之上补齐**可扩展性、编辑体验与部署可配置**）。三条主线：
**命名扩展点**让插件之间能互相扩展界面与逻辑（三作用域统一模型、可替换语义，主题还能声明内容自定义字段）；
**独立内容编辑页**把写作体验交还给插件（可选官方插件「编辑增强」接入 Toast UI，提供 Markdown 双栏编辑、
自动草稿与"与前台一致"的预览）；**安装向导可配置本进程监听端口**，并讲清反向代理的边界。
同时修掉四处真实缺陷（详见下方 Fixed）：提供方自身的 `replace` 被 `replaceable: false` 误拒、
贡献组件未声明 `props` 导致 context 静默读不到、标签重名 409 被当成普通错误、
以及硬刷新带查询参数的编辑深链丢参数（会把"编辑"变成"重复新建"）。

- 插件安装从"上传压缩包"扩展为**三路来源 + 统一编排 + 任务队列**（ADR-015）。

### Added（安装向导与官方插件 npm 分发，ADR-016）

- **`pnpm run setup` 安装向导**（零新增依赖，`node:readline/promises`；注意裸 `pnpm setup`
  是 pnpm 自带命令，会配置 `PNPM_HOME`/PATH 并抢在同名脚本前执行）：
  环境检查 → 数据库（**不存在时自动建库**，库名做标识符白名单校验）→ 站点与管理员信息
  → 生成 `.env`（随机 `SESSION_SECRET`；非交互模式下自动生成初始管理员密码并仅显示一次）
  → 执行 Core 迁移 → **勾选要安装的官方插件并从 npm 安装** → 首次启动完成初始化 → 结果摘要。
  支持 `--yes`（推荐档）、`--plugins=`、`--from-manifest`、`--skip-install`、`--no-scripts`、
  `--db-url=` / `--db-*`、`--site-*`、`--admin-*`、`--root-dir=`；无 TTY 自动降级为非交互；
  **可重入**（已有 `.env` 作为默认值、已装插件跳过）。
- **推荐插件清单**（`packages/shared/manifests/plugin-catalog.json` + Schema +
  `getPluginCatalog()`）：随主程序发布，记录每个官方插件的 npm 包名、推荐版本、
  分类（必需/推荐/可选/示例）、显示名与描述、能力与依赖。安装向导、后台目录、
  `pnpm validate` 与发布脚本读同一份数据。
- **扩展中心「官方插件目录」**（`GET /api/admin/plugins/catalog`）：未安装的官方插件
  可一键安装、已装版本低于推荐版本时提示"可更新"并支持更新；沿用安装任务面板
  （步骤条 + 等宽日志 + 失败原因）。
- **官方插件变为可独立发布的 npm 包**：11 个插件去除 `private`、补齐
  `files`/`publishConfig.access=public`/`license`/`repository`，`manifest.version`
  与 `package.json.version` 全量对齐（修掉 5 处历史漂移）。
- `scripts/release-plugins.mjs` + `pnpm release:plugins`：**先校验后发布**
  （版本三处一致、包名与目录一致、`files` 完整、宿主包未写成普通依赖、
  `dist` 与后台界面产物存在），按依赖顺序逐包发布；`--dry-run` / `--only=` 可用；
  新增 `--skip-published`：发布前查 registry，已存在的版本跳过并列出
  （npm 不允许覆盖版本号，全量发布时"只改了一个包"不会再被 EPUBLISHCONFLICT 中断整轮；
  查询失败时按"不存在"处理并提示，宁可让 registry 拒绝一次也不静默漏发）。
- `RICENOTE_PLUGINS` 声明式清单（`包名@区间`）：由向导写出，用于"重建环境可复现"；
  启动期**只核对不安装**，缺件或版本不符会给出可执行命令。
- `.env.example` 增补插件安装相关配置说明（`RICENOTE_PLUGINS`、`RICENOTE_LOCAL_PLUGINS`、
  私有源与脚本开关）；README 安装章节改为"向导优先"。
- 测试 +34 项：官方插件目录与发布形态、目录视图三种状态、安装向导参数解析与
  `.env` 增量写入、凭据生成与库名校验，以及**离线端到端**（本地静态 registry +
  真实 CLI 安装 → 落盘 → 声明式清单 → 管理员创建）。

### Changed（同上）

- `PluginSummary` 新增 `official`（属于官方插件目录），与 `builtin`（随仓库分发、
  不可卸载）分离：从 npm 安装的官方插件显示"官方"徽章但**可更新、可卸载**。
- 安装编排的 `prepare` 阶段新增两条判据：**拒绝**把宿主提供的包写成普通依赖的包；
  对"没有 `src/` 也没有 `tsconfig.json`"的包跳过依赖安装与构建（从 npm 装的官方插件即此形态）。
- 插件发现根目录抽成 `pluginDiscoveryRoots(config)`，内核启动、`validate`、
  `plugin` 命令与安装向导共用同一个定义。
- `pnpm validate` 新增「官方插件目录」校验（11 项）：条目与仓库实际形态一致
  （版本三处一致、包名一致、可发布形态、能力白名单一致），
  并提示未进目录的开发中插件。
- 启动期未初始化时给出引导：缺 `.env` 或库结构未建时输出 `pnpm run setup`，
  而不是让用户从数据库错误栈里反推。

### Added

- **三种安装来源**：`registry`（npm 包，可带版本区间；自动解析普通依赖、按语义化版本检查更新）、
  `git`（tag / 提交 / 分支；取源码后按 `scripts.build` 构建）、
  `local`（本地目录；**压缩包上传降级为这一路的一种入口形式**，`via: 'zip'`）。
- **统一安装编排**（`packages/core/src/plugins/install/`）：
  `resolve`（解析来源到工作区）→ `prepare`（校验清单与入口、装依赖、执行构建）→
  `commit`（换名落盘 + 写来源 + 审计 + 标记待重启）；任一步失败即回滚，
  **升级失败不会让现有版本消失或留下半成品目录**。
- **安装任务队列**（表 `rn_plugin_jobs`）：全局串行（同一时刻只有一个任务改磁盘）、
  同类任务去重（重复提交返回 409）、步骤与进度、末尾 64KB 日志、错误原因、
  操作者与起止时间；后台与 CLI 共用同一个执行器与同一份任务记录。
- **来源元数据**（`rn_plugins` 新增 `source_type` / `source_spec` / `source_ref` /
  `resolved_version` / `integrity` / `installed_via`）：扩展中心与 `plugin list` 展示
  "从哪来、装的哪个版本"；内置插件每次启动以仓库路径为准刷新，
  非内置插件保留安装器写下的权威记录。历史记录回填为 `local`。
- **更新检查**：`GET /api/admin/plugins/updates`（registry 对比 semver、git 对比远端提交、
  本地来源明确标注不可检查）；扩展中心显示"可更新 vX"徽章与行内更新按钮，
  CLI 提供 `ricenote plugin updates`。
- **CLI 命令**：`plugin install <npm 包> | --git <仓库> [--ref <引用>] | --dir <目录> | --zip <包>`、
  `plugin update <id>`、`plugin remove <id>`、`plugin jobs [jobId]`、`plugin updates`；
  与后台共用同一套编排与任务队列，行为一致（含 `--no-scripts` 开关）。
- **开发期本地插件目录监视**：新增配置 `RICENOTE_LOCAL_PLUGINS`（逗号分隔）。
  这些目录参与插件发现（**不需要"安装"动作**），且开发环境会监视其变化并
  **自动重启内核**（900ms 抖动合并），实现"改动即生效"。
- **新权限点 `plugin.install`**（安装 / 更新 / 卸载 / 构建）：默认仅 `administrator` 具备，
  与 `plugin.manage`（启停与设置）分开 —— 安装会在服务器上执行插件代码。
- 扩展中心安装体验：三来源分段切换（npm / Git / 本地，本地含压缩包与路径两种方式）、
  步骤条 + 等宽日志面板（可复制、失败行标红）、高风险确认框
  （明示"安装等同授予其服务器代码执行权限"，需勾选确认后方可提交，并写入审计）、
  每行展示来源信息与更新状态。

### Changed

- 插件包白名单与限额放宽（ADR-007 决策 4 修订）：新增 `.css` / `.html` / `.wasm` 与字体图片类型
  （插件自带后台界面需要），**仍禁止 `.node`**；体积上限 16MB/64MB → 32MB/96MB。
- `POST /api/admin/plugins/install`（压缩包）改为返回 **202 + 任务**（原先同步返回安装结果），
  由任务队列串行执行并输出日志；新增 `POST /plugins/install/source`、
  `POST /plugins/:id/update`、`POST /plugins/:id/remove`、`GET /plugins/updates`、
  `GET /plugins/jobs[/:id]`。
- 插件来源登记不再静默丢失：安装完成但内核尚未重启（`rn_plugins` 还没有该插件记录）时，
  会补写一条最小记录，避免"装完显示来源未知"。

### Fixed

- **仪表盘用路由名跳插件页导致每次登录都抛错**：`DashboardView` 的「全部文章」写的是
  `:to="{ name: 'posts' }"`，而插件页面路由在 v0.4.0 已改为运行时注册（名字是 `plugin:/posts`），
  于是 vue-router 抛 "No match" 并打断渲染（控制台可见、页面仍渲染）。
  改为按路径跳转（始终可解析，插件未启用时由兜底页面给出明确提示）。
- **侧栏按路由名跳转缺参数时抛错**：插件路由尚未注册（登录后菜单刚到、动态注册还没跑）时，
  路径会解析到兜底路由 `/:pathMatch(.*)*` 并拿到 `not-found` 这个名字，
  而它需要 `pathMatch` 参数 → `{ name }` 跳转直接抛错。
  现在带参数的路由一律退化为普通链接（与"未注册即降级"的既有意图一致）。
- 危险来源在**路由层**即被拒绝（原先 `ext::` 这类 Git 地址会先进任务队列再失败）：
  npm 包名与 Git 地址格式在提交时校验，安全边界的白名单校验保持两道（路由 + 解析器）。
- **安装命令参数按包管理器区分**：`--no-audit` / `--no-fund` 是 npm 专有参数，
  用 pnpm 时会导致整个安装失败（实测踩到），现在按探测到的包管理器拼参数。
- 单调仓库内的插件（依赖含 `workspace:` 协议）不再尝试独立安装依赖
  （在仓库外必然失败），改为跳过安装并使用其构建产物，并给出提示。
- **插件发现跳过安装器的瞬时目录**（`.incoming-*` / `.backup-*` 与点开头目录）：
  它们带着完整的 `manifest.json`，一旦被当成插件目录就会出现"同一 ID 两个来源"的冲突，
  把一个可自愈的清理失败放大成"插件加载不上"的故障。
- 旧版本备份清理失败时不再留在插件扫描根目录：先尝试移入缓存目录，失败则告警
  （发现机制已跳过该形态，因此不影响加载）。
- **CLI 在 `try/finally` 中 `return <promise>` 导致数据库提前关闭**：
  异步函数返回 promise 时会先执行 `finally`，于是"安装还没开始、连接已关"。
  相关分支改为 `return await`。
- 安装时复制插件目录排除 `node_modules`：工作区软链换位置即失效，
  依赖应由安装阶段重新生成。

### Added（命名扩展点，ADR-017）

- **命名扩展点三作用域统一模型**（`packages/core/src/extensions/registry.ts` +
  `contributions.ts`）：一套注册表覆盖 `render`（站点渲染）/ `admin`（后台界面）/ `server`（服务端钩子）；
  声明与贡献可由 `manifest.json` 的 `extensionPoints[]` / `contributions[]` 声明式完成（插件零代码），
  也可走运行时门面 `ctx.extensions.declare/contribute/apply/list`。
- **替换语义**：`replace` 贡献整体接管扩展点（默认内容与其他追加贡献不再呈现），胜出者取 `order` 最大者、
  同分由 `pnpm validate` 判错；`append` 按 `order` 降序。`replaceable: false` **只约束第三方**，
  提供方自己的 `replace` 不受约束。
- **旧 API 退化为别名**：`SlotRegistry`（`packages/core/src/render/slots.ts`）成为注册表的 render 作用域门面，
  `ctx.slots.register`、主题 `slot()` 与九个标准插槽、第三方 `acme.reading-time` 插件均**无需改动**。
- **后台作用域下发 + 后台界面 SDK 宿主**：`GET /api/admin/extensions`（启用态 + scope + 权限三重过滤，
  携带 entry / style URL 与 label）；`packages/admin-sdk/src/extension/` 的 `useAdminExtensions()` /
  `<PluginSlot>` / `defineAdminContribution`（无贡献→默认内容；append→默认 + 贡献按 order 降序；
  replace→仅胜出者；每条贡献独立错误边界；样式按引用计数注入 / 卸载；import 失败追加 `?retry=1` 重试一次）。
- **能力**：新增 `extensions:declare` / `extensions:contribute`；`slots:register` 保留为 render 贡献的别名能力。
- **文章与页面的独立编辑页**：两插件各新增一个 `hidden` 后台页面（路由与深链可用、不进侧栏），
  并声明三个跨插件锚点 `rice.{posts,pages}.listActions` / `.editorToolbar` / `.editorBody`（admin，`replaceable`）。
- **媒体选择器锚点 `rice.media.picker`**：媒体库声明该 admin 扩展点（`replaceable: false`）并用
  `mode: "replace"` 贡献面板；消费者未安装媒体库时渲染默认内容（直接填链接）。
- **内容自定义字段**：`@ricenote/shared` 的值级校验与读取过滤（fail-closed）、Core 的本地化 DTO 与
  `core.theme@1` 新增 `contentFields()`、`GET /api/admin/content-fields` 下发、文章 / 页面各新增
  `fields` JSON 列与读写过滤、默认主题声明 `featuredImage` 并在文章页 / 页面 / 首页卡片渲染。

### Changed（同上）

- 插件扩展能力从"只有渲染插槽"扩展为**三作用域命名扩展点**；`SlotRegistry` 内部委托给注册表，
  不再有第二套插槽实现（`replace` 接管、按插件清理与零残留断言三处天然一致）。
- 主题清单新增可选 `contentFields`（复用设置字段定义与多语言结构）。
- `pnpm validate` 新增命名扩展点静态校验（能力声明、扩展点全局唯一、贡献入口作用域白名单与文件存在、
  `replace` 同 `order` 冲突）与主题 `contentFields` 保留字校验。

### Fixed（同上）

- **提供方自身的 `replace` 被 `replaceable: false` 误拒**：贡献校验本意是约束**第三方**，
  之前会把提供方自己的 `replace` 也拦下（媒体库的默认面板会因此无法注册）。
  判据改为三段条件 `mode === 'replace' && !replaceable && consumer !== provider`
  （`packages/core/src/extensions/registry.ts`）。
- **贡献组件未声明 `props` 导致 context 读不到**：宿主用 `h(component, context)` 传值，
  Vue 只把组件自己声明过的字段填进 `setup(props)`，未声明者会落进 `ctx.attrs`，
  于是 `setup(props)` 静默拿到 `undefined`（表现为"点了没反应且无报错"）。
  `defineAdminContribution` 现要求并文档化 `props` 声明
  （`packages/admin-sdk/src/extension/contribution.ts`）——这是一处文档与实现口径需要一并澄清的坑。

### Added（编辑器与标签输入）

- **「编辑增强」接入真 Toast UI Editor**（`plugins/official/editor-enhance`）：把上游
  `@toast-ui/editor@3.2.2`（MIT）的自包含产物 vendor 进插件 `admin/vendor/`
  （宿主不新增依赖、插件侧无构建步骤，来源与复现步骤见该目录 README）；正文锚点从
  "普通文本域 + 服务端预览"升级为 Markdown 编辑器（双栏实时预览、自带顶部工具栏、中文界面、
  关闭使用统计）。vendor 缺失时**自动降级**回文本域，编辑功能与草稿都不缺失。
- **文章编辑页的标签改为"输入即选择、不存在即创建"**：单输入框内多选已有标签
  （忽略大小写与首尾空白、高亮匹配、键盘上下与回车选取），输入不存在的名称时按权限
  自动创建标签（`POST /api/admin/terms`，`type: 'tag'`）并选中；分类选择保持原样。

### Changed（同上）

- 文章编辑页的词条区拆成「分类」与「标签」两块；标签逻辑抽为 `admin/tag-utils.js`
  （纯函数、可单测）与 `admin/tag-input.js`（纯 UI，经回调 props 与页面交互）。
- 创建标签需要 `taxonomy.manage`：无该权限的角色（`author` / `contributor`）只可选择已有标签，
  界面给出原因说明，而不是"输入了没反应"。

### Fixed（同上）

- **标签重名不再让保存失败**：服务端按 slug 判重返回 409，前端此前会把它当成普通错误；
  现在回退为"重新拉取词条列表并选中已存在的那条"并提示已选中，同时先按名称本地查重以减少白撞。

### Added（安装向导的本进程监听配置）

- 向导新增 `--host` / `--port`（与数据库的 `--db-port` 明确区分）：交互模式会问「监听地址 / 监听端口」，
  端口必须是 1–65535 的整数（**非法值在参数解析阶段就拒绝**，而不是等启动监听时才炸），
  `--yes` 等非交互路径不提问、直接用参数或默认值；`HOST` / `PORT` 由向导写入 `.env`。
- 对外访问地址（`SITE_URL`）默认改为**按监听端口推导**（`http://localhost:<port>`），不再写死 3000；
  摘要里同时给出「本进程监听」与真实后台地址。文档与 `.env.example` 说明：
  **本进程只需保证该监听端口可达，对外地址与 TLS 由反向代理（nginx / caddy）决定**，二者不一致是正常的。

### Fixed（部署与后台）

- **硬刷新 / 直接粘贴带查询参数的插件深链会丢 query**：后台守卫里"兜底路由重新解析一次"写的是
  `{ path: to.fullPath }`，而 vue-router 对**对象形式的 `path`** 会先剥掉 `?query` 再匹配、
  随后从 `query` 字段重建地址 —— 参数就此消失。插件编辑页正是靠 `?id=<id>` 区分"编辑/新建"，
  于是**硬刷新后编辑文章会变成新建一篇重复文章**（应用内点击不受影响，因为那时路由已注册、
  不走这条分支）。改为显式带上 `query` 与 `hash`（`apps/admin/src/router.ts`），
  顺带修好登录后 `?redirect=` 回流的同类问题。

### Docs（升级说明）

- README 新增「升级已部署实例」：**插件自助更新**（后台扩展中心 / `pnpm plugin updates|update|jobs`）
  与**程序本体更新**（拉取最新代码 → 装依赖 → 构建 → 校验 → 迁移 → 重启）两条流程、
  迁移的三条硬注意事项（不改已应用的迁移文件、迁移不可逆需先备份、插件宿主区间跟随宿主版本）
  与升级后自检清单（`/api/health`、启动日志、扩展中心、前台）。

### Removed（官方插件集）

- **`rice.hello` 不再随仓库分发**：它只是"插件发现 / 依赖解析 / 路由注册 / 服务发布 / 事件订阅 / 后台菜单"
  各一处的最小演示（安装向导**本来也不预装** `example` 类插件），删掉不影响任何功能；
  仓库里另有 `acme.reading-time` 作为第三方示例插件可参考。
  一并清掉：`plugins/official/hello/`、官方插件目录条目、`plugin-api` 与 `hooks-inventory` 里的清单行。
  生命周期集成测试原先写死 `rice.hello`，现改为**动态挑选一个默认未启用的插件**去覆盖"启用"这条状态变更，
  以后增删插件不会再把用例带碎。
  已装过的实例无需特殊处理（插件没被发现就不会启动）；若 `.env` 的插件清单里仍列着
  `@ricenote/plugin-hello`，删掉该项即可，否则启动期核对会提示它缺件。

## [0.4.0] - 2026-10-11

第四个里程碑版本（插件平台化）。两条主线：**后台界面交还给插件**（插件自带界面 +
后台界面 SDK，Core 只保留通用宿主）与**导航栏独立成插件**（`rice.navigation`），
并补齐插件声明式设置表单、站点与账号信息在线修改、以及一键重启闭环。

### Added

**插件自带后台界面与后台界面 SDK（ADR-014）**

- 新增 `packages/admin-sdk`：后台 UI 原子组件（10 个）、设计令牌与后台公共类、
  `api` 客户端、会话/提示/运行状态等组合式能力集中为**唯一来源**，
  Core 自有页面与插件界面共用；另新增 9 个复合组件（`AdminPage`、`DataTable`、
  `Field`、`Pagination`、`Tabs`、`EmptyState`、`LoadingState`、`ConfirmDialog`、`Icon`）
  与 `defineAdminPage` / `setHostContext` / `navigate` 等插件契约。
- 插件可自带后台界面：在 `admin/main.js` 导出一个页面组件即可（**零构建**：
  纯 ESM + 模板字符串，不装依赖、不打包；组件由宿主全局注册，模板里直接用）。
- manifest 新增可选 `admin.pages[]`（`id`/`label`/`path`/`icon`/`order`/`permission`/`entry`）：
  Core 自动注册菜单、把 `entry` 换算为前端入口 URL，并在插件启动与 `pnpm validate` 时
  校验入口文件存在、路径与 ID 全局唯一。`AdminMenuItem` 新增 `pluginId` 与 `entryUrl`
  （前端不拼接路径）；`available: false` 表示"插件声明了该页面但当前未启用"。
- Core 新增通用宿主 `PluginHostView`：加载中 / 就绪 / 加载失败 / 未启用四态、
  `onErrorCaptured` 错误边界（插件出错只降级当前页）、插件自带样式注入；
  路由由菜单**动态注册**（URL 与插件声明一致，书签不受影响），并新增后台 404 页面
  （不再把未知地址静默重定向到仪表盘）。
- 新增两条静态托管：`/admin-sdk/v1/**`（SDK 与 Vue/Vue Router 产物，
  **宿主与插件共用同一 URL** 以保证单实例）与 `/plugin-admin/:pluginId/**`
  （插件界面资源，需登录 + 插件已启用 + 路径限定在插件 `admin/` 目录内）；
  抽出 `apps/server/src/http/static-assets.ts` 统一 MIME 白名单、防穿越、缓存策略与 `nosniff`。
- SDK 构建期断言"产物不得出现裸模块名，且必须引用托管 Vue"，把"两份 Vue 实例"
  这类**页面空白且控制台干净**的疑难问题拦在构建期。

**导航栏插件（rice.navigation）与 `content.navigation@1`**

- 新增官方插件 `rice.navigation`：顶部导航栏成为**独立可管理的实体**，
  不再由页面插件"顺带"输出。导航项有三种来源：
  **自定义链接**（站内路径或外部地址）、**页面**、**文章**；
  可排序、可停用、可设新窗口打开、可自定义文案。
- 引用类项只保存内容 ID（`ref_id`），标题与地址在读取时解析：
  页面/文章改名后导航自动跟随；目标被删除或未发布时**前台跳过**（绝不输出死链），
  后台则标记 `exists` / `published` 并给出提示。
- 新增后台「导航栏」管理页（侧栏入口，`nav.view` / `nav.manage`）：
  前台预览、上下移排序、启用开关、类型化编辑表单（页面/文章走目标选择器，
  只列已发布内容）、目标失效原因提示。
- 新增服务契约 `content.navigation@1`（`listRenderable` / `listForAdmin` /
  `save` / `remove` / `move` / `targets`），表 `rn_nav_items`。
- 新增 `rice.navigation` 的声明式设置：`maxItems`（前台最多渲染项数，默认 10）。
- 新增地址白名单校验：只接受 `/` 开头的站内路径与 `http(s)://` 绝对地址，
  拒绝 `javascript:` / `data:` / `vbscript:` / `mailto:` / 相对路径 / 协议相对地址（`//evil.com`）；
  外链固定输出 `rel="noopener noreferrer"`。
- 新增 `content.posts@1.publishedRefs(ids)`：一次查询返回已发布文章的
  `{ id, title, url }`，供导航等全局插槽使用（避免逐条 `findPublishedById` 的 N+1）。
- 新增事件 `content.post.updated.v1`（`{ postId, slug, title, status }`）：
  此前只有发布状态翻转才发事件，改标题/别名没有任何信号。
- `rice.navigation` 订阅内容事件，但**仅在该内容确实被导航引用时**清空 HTML 缓存
  （导航出现在每个页面上，按标签失效覆盖不到；不做判定则每次保存文章都会清全站缓存）。
- 新增权限点 `nav.view` / `nav.manage`（组「外观」），并写入内置角色：
  `editor` 兼备、`author` / `contributor` 仅有查看权限。
- 新增 **ADR-013**（导航栏所有权与引用式导航项）：记录"单一写入者""引用而非快照"
  "v1 只做一级导航"三项决策与取舍；扩展点清单、插件 README 与主题侧说明同步更新。
- 文档补充一项**关键约束**：进程内软重启不会重载模块代码（Node ESM 缓存按 URL 生效），
  因此"改了插件/内核代码"必须重启进程，后台按钮只解决配置与启停生效（ADR-012）。

- **共享设置 Schema 新增 `stringList` 字段类型**：值为 `string[]`，后台表现为
  「每行一项」的多行输入，支持 `maxItems`（默认 200）与 `maxLength`（单项长度）。
  主题设置与插件设置同时获得该类型（二者共用同一份
  `packages/shared/manifests/settings.schema.json`）。
  提交时也接受"按行分隔的字符串"，服务端统一拆分为数组并丢弃空行与首尾空白。
- **全部官方插件补齐声明式设置表单**（后台「扩展中心 → 插件 → 设置」自动生成，
  保存后提示重启，与主题设置共用同一套表单组件与校验）：
  - `rice.seo`：`social`（Open Graph / Twitter Card / JSON-LD / 默认分享图）、
    `crawler`（sitemap 开关与上限、`robotsDisallow` 列表）；
  - `rice.comments`：`general`（评论区开关、先审后发、分页、字数、嵌套深度）、
    `antispam`（频率限制两项、单条链接数、`blockedKeywords` 列表）；
  - `rice.posts`：列表每页条数与自动摘要长度；
  - `rice.search`：每页结果数、关键词长度上限、单数据源条数上限；
  - `rice.identity`：会话有效期与单用户并发会话上限；
  - `rice.media`：单文件体积上限；
  - 第三方示例 `acme.reading-time`：阅读速度、字数开关、前缀文案
    （证明声明式设置对第三方插件与官方插件完全等价）。
- **端到端回归测试**：写入 SEO 设置 → 模拟重启 → `/robots.txt` 与 `/sitemap.xml`
  路由随之变化（覆盖 `stringList` 归一化与布尔开关对路由注册的影响）；
  另新增"清单与代码对齐"单元测试（字段名、分组与默认值全部钉死为显式期望值）。

### Changed

- **插件默认值只声明一处**：已迁移的插件移除扁平键值的旧写法 `settings`，
  默认值统一写在 `settingsSchema` 的字段 `default` 上；旧写法仍被支持，
  但仅作为既有第三方插件的兼容路径（同时写两处必然导致默认值漂移）。
- 插件版本升级：`rice.seo` / `rice.search` / `rice.comments` / `rice.media` → `1.1.0`，
  `rice.posts` → `1.3.0`，`rice.identity` → `1.2.0`，`acme.reading-time` → `1.1.0`
  （服务契约版本范围不变，仍兼容 `^1.0.0`）。
- 插件侧补充越界值收敛：`rice.posts`（`pageSize` / `excerptLength`）、
  `rice.media`（`maxFileBytes`）与 `rice.identity`（会话两项）在读取设置时
  按声明范围再收敛一次，避免历史脏值（如 `NaN`）让分页查询或体积限制失效。
- **`rice.pages` 不再注册 `header.navigation` 插槽**（版本 → `1.1.0`）：
  顶部导航栏整体交给 `rice.navigation`。页面插件保留 `navItems()` 作为
  "有哪些已发布页面"的查询入口，供导航插件解析引用目标；
  同一插槽不再有第二个写入者，避免重复链接与顺序无从协调。
- `rice.posts` → `1.4.0`（新增 `publishedRefs()` 与 `content.post.updated.v1`）、
  `rice.authorization` → `1.2.0`（新增并同步 `nav.*` 权限点）。
- 后台侧栏新增「导航栏」入口（`order: 18`，紧邻「页面」），
  图标映射补充 `Navigation` 与 `FileStack`；页面列表页文案改为引导去「导航栏」引用。

**插件页面迁出 Core（v0.4.0）**

- 8 个插件页面（文章 / 页面 / 导航栏 / 分类与标签 / 媒体库 / 评论审核 / 用户 / 角色与权限）
  从 `apps/admin/src/views/` 迁入各自插件的 `admin/main.js`；Core 后台只剩自有页面
  （仪表盘、外观中心、扩展中心、运行日志、备份恢复、个人资料、系统设置、登录）。
- 后台 SPA 不再打包 Vue / Vue Router / SDK：三者改为加载 Core 托管的同一 URL
  （开发期 `base` 为 `/`，路由基路径取 `import.meta.env.BASE_URL`）。
  **这是"宿主与插件共用一份 Vue 与一份全局状态"的前提**：插件界面因此能读到
  当前登录者与权限，提示条也渲染在宿主容器里。
- 后台 UI 组件、`api` 客户端、`cn` / `formatDateTime` 等工具从 `apps/admin` 迁入 SDK；
  `stores/{auth,toast,system}` 改为 SDK 门面（认证状态与菜单状态统一持有，不再有两份）。
- Tailwind `content` 纳入 SDK 源码与插件 `admin/` 目录，并新增**受控工具类白名单**
  （`safelist`），使运行时安装的第三方插件也能用到安全子集（不含阴影与毛玻璃类）。
- 插件不再需要 `admin:menu` 能力（声明式菜单）；官方插件的 `ctx.adminMenu.add`
  调用全部移除，改为 `manifest.admin.pages` 声明。

### Removed

- `rice.pages` 的 `navLimit` 设置项：其语义（前台导航最多展示多少项）
  已由 `rice.navigation` 的 `maxItems` 接管 —— 导航总数应由"谁拥有导航"决定，
  而不是由某个内容插件决定。库中残留的旧值不再被读取（不影响其他设置）。

### Fixed

- **导航当前项高亮对中文地址失效**：请求行里的 URL 是百分号编码的
  （`/page/%E5%85%B3%E4%BA%8E`），而导航地址来自数据库、是原始字符（`/page/关于`），
  直接字符串比较导致任何非 ASCII 地址都匹配不上、页面永远不高亮自己的导航项。
  现在路径归一化会统一解码（非法序列原样保留，不让坏 URL 影响渲染），并有单元测试钉住。
- **`ctx.config` 之前没有合并 `settingsSchema` 的默认值**：文档与后台设置表单都
  按「`settings` 默认值 → `settingsSchema` 默认值 → 数据库覆盖」描述与实现，
  但插件上下文只合并了 `manifest.settings` 与数据库覆盖，导致"后台表单显示 20、
  插件实际按代码兜底值运行"的错位。现在两侧共用同一个 `resolvePluginSettings`。

## [0.3.0] - 2026-10-11

第三个里程碑版本（架构改造）。把"页面"提升为与"文章"并列的内容形态，
并把此前只能靠人工运维完成的"重启生效"闭环收进后台：改设置 → 看到「重启」→ 一键完成。
同时补齐插件设置表单、站点与账号信息在线修改、插件 README 与扩展点文档。

### Added

**页面插件（rice.pages）与 `page` 页面类型**

- 新增官方插件 `rice.pages`（`content.pages@1`）：独立页面（标题 / 别名 / 正文 Markdown /
  状态 / 排序 / SEO 字段），公开地址 `GET /page/:slug`，自带表 `rn_pages`。
- 主题新增页面类型 `page`：`theme.json` 的 `templates.page` 提供默认模板；
  两套官方主题均新增 `page.njk`（标准）、`page-plain.njk`（落地页，无标题）、
  `page-narrow.njk`（窄栏阅读）。
- `rice.pages` 注册 `header.navigation` 插槽输出已发布页面链接（含 `aria-current` 当前态），
  两套官方主题已有该挂载点，因此**无需改动主题代码**即可出现页面导航；
  禁用插件后链接自动消失。
- 后台新增「页面」管理页（列表 + 筛选 + 抽屉式编辑 + 状态与模板选择 + 删除确认）。
- 新增权限点 `page.view` / `page.manage`，并写入 `editor` / `author` / `contributor` 内置角色。

**可供内容选择的页面模板（ADR-010）**

- 主题可在 `theme.json` 中声明 `pageTemplates`（键 → 模板文件 + 多语言 label / description），
  页面与文章编辑时即可下拉选择版式。
- 内容只保存**模板键**而非文件名：主题重命名模板文件不会让已有内容失效；
  保存时服务端校验键必须命中当前主题清单（`resolveContentTemplateKey()`），
  渲染期对失效键优雅回退到 kind 模板而不是报错。
- `rice.posts` 升级到 **1.2.0**：新增可空列 `template`（迁移 `0003_post_template.sql`），
  历史文章行为不变。
- 后台「外观中心 → 主题设置」新增"可供内容选择的页面模板"区块，列出键、文案、模板文件与说明。

**插件设置（ADR-011）**

- manifest 新增可选 `settingsSchema`：「分组 + 字段」声明式表单，**与主题设置共用同一份
  JSON Schema 定义与同一套校验/多语言实现**（`packages/shared/manifests/settings.schema.json`）。
- 旧写法 `manifest.settings` 语义不变；合并顺序为
  「`settings` 默认值 → `settingsSchema` 默认值 → 数据库覆盖」。
- 后台插件卡片新增「设置」入口：按声明自动生成表单，字段级错误提示，
  保存为**合并式写入**（只覆盖提交字段），未声明的键一律拒绝（`RN_PLUGIN_SETTING_INVALID`）。
- 保存成功后标记"待生效"，顶栏出现重启按钮（`ctx.config` 为启动期快照，ADR-004）。
- 主题与插件共用同一套表单组件 `SettingsForm.vue`，主题设置面板同步重构复用。
- `rice.pages` 作为首个使用 `settingsSchema` 的插件（`navLimit` / `listPageSize` / `cacheEnabled`）。

**站点信息与账号信息在线修改（ADR-011）**

- 新增 Core 表 `rn_site_settings` 与 `SiteSettingsProvider`：生效值 =
  `.env` 默认值 + **稀疏覆盖**（只存被后台改过的字段，清空即回落）。
- 后台「系统设置」的站点信息改为可编辑：标题、描述、语言、站点地址、
  站点 Logo / 图标（可直接上传到媒体库或填外部地址）、页脚备案号与备案链接。
- 站点信息**立即生效**：`ctx.site` 改为动态取值，渲染器实时读取，
  HTML 缓存键纳入站点 revision（无需重启）。
- 新增 `GET/PUT /api/admin/me`：查看与修改本人资料（显示名、邮箱，邮箱唯一性校验）。
- 新增后台「个人资料」页：资料区 + 密码区（改密需校验原密码，成功后其他设备会话失效）。
- identity 插件升级到 **1.1.0**：新增 `updateProfile()` 与 `resetPassword()` 服务方法，
  新增管理路由 `POST /api/admin/users/:userId/password`（管理员重置他人密码，
  刻意**拒绝重置自己**，本人改密必须走 `/me/password`），重置后强制该用户全部会话失效。
- 后台用户列表新增「重置密码」入口（二次确认；本人行显示指引文案）。
- 站点信息写入需要 `theme.manage`，字段白名单 + 长度/格式校验 + revision 乐观锁。

**待生效提示与一键重启（ADR-012）**

- 新增 Core 服务 `core.runtime@1`（`markRestartRequired` / `requestRestart` / `state` /
  `clearRestartRequired` / `registerRestartHandler`）与 `core.site@1`（同步读取生效站点信息）。
- 新增 `GET /api/admin/system/state` 与 `POST /api/admin/system/restart`（权限点 `system.restart`）。
- 新增 `ServerSupervisor`（`apps/server/src/runtime/supervisor.ts`）执行**进程内软重启**：
  先返回 202 → 关闭 HTTP（等待 in-flight）→ 关停内核 → 重新 `bootstrap` → 重新监听同一端口；
  失败时回退到诊断服务并保留错误信息，绝不静默半死。
- 重启期间新请求返回 `503 RN_RESTART_IN_PROGRESS`（带 `Retry-After`），前端据此展示
  "服务重启中"而不是网络错误。
- 待生效标记落库到 `rn_site_state`（新增 `restart_required` / `restart_reason` /
  `restart_requested_at`），跨进程重启仍可见；bootstrap 成功后自动清除并在摘要中回显原因。
- 后台顶栏在存在待生效变更时显示「待重启」按钮（柠檬黄描边 + 圆点提示 + 悬停原因），
  点击后确认弹层 → 进行中态（旋转图标 + 顶部提示条）→ 轮询等待服务恢复
  （先等健康检查通过，再等 `startedAt` 变化以确认是**新进程**）。
- 插件启停、插件包安装、插件设置保存、备份恢复均会自动标记待生效。

**启动终端输出格式化**

- 新增启动摘要横幅：版本、环境、Node、根目录、数据库（含延迟）、激活主题、
  插件状态分组、路由/服务/插槽/事件计数、监听与访问地址、启动耗时；
  失败/排除/无效插件单独列出（不静默）。
- 日志双通道：**终端默认可读格式**（时间对齐、级别着色、`key=value`，
  插件与请求 ID 前置），**日志文件始终 JSON Lines**；非 TTY 或 `LOG_FORMAT=json`
  自动降级为 JSON，`NO_COLOR` 关闭着色。

**文档与示例**

- 为全部插件补齐目录内 README（10 个官方 + 1 个第三方示例 + 新增的 `rice.pages`），
  内容包含用途、清单摘要、全部扩展点、设置项、数据表与启停影响。
- 新增 `docs/architecture/hooks-inventory.md`：**全量扩展点清单**
  （标准插槽 9 个、事件全表、服务契约全表、页面/原始/管理路由全表、后台菜单全表、
  权限点全表、能力白名单、生命周期，以及"如何用运行时接口自查文档是否过期"）。
- `docs/plugin-api/v1.md` 增补：`settingsSchema` 与插件设置接口、全部扩展点清单、
  页面类型与模板键约定、`core.site@1` / `core.runtime@1`、
  `ctx.site` 动态取值与 `ctx.config` 快照的差异。
- `docs/theme-api/v1.md` 增补：`templates.page` 与 `pageTemplates` 声明、
  `content` 上下文变量、`site.logoUrl/faviconUrl/icpText/icpUrl`、`site_url` helper、
  `json` 过滤器、以及主题侧**逐项核对用**的 Hook 清单。
- 新增 ADR-010（页面类型与可选模板）、ADR-011（运行时站点设置与插件设置）、
  ADR-012（进程内软重启），并在 ADR-004 追加修订说明（约束未变，仅执行方式变化）。

### Changed

- `ctx.site` 由启动期快照改为**动态取值**（站点信息可在不重启的前提下变更）；
  `SiteInfo` 新增可选 `logoUrl` / `faviconUrl` / `icpText` / `icpUrl`。
- 插件设置的保存语义由"整体替换"改为"**合并写入**"，局部提交不会清空其他字段。
- 插件的旧写法设置在保存时新增"键必须在声明范围内"的校验（此前接受任意键）。
- `identity` 升级到 1.1.0、`authorization` 升级到 1.1.0、`posts` 升级到 1.2.0、
  两套主题升级到 1.1.0（新增页面模板与多语言文案），README 与文档同步更新。
- `authorization` 的权限点目录新增 `page.view` / `page.manage` / `system.restart`，
  并同步到内置角色（启动时按代码重新同步）。
- 主题设置字段的 `label` / `description` 等在多语言对象写法上补充了官方主题示例
  （两套主题的设置文案全部改为 `{ "zh-CN": …, "en": … }`）。
- 后台「系统设置」文案更新：不再声称"不提供配置写入"，改为说明
  "站点信息写入数据库并覆盖 `.env`，立即生效；部署级配置仍由 `.env` 管理"。

### Fixed

- **`posts` 状态变更会清空字段**：`POST /posts/:postId/status` 复用保存流程时未回传
  封面、SEO 字段，导致"仅切换发布状态"会静默清空这些数据；现已回传完整字段
  （并新增 `PostSummary.coverMediaId` 以便无损回传）。
- 主题设置面板与插件设置面板的字段渲染重复实现，现统一为 `SettingsForm.vue`，
  避免两处校验/交互规则漂移。
- 服务端 `APP_VERSION` 硬编码为 `0.1.0`（与内核版本不一致，诊断页显示错误版本号），
  现统一从 `@ricenote/core` 复用。
- **页面变更后导航会短暂显示旧内容**：页面出现在 `header.navigation` 全局插槽中，
  而该插槽被每个页面渲染，仅按 `page:<id>` / `pages` 标签失效缓存覆盖不到其他已缓存页面。
  新增 `core.theme@1.clearCache()`，页面写入后按标签失效再整体清空缓存
  （已由 HTTP 集成测试覆盖：预热首页缓存 → 新建页面 → 首页立即出现新链接）。
- 渲染器对 `PageViewModel.template` 现在会做**模板名安全性校验**
  （必须是主题模板目录内的 `*.njk` 且不含路径分隔符），杜绝借模板名读取任意文件。
- `rn_site_settings`/`rn_site_state` 之外的站点读取路径统一走 provider，
  避免"改了数据库但页面还是旧标题"的缓存不一致。

### Security

- 站点信息写入采用**字段白名单**（`title` / `description` / `language` / `url` /
  `logoUrl` / `faviconUrl` / `icpText` / `icpUrl`），类型、长度与 URL 协议校验，
  未声明字段一律拒绝；禁止借此接口写入任意配置。
- 站点 Logo / 图标上传复用媒体库的体积与类型校验（扩展名白名单 + 随机文件名 + 路径归一化）。
- 内容所选的模板键必须命中**当前主题声明的清单**，否则拒绝保存（防止静默降级）；
  渲染期仅接受主题模板目录内的 `.njk` 文件名，不存在目录穿越可能。
- 管理员重置他人密码需要 `user.manage`，**拒绝重置自己**，重置后强制该用户全部会话失效；
  所有写入（站点信息、插件设置、重启、密码重置）均落审计。
- 重启端点需要独立的 `system.restart` 权限点，仅管理员 `*` 天然具备，避免内容编辑者中断服务。

## [0.2.0] - 2026-10-11

第二个里程碑版本，交付规划说明书的 **M4「生态稳定」**，并补齐 M3 的两项遗留增强。
至此 M0–M4 全部完成，项目达到说明书描述 v1 形态的完整范围：
"评论/搜索/SEO 插件、插件包安装、日志、备份均已落地，第三方插件与升级回归可验证"。

### Added

**评论插件（rice.comments）**

- 新增评论能力：访客评论（昵称/邮箱/网址，可与登录用户关联）、无限层嵌套回复、
  四态审核状态机（`pending` / `approved` / `spam` / `trash`）、批量审核与删除。
- 反垃圾：可配置关键词黑名单、单条链接数量上限、按来源哈希的频率限制（默认 60 秒 3 条）；
  来源 IP 只以**加盐哈希**留档，不落明文。
- 评论正文按**纯文本**处理（入库即转义、输出时仅保留换行），因此不存在用户 HTML 进入模板的路径。
- 新增 `post.comments` Slot：主题只需声明挂载点即可获得评论区；
  插件被禁用时整块自动为空，主题无需改动。
- 前台提交支持**无 JavaScript 回退**：表单直接 POST 到 `/comments/submit`，
  服务端 302 回文章页并附 `?comment=<结果>`；有脚本时改为就地反馈。
- 后台新增"互动 · 评论审核"页面：状态页签与计数、嵌套缩进展示、批量操作条、
  详情浮层（完整正文、IP 哈希、User-Agent、所属文章）；文章标题通过
  `content.posts@1` 批量解析，避免 N+1 查询。
- 新增权限点 `comment.moderate`（`editor` 与 `administrator` 默认具备）。

**搜索插件（rice.search）与 posts 全文索引**

- 新增 `content.search@1` 契约：**可搜索数据源注册表**（`registerSource` / `unregisterSource` /
  `search` / `listSources`），search 插件不感知任何具体内容类型。
- `/search` 路由与页面改由 `rice.search` 提供；`rice.posts` 移除自带路由并升级到 **1.1.0**，
  改为向 search 注册数据源。注册时机为 `core.runtime.started.v1`，停止时主动注销。
- 新增迁移 `rn_posts` 的 **ngram FULLTEXT 索引**，检索采用 `IN BOOLEAN MODE` 引号短语，
  中文可命中且拉丁词不再过匹配；关键词过短或索引缺失时自动回退 `LIKE`。
- 搜索结果做全局分页；单个数据源查询失败被隔离，不影响其他来源。
- 主题无需改动即可换用新搜索：路由名 `search`、kind `search`、
  数据字段 `keyword / posts / pagination` 均保持不变。

**SEO 插件（rice.seo）**

- 通过标准 Slot `head.end` 注入 Open Graph、Twitter Card、`robots` 指令与 JSON-LD
  结构化数据（文章页 `BlogPosting`、首页 `WebSite`、归档页 `CollectionPage`）。
- 新增公开路由 `GET /sitemap.xml`（首页 + 全部已发布文章，带 `lastmod` 与收录上限）
  与 `GET /robots.txt`（默认屏蔽 `/admin` 与 `/api` 并声明 sitemap 地址）。
- 搜索页与 404 页自动标注 `noindex,follow`；不重复输出 canonical（由主题声明），避免双 canonical。

**插件包安装（Core 扩展）**

- 新增 `installPluginFromZip()`：ZIP 上传安装**复用主题安装的安全校验实现**，
  流程为"staging 解压 → 定位插件根 → 校验清单与入口 → 复制到 `.incoming-*` → 换名"，
  任何一步失败都不留半成品目录。
- 插件包专属限额与白名单（16MB / 2000 条目 / 单文件 16MB / 解压 64MB；
  `.js .mjs .cjs .json .sql .md .txt .map`），比主题包更严格。
- 同 ID 覆盖安装即升级；目标目录被**其他插件 ID** 占用时返回 409，避免互相覆盖。
- 新增第三方插件根目录 `plugins/third-party`（`PLUGINS_INSTALL_DIR`），
  与官方目录 `plugins/official` 物理隔离；内核支持多根目录发现（`discoverPluginsFrom()`）。
- 后台"扩展中心"新增上传安装区域与安装结果回执。
- **SDK 由宿主提供**：`@ricenote/plugin-sdk` / `@ricenote/shared` / `@ricenote/theme-sdk`
  提升为仓库根依赖，使 ZIP 安装（无 `node_modules`）的第三方插件也能解析运行时接口。

**日志查看与备份恢复（Core 系统能力）**

- 新增运行日志只读接口 `GET /api/admin/logs`：级别 / 时间范围 / 关键字 / 文件过滤 + 分页；
  按文件尾部有限窗口读取，内存占用与文件大小无关；文件名经归一化校验，无法越出日志目录。
- 新增备份导出（数据库 `mysqldump` + `storage/uploads` + 插件/主题清单，流式 ZIP 下载）、
  备份包只读预览、上传恢复、快照列表 / 下载 / 删除 / 回滚。
- **恢复前自动生成当前状态快照**，把不可逆操作变为可回滚；
  恢复后返回 `restartRequired` 并清空 HTML 缓存。
- 数据库密码经临时 `--defaults-extra-file`（0600）传递，不进入命令行与日志；
  `mysqldump` / `mysql` 缺失时返回结构化 `RN_BACKUP_TOOL_MISSING`（503）而非 500。
- 新增配置项 `MYSQLDUMP_BIN` / `MYSQL_BIN`，支持 MySQL 客户端未加入 PATH 的安装方式。
- 新增权限点 `system.maintain`（仅 `administrator` 通过通配符天然具备）。
- 后台新增"运行日志"与"备份与恢复"页面；仪表盘新增评论统计（评论插件未启用时整块省略）。

**主题设置多语言与文档**

- 主题设置的 `label` / `description` / `placeholder` / `options[].label` 支持
  `{ "zh-CN": "...", "en": "..." }` 对象写法；运行时按站点语言解析
  （精确匹配 → 基础语言 → `en` → 首个非空值），后台 DTO 直接给出解析后的字符串。
- 新增 `resolveLocalizedText()`（`@ricenote/theme-sdk`）与 `theme.schema.json` 的 `localizedText` 定义。
- 新增 ADR-007（插件包安装）、ADR-008（备份范围与快照）、ADR-009（搜索与 ngram 索引）。
- 文档补充：`content.search@1` / `content.comments@1` 契约、插件包安装与升级规则、
  Slot 的"主题提供容器、插件提供内容"约定、`url()` 的降级语义、插件目录与表所有权。

**第三方示例与测试**

- 新增第三方示例插件 `plugins/third-party/reading-time`（`acme.reading-time`）：
  只声明 `slots:register` 一个能力，不依赖任何插件、不持有数据表、不注册路由，
  仅通过 `post.beforeContent` 注入阅读时长，作为第三方插件的起手模板。
- 新增单元测试：ZIP 安装器（含恶意包与升级）、日志读取器（过滤/分页/路径安全）、
  备份服务（包校验/工具缺失/快照列表）、多语言解析、共享 URL 与内联脚本安全序列化。
- 新增集成测试 `m4-features.test.ts`：九个插件的契约发布、搜索接管与中文检索、
  评论闭环与反垃圾、SEO 注入与站点地图路由、第三方插件 Slot 注入、
  插件 `1.0.0 → 1.1.0` 迁移增量应用与校验值防线、零残留断言。

### Changed

- `rice.posts` 升级至 **1.1.0**：移除 `/search` 页面路由（改由 `rice.search` 提供），
  新增对 `content.search@1` 的可搜索数据源注册，并新增 ngram 全文索引迁移。
- 配置文件新增 `paths.pluginsInstallDir`、`paths.backupsDir`、`database.dumpBinary` 与
  `database.clientBinary`；对应环境变量为 `PLUGINS_INSTALL_DIR`、`MYSQLDUMP_BIN`、`MYSQL_BIN`。
- 全部插件与主题的清单校验命令行输出现在会列出**全部**插件根目录。
- 主题设置的 `label` 等文案由"仅字符串"放宽为"字符串或语言映射"（不破坏既有主题）。
- HTTP 传输层的 multipart 上限由 8MB 提升至 128MB，各业务端点改为**自行收紧**
  （媒体 8MB、主题包 32MB、插件包 16MB、备份恢复 128MB），职责更清晰。
- 两套主题的搜索入口判断由 `has_feature('posts')` 改为 `has_feature('search')`，
  禁用搜索插件后入口整体不渲染。
- `absoluteUrl()` 与内联脚本安全序列化收敛到 `@ricenote/shared`，
  Core 改为再导出（消除与插件实现重复）。

### Fixed

- **修正 HTML 缓存键未包含查询串的缺陷**：原先缓存键仅由 canonical URL 与模板构成，
  导致 `?commentPage=2` 会命中第 1 页的缓存、`?comment=pending` 的提交结果提示无法显示。
  现在缓存键纳入规范化后的请求查询串（参数按键名排序）。
- 修正评论表单提交时的 `Location` 头缺陷：文章 slug 含中文时 Node 拒绝非 ASCII 头值，
  改为百分号编码后重定向。
- 修正"自己导出的备份无法恢复"的自相矛盾：上传目录中的点文件（`.gitkeep` 等）
  没有扩展名、会被恢复端白名单拒绝，现在打包与统计均跳过点文件。
- 修正 `absoluteUrl` 在 Core 与插件中的重复实现。
- 修正 ZIP 安装的第三方插件无法加载的问题：插件目录没有 `node_modules`，
  原先会在 `import '@ricenote/plugin-sdk'` 处抛 `ERR_MODULE_NOT_FOUND`，现由宿主提供（见上）。
- 修正后台若干界面问题：运行日志页"读取自"文件清单换行错乱、
  备份页说明文案中的 Markdown 星号被原样显示、登录页硬编码版本号（改为读取健康端点）。
- 修正开发模式下项目根目录定位错误：`pnpm dev` / `pnpm migrate` 等脚本经 pnpm 运行时
  工作目录是包目录 `apps/server`，导致 `.env`、`plugins/`、`themes/`、`storage/` 全部解析到错误位置。
  新增 `resolveRootDir()` 从工作目录向上查找工作区标记，服务端入口与 CLI 均已接入。
- 修正开发模式下管理后台 404：后台静态挂载基于 `process.cwd()` 定位 `apps/admin/dist`，
  改为基于 `config.paths.rootDir`。
- 修正模板引用未注册的**可选路由**时整页白屏的问题：`url()` 现在降级为 `#` 并告警一次，
  使"禁用 search 插件"不再影响其他页面渲染。
- posts 插件重复注册后台菜单导致的启动失败、media 插件缺少 `services:consume` 能力声明等问题
  已在此前的迭代中修复。

### Security

- 插件包安装与备份恢复**复用同一套 ZIP 安全校验**：体积与条目限额、Zip Slip、
  绝对路径、Windows 盘符、反斜杠绕过、符号链接穿越、路径归一化与扩展名白名单；
  所有校验在写入任何文件之前完成。
- 插件安装目录占用保护：目标目录被其他插件 ID 占用时拒绝安装，防止同名插件互相覆盖。
- 备份的数据库密码仅经临时凭据文件（0600）传递，用后立即删除，不进命令行与结构化日志。
- 备份包恢复前先做**只读预览**，恶意包在预览阶段即被拒绝。
- 运行日志读取做文件名归一化校验，`../` 之类的越权路径返回 `RN_LOG_PATH_UNSAFE`。
- JSON-LD 序列化统一经 `safeJsonForInlineScript()`，把 `<`、`>`、`&` 与 U+2028/U+2029
  转义为 Unicode 序列，防止 `</script>` 提前闭合造成脚本注入。
- 公开评论提交新增**同源校验**（Origin/Referer 与 Host 比对）与蜜罐字段；
  蜜罐命中时静默返回成功，不给自动化脚本任何反馈。
- 评论的回复目标由服务端按 `postId` 反查文章 slug 生成，绝不使用用户传入的跳转地址，消除开放重定向。

## [0.1.0] - 2026-10-11

首个里程碑版本，交付规划说明书的 **M0 → M2**：架构基线 + 可运行核心底座 + 内容 MVP。
达成"核心可独立启动、Hello 插件可启停、能登录/写作/发布/浏览"的退出标准。

### Added

**工程与契约基线（M0）**

- 建立 pnpm Monorepo：`apps/{server,admin}`、`packages/{core,plugin-sdk,theme-sdk,shared}`、`plugins/official/*`、`themes/*`、`tests/*`。
- 新增 `@ricenote/shared`：统一错误码、capability 契约解析、slug 工具、REST DTO、跨插件服务契约，以及插件/主题 Manifest 的 JSON Schema。
- 新增 `@ricenote/plugin-sdk`：`PluginContext`、`Plugin` 生命周期、路由/服务/事件/Slot/后台菜单门面与 `definePlugin`。
- 新增 `@ricenote/theme-sdk`：Theme Context 类型、helper 契约、模板过滤器（`css_color`/`date`/`excerpt`/`number`）与主题设置校验器（含三级配置合成）。
- 新增 `ricenote validate` CLI：无需数据库即可校验插件/主题清单，适合接入 CI。
- 新增文档：架构总览、Plugin API v1、Theme API v1，以及 ADR-001 ~ ADR-006；并在 ADR 索引中固化说明书三项待定项的默认取值。
- 新增 `CHANGELOG.md`（Keep a Changelog 1.1.0）与 Docker Compose 部署编排（MySQL 8.4 + server + Nginx，支持 `with-nginx` profile）。

**核心底座（M1）**

- 启动编排 `bootstrap()`：配置加载与 JSON Schema 校验 → 结构化日志 → 数据库探活 → 加锁迁移 → 注册表 → 安全组件 → 主题同步 → 插件启动 → 渲染器 → 运行标记。
- 数据库适配层：连接池、事务、`rn_` 表命名约束、插件作用域数据库句柄（阻断跨插件越权访问表命名空间）。
- 迁移协调器：`GET_LOCK` 全局锁 + 串行编排 + SHA-256 校验值，历史迁移被篡改时拒绝启动；插件停用不 drop 表。
- 插件管理器：目录即插件、Manifest 校验、`DISCOVERED → … → STARTED/STOPPED/DISABLED` 状态机、FAILED 独立记录、迭代剔除依赖问题插件、反向依赖阻塞禁用。
- 依赖解析器：capability 优先解析、拓扑排序（稳定排序）、循环依赖与版本冲突显式报错。
- 服务注册表 / 事件总线 / 路由注册表 / Slot 注册表 / 后台菜单注册表：全部注册 API 返回 `Dispose` 句柄，支持精确冲突检测与按插件归属的影响分析。
- 能力白名单执行：未在 `manifest.capabilities` 声明的能力调用会被明确拒绝（而非静默降级）。
- `assertNoLeaks()`：断言**已停用插件**在路由/服务/Slot/菜单/事件订阅中零残留，使"可独立启停"成为可测试承诺。
- 安全网关：会话 Cookie 边界（HttpOnly/SameSite + HMAC 签名）、CSRF 双重提交校验、能力校验 fail-closed、登录限流、审计写入 `rn_audit_logs`。
- 主题管理器与渲染器：主题发现/校验/激活/卸载、ZIP 安全安装、模板三级回退、Theme Context 构建、Slot「占位符 + 渲染后替换」（在 Nunjucks 同步模型中支持异步 Slot 与逐次调用数据）、HTML 缓存与标签失效。
- 主题设置三层模型与 revision 乐观锁（冲突返回 409）、发布历史与回滚。
- 恢复模式：无内容插件或数据库不可用时提供安装/维护界面与诊断服务，核心不崩溃。

**内容 MVP（M2）**

- `rice.identity`：用户与登录会话（scrypt 密码哈希、会话数上限、过期清理），通过 `core.security@1` 注册会话解析器（依赖倒置）。
- `rice.authorization`：角色、权限点与用户-角色分派；内置角色以代码为准每次启动同步；订阅 `identity.user.created.v1` 完成角色分派，避免与 identity 形成循环依赖。
- `rice.posts`：Markdown 写作（`marked` + 消毒）、发布/撤回/归档、首页/文章页/分类标签归档/搜索页面路由、`post.afterContent` Slot 注入。
- `rice.taxonomy`：分类与标签词条及文章关联；不注册页面路由，归档页由 posts 渲染。
- `rice.media`：上传（扩展名白名单 + 文件名随机化 + 路径归一化）、媒体元数据、`GET /media/:id` 公开访问（SVG 附加 CSP）。
- `rice.hello`：M1 启停验证示例插件（服务发布、路由、事件订阅、后台菜单）。
- 管理后台（Vue 3 + Vite + Tailwind，shadcn 风格组件）：登录、仪表盘、文章（列表 + Markdown 编辑器）、分类与标签、媒体库、用户、角色与权限、外观中心（主题卡片 + 声明式自动生成设置表单 + 预览/发布/回滚）、扩展中心（插件卡片 + 启停 + 依赖与诊断）、系统设置（站点信息 + 运行时能力 + 插槽/事件 + 审计日志）。
- 服务端 HTTP 层：Fastify 装配、公开站点 SSR、`/api/admin/*` 守卫（认证 → CSRF → 权限 → 审计）、管理后台 SPA 动态挂载与前端路由回退、主题静态资源指纹化长缓存。
- 前端主题：`rice.minimal`（极简阅读）与 `rice.default`（深色页眉 + 卡片网格），验证"同一内容切换主题不影响任何插件"。
- 测试：60 项单元与集成测试（capability 与依赖解析、渲染安全与 CSS 白名单、主题设置校验、路由冲突与 URL 生成、HTML 缓存、ZIP 安全校验、内核端到端启动与内容闭环）；其中集成测试在独立 `ricenote_test` 库上完整启动内核。

### Changed

- 主题设置字段的 `templates` 键允许以数字开头，以支持内置的 `404` 页面类型。
- `DEFAULT_THEME` 支持完整主题 ID（`rice.minimal`）与短名（`minimal`）两种写法。

### Fixed

- 修正初始管理员创建时序缺陷：原实现在 identity 插件 `start()` 中直接创建用户并发出事件，此时 authorization 插件尚未订阅，导致管理员拿不到角色。现改为订阅 `core.runtime.started.v1` 生命周期事件后执行。
- 修正可选依赖的启动顺序竞态：posts 插件原先在 `start()` 中一次性解析 taxonomy/media 服务，而拓扑排序不保证无依赖关系插件之间的先后顺序。现改为在请求期惰性解析，任一可选插件缺失或被禁用时自动降级。
- 修正 `has_feature()` 仅支持完整契约名的问题：现支持完整契约、全名与短名三种写法，并避免短名误匹配到前缀相同的其他域。
- 修正无 body 的 `POST` 在 `application/x-www-form-urlencoded` 下返回 415 的问题（动作型端点如主题激活、插件启停）。
- 修正管理后台静态挂载使用固定文件清单导致重新构建后资源 404 的问题，改为动态解析并支持 SPA 前端路由回退。
- 修正插件贡献的后台菜单指向未注册路由时 `RouterLink` 抛错导致整个后台白屏的问题；未注册路径退化为普通链接。
- 修正 media 插件缺少 `services:consume` 能力声明、posts 插件重复注册后台菜单导致的启动失败。

### Security

- 富文本统一经 `sanitizeRichText` 消毒并标记 `TrustedHtml`，仅受信句柄在模板中不转义；外链自动补 `rel="noopener noreferrer"`。
- 主题设置中的颜色强制经 `css_color` 白名单过滤器输出，阻断将任意字符串注入 `style` 的路径；未声明的设置字段一律丢弃。
- 主题 ZIP 安装实施两阶段校验（先全量校验、再落盘）：体积与条目数限额、Zip Slip、绝对路径、Windows 盘符、反斜杠绕过、符号链接穿越、扩展名白名单。
- 媒体上传实施扩展名白名单、文件名随机化与落盘路径归一化校验；SVG 响应附加严格 CSP。
- 管理 API 全链路 CSRF 校验（双重提交 Cookie + 会话绑定签名）、能力校验 fail-closed、登录失败限流，且所有管理写操作写入审计日志。
- 日志自动脱敏（`password`/`secret`/`token`/`authorization`/`cookie` 等键名替换为 `[redacted]`）。

[Unreleased]: https://github.com/ricenote/ricenote/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/ricenote/ricenote/releases/tag/v0.5.1
[0.4.0]: https://github.com/ricenote/ricenote/releases/tag/v0.4.0
[0.3.0]: https://github.com/ricenote/ricenote/releases/tag/v0.3.0
[0.2.0]: https://github.com/ricenote/ricenote/releases/tag/v0.2.0
[0.1.0]: https://github.com/ricenote/ricenote/releases/tag/v0.1.0
