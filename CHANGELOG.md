# Changelog

本项目的所有显著变更都会记录在此文件中。

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
并且本项目遵守 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [Unreleased]

### Added

- 新增 `resolveRootDir()`：从当前工作目录向上查找 `pnpm-workspace.yaml` 定位项目根目录，并在配置中暴露 `paths.rootDir`。
- 规划 M3 主题系统增强：主题设置字段的多语言（`label` 支持对象形式）与基于 JSON Schema 的 SDK 文档自动生成。

### Fixed

- 修正开发模式下项目根目录定位错误：`pnpm dev` / `pnpm migrate` 等脚本经 pnpm 运行时工作目录是包目录 `apps/server`，导致 `.env`、`plugins/`、`themes/`、`storage/` 全部解析到错误位置。现由 `resolveRootDir()` 统一解析，服务端入口与 CLI 均已接入。
- 修正开发模式下管理后台 404：静态挂载原先基于 `process.cwd()` 定位 `apps/admin/dist`，改为基于 `config.paths.rootDir`。

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

[Unreleased]: https://github.com/ricenote/ricenote/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ricenote/ricenote/releases/tag/v0.1.0
