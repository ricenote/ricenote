# 架构决策记录索引

RiceNote 用 ADR 记录关键架构决策。**每条 ADR 一经接受即冻结** —— 变更要新增 ADR，而不是改写历史
（例如 ADR-015 修订了 ADR-007，ADR-012 修订了 ADR-004 的执行方式）。

原始文档：[docs/adr/](https://github.com/ricenote/ricenote/tree/main/docs/adr)

---

## 决策清单

| 编号 | 标题 | 状态 |
| --- | --- | --- |
| [ADR-001](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-001-modular-monolith.md) | v1 采用模块化单体，而非微服务 | 已接受 |
| [ADR-002](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-002-nunjucks-ssr-themes.md) | 主题仅使用 Nunjucks + CSS/JS，前台默认 SSR | 已接受 |
| [ADR-003](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-003-declarative-theme-settings.md) | 主题设置采用 Manifest 声明式表单，保存与预览分离 | 已接受 |
| [ADR-004](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-004-controlled-restart.md) | 插件启停采用受控重启，不支持路由热卸载 | 已接受 |
| [ADR-005](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-005-security-control-plane-in-core.md) | 管理安全控制面保留在 Core，用户/权限业务仍为插件 | 已接受 |
| [ADR-006](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-006-admin-ui-shadcn-vue.md) | 管理后台 UI 采用 shadcn-vue | 已接受 |
| [ADR-007](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-007-plugin-package-install.md) | 插件包采用 ZIP 上传 + 两阶段安全校验安装 | 已接受 |
| [ADR-008](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-008-backup-restore-scope.md) | 备份覆盖数据库/文件/清单，恢复前自动快照 | 已接受 |
| [ADR-009](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-009-search-fulltext-ngram.md) | 搜索独立成插件并采用 ngram FULLTEXT 布尔短语 | 已接受 |
| [ADR-010](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-010-page-type-and-selectable-templates.md) | 新增 `page` 页面类型，主题声明可供内容选择的页面模板 | 已接受 |
| [ADR-011](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-011-runtime-site-settings-and-plugin-settings.md) | 站点信息运行时覆盖生效；插件设置声明式表单 + 重启生效 | 已接受 |
| [ADR-012](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-012-in-process-soft-restart.md) | 后台一键重启采用进程内软重启（修订 ADR-004 的执行方式） | 已接受 |
| [ADR-013](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-013-navigation-ownership.md) | 顶部导航栏由独立插件 `rice.navigation` 拥有，导航项只引用内容 ID | 已接受 |
| [ADR-014](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-014-plugin-owned-admin-ui.md) | 插件自带后台界面 + 后台界面 SDK（零构建、动态挂载、单 Vue 实例） | 已接受 |
| [ADR-015](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-015-plugin-sources-and-install-orchestration.md) | 插件三路来源（npm/Git/本地）、三段式安装编排与任务队列（修订 ADR-007） | 已接受 |
| [ADR-016](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-016-official-plugin-npm-distribution.md) | 官方插件 npm 分发、推荐清单与 `ricenote setup` 安装向导 | 已接受 |
| [ADR-017](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-017-named-extension-points.md) | 命名扩展点（三作用域统一模型）与内容自定义字段 | 已接受 |

---

## 按主题分组阅读

| 你想理解 | 读这些 |
| --- | --- |
| 为什么是单体、为什么 SSR | ADR-001、ADR-002 |
| 插件怎么组织、怎么启停 | ADR-004、ADR-012 |
| 安全边界为什么在 Core | ADR-005 |
| 后台界面为什么是 shadcn-vue | ADR-006 |
| 插件如何安装与分发 | ADR-007、ADR-015、ADR-016 |
| 内容模型（页面、版式、导航、字段） | ADR-010、ADR-013、ADR-017 |
| 设置与配置的时效性 | ADR-003、ADR-011 |
| 备份与搜索 | ADR-008、ADR-009 |
| 插件自带后台界面 | ADR-014、ADR-017 |

---

## 说明书"待定项"的默认取值

规划说明书第 13 章留下三项待定，实现期按以下取值落地：

### 1. 依赖版本锁定

| 依赖 | 取值 |
| --- | --- |
| Node.js | `>= 20.11` |
| TypeScript | `^5.7` |
| Fastify | `^5` |
| MySQL | `8.x`（开发机 8.0.45；Compose 镜像 `mysql:8.4`） |
| Drizzle ORM | `^0.38` |
| Nunjucks | `^3.2` |
| Vue / Vite | `^3.5` / `^5` |
| Tailwind CSS | `3.4.17` |

> 正式发布前需在原始文档中补记锁定的精确版本与校验和。

### 2. 是否支持多站点

v1 **单站点**，站点标识固定为 `default`。但 `rn_site_state`、`rn_theme_settings`、`rn_posts` 等表
均保留 `site_id` 字段作为扩展点，且 Core 服务以 `siteId` 为显式参数，为后续多站点留出升级路径。

### 3. 主题设置字段的 i18n 与 SDK 文档自动生成

已落地：字段文案支持字符串或 `{ "zh-CN": ..., "en": ... }`；
解析函数 `resolveLocalizedText()`（`@ricenote/theme-sdk`）；
`packages/shared/manifests/*.schema.json` 是字段说明的**唯一事实来源**。

---

## 与 wiki 其它页面的对应

| ADR | 对应 wiki 页 |
| --- | --- |
| ADR-004 / ADR-012 | [[启动时序\|Development/Architecture/Core-Bootstrap]] |
| ADR-005 | [[安全控制面\|Development/Architecture/Security]] |
| ADR-007 / ADR-015 / ADR-016 | [[插件安装与更新\|Plugins/Install-and-Update]] |
| ADR-010 / ADR-017 | [[主题契约\|Development/Theme-API/Overview]] |
| ADR-011 | [[环境变量参考\|Configuration]] |
| ADR-013 | [[服务契约\|Development/Plugin-API/Service-Contracts]]（导航插件） |
| ADR-014 | [[插件自带后台界面\|Development/Plugin-API/Admin-UI]] |
| ADR-017 | [[命名扩展点注册表\|Development/Architecture/Extension-Registry]] |

---

## 新增 ADR 的约定

1. 文件命名：`ADR-0NN-短横线小写标题.md`；
2. 结构：**背景 / 决策 / 取舍 / 后果**（对既有决策的修订要显式写明"修订了 ADR-XXX 的哪一点"）；
3. 同步更新 `docs/adr/README.md` 的索引表；
4. 不要修改已接受的 ADR 正文 —— 新增一条并交叉引用。

---

## 相关页面

- [[分层与数据所有权|Development/Architecture/Overview]]
- [[扩展点全量清单|Development/Hooks-Inventory]]
- [docs/architecture/hooks-inventory.md](https://github.com/ricenote/ricenote/blob/main/docs/architecture/hooks-inventory.md)
