# Changelog

本项目的所有显著变更都会记录在此文件中。

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
并且本项目遵守 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/ricenote/ricenote/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ricenote/ricenote/releases/tag/v0.3.0
[0.2.0]: https://github.com/ricenote/ricenote/releases/tag/v0.2.0
[0.1.0]: https://github.com/ricenote/ricenote/releases/tag/v0.1.0
