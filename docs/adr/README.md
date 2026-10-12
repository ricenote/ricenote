# 架构决策记录（ADR）索引

本目录记录 RiceNote 的关键架构决策。每条 ADR 一经接受即冻结，变更需新增 ADR 而非改写历史。

| 编号 | 标题 | 状态 |
| --- | --- | --- |
| [ADR-001](ADR-001-modular-monolith.md) | v1 采用模块化单体，而非微服务 | 已接受 |
| [ADR-002](ADR-002-nunjucks-ssr-themes.md) | 主题仅使用 Nunjucks + CSS/JS，前台默认 SSR | 已接受 |
| [ADR-003](ADR-003-declarative-theme-settings.md) | 主题设置采用 Manifest 声明式表单，保存与预览分离 | 已接受 |
| [ADR-004](ADR-004-controlled-restart.md) | 插件启停采用受控重启，不支持路由热卸载 | 已接受 |
| [ADR-005](ADR-005-security-control-plane-in-core.md) | 管理安全控制面保留在 Core，用户/权限业务仍为插件 | 已接受 |
| [ADR-006](ADR-006-admin-ui-shadcn-vue.md) | 管理后台 UI 采用 shadcn-vue | 已接受 |
| [ADR-007](ADR-007-plugin-package-install.md) | 插件包采用 ZIP 上传 + 两阶段安全校验安装 | 已接受 |
| [ADR-008](ADR-008-backup-restore-scope.md) | 备份覆盖数据库/文件/清单，恢复前自动快照 | 已接受 |
| [ADR-009](ADR-009-search-fulltext-ngram.md) | 搜索独立成插件并采用 ngram FULLTEXT 布尔短语 | 已接受 |
| [ADR-010](ADR-010-page-type-and-selectable-templates.md) | 新增 `page` 页面类型，主题声明可供内容选择的页面模板 | 已接受 |
| [ADR-011](ADR-011-runtime-site-settings-and-plugin-settings.md) | 站点信息运行时覆盖生效；插件设置声明式表单 + 重启生效 | 已接受 |
| [ADR-012](ADR-012-in-process-soft-restart.md) | 后台一键重启采用进程内软重启（修订 ADR-004 的执行方式） | 已接受 |
| [ADR-013](ADR-013-navigation-ownership.md) | 顶部导航栏由独立插件 `rice.navigation` 拥有，导航项只引用内容 ID | 已接受 |
| [ADR-014](ADR-014-plugin-owned-admin-ui.md) | 插件自带后台界面 + 后台界面 SDK（零构建、动态挂载、单 Vue 实例） | 已接受 |
| [ADR-015](ADR-015-plugin-sources-and-install-orchestration.md) | 插件三路来源（npm/Git/本地）、三段式安装编排与任务队列（修订 ADR-007） | 已接受 |
| [ADR-016](ADR-016-official-plugin-npm-distribution.md) | 官方插件 npm 分发、推荐清单与 `ricenote setup` 安装向导 | 已接受 |
| [ADR-017](ADR-017-named-extension-points.md) | 命名扩展点（三作用域统一模型）与内容自定义字段 | 已接受 |

## 说明书「待定项」的默认取值（M0–M2 实现依据）

原规划说明书第 13 章留下三项待定，实现期按以下取值落地，避免阻塞：

1. **依赖版本锁定**
   - Node.js：`>= 20.11`（开发机实测 22.23.x）
   - TypeScript：`^5.7`
   - Fastify：`^5`
   - MySQL：`8.x`（开发机 MySQL 8.0.45；Compose 镜像使用 `mysql:8.4`）
   - Drizzle ORM：`^0.38`
   - Nunjucks：`^3.2`
   - Vue / Vite：`^3.5` / `^5`
   - Tailwind CSS：`3.4.17`
   - 正式发布前需在本文档中补记锁定的精确版本与校验和。

2. **是否支持多站点**
   - v1 **单站点**，站点标识固定为 `default`。
   - 但 `rn_site_state`、`rn_theme_settings`、`rn_posts` 等表均保留 `site_id` 字段作为扩展点，
     且所有 Core 服务以 `siteId` 作为显式参数，为后续多站点留出升级路径。

3. **主题设置字段的 i18n 与 SDK 文档自动生成**（M4 已落地）
   - 字段 `label` / `description` / `placeholder` / `options[].label` 支持两种写法：
     字符串（等价于单语言）或 `{ "zh-CN": "...", "en": "..." }` 对象。
   - 运行时按站点语言解析：精确匹配 → 基础语言（`zh-CN` → `zh`）→ `en` → 首个非空值；
     实体是 `resolveLocalizedText()`（`@ricenote/theme-sdk`），后台拿到的 DTO 已是解析后的字符串。
   - `packages/shared/manifests/*.schema.json` 是字段说明的唯一事实来源；
     SDK 文档（`docs/plugin-api`、`docs/theme-api`）随实现同步维护。

## 里程碑新增决策

M4「生态稳定」在既有分层上做**插件式能力扩展 + Core 系统能力补全**，未改变架构范式：

- ADR-007：插件包安装（ZIP 上传 + 两阶段校验，与主题安装同构）
- ADR-008：备份与恢复范围（数据库 + 文件 + 清单，恢复前自动快照）
- ADR-009：搜索独立成插件并采用 ngram FULLTEXT（布尔短语 + LIKE 降级）

v0.3.0「架构改造」把"页面"提升为与"文章"并列的内容形态，并补齐配置与运维闭环：

- ADR-010：新增 `page` 页面类型 + 主题声明可选模板清单（内容只存模板键）
- ADR-011：站点信息改为"DB 稀疏覆盖 `.env` 并实时生效"；插件设置升级为声明式表单，
  因 `ctx.config` 仍是启动期快照，保存后显式标记"待重启"
- ADR-012：把"重启"从人工运维改为后台一键的进程内软重启，并统一待重启状态的呈现

导航栏与"内容"的边界也在此阶段划清（`rice.navigation` 之前的版本由页面插件兼管导航）：

- ADR-013：导航栏归独立插件独占（单一写入者），导航项只引用内容 ID，
  引用解析失败时前台跳过、后台提示；v1 只做一级导航

v0.4.0「插件平台化」进一步把**后台界面**交还给插件，并重写插件安装方式：

- ADR-014：插件自带后台界面（`admin/main.js` 零构建）+ 后台界面 SDK；
  Core 只提供通用宿主与托管，宿主与插件共用同一份 Vue/SDK 实例
- ADR-015：插件安装从"ZIP 上传"扩展为 npm Registry / Git 仓库 / 本地目录三路来源，
  统一 `resolve → prepare → commit` 编排（失败必回滚）+ 任务队列与实时日志；
  ZIP 降级为本地来源的一种入口（修订 ADR-007 的白名单与"非目标"口径）

v0.5.0「安装与分发」把安装过程与官方插件分发一起收口：官方插件改为独立 npm 包，
装什么、装哪个版本由**推荐清单**统一掌握，全新部署由一条 `pnpm run setup` 完成。

- ADR-016：官方插件 npm 分发（`@ricenote/plugin-*`）+ 推荐插件清单作为唯一事实来源；
  `builtin`（随仓库分发，不可卸载）与 `official`（属于官方目录，可更新可卸载）分离；
  新增 `ricenote setup` 安装向导（自动建库、随机密钥、勾选安装、首次初始化）与
  `RICENOTE_PLUGINS` 声明式清单（启动期只核对不安装）

在此基础上，"插件能被扩展"从"只能往站点渲染塞片段"推广为**三作用域的命名扩展点**，
并让主题可以声明**内容自定义字段**：

- ADR-017：一套注册表覆盖 `render` / `admin` / `server` 三个作用域，支持声明式贡献与 `replace` 接管
  （`replaceable: false` 只约束第三方、不约束提供方自身）；旧 `ctx.slots.register` 退化为 render 作用域别名，
  主题与既有插件零改动；admin 作用域由服务端三重过滤下发、由后台界面 SDK 渲染（错误隔离、样式引用计数、加载重试）；
  server 作用域默认响亮失败（abort），与 render 作用域的"降级为空片段"刻意相反；
  主题 `contentFields` 让文章与页面共用的版式字段（如特色图片）有声明式位置，写入 fail-closed、读取按声明过滤
