# RiceNote 扩展点（Hook）全量清单

> 本文件是「所有可 Hook 点」的**单一事实来源**，用于核对文档是否漏项、
> 以及排查"某个插件到底往站点里插了什么"。
>
> 数据来源：逐插件读取 `manifest.json` 与 `src/*.ts` 中的注册调用。
> 运行时的**实测清单**可以通过 `GET /api/admin/capabilities`（权限 `plugin.view`）
> 或后台「系统设置 → 运行时能力 / 插槽与事件」实时查看 —— 两者应保持一致，
> 不一致即为文档过期（或存在未登记的手工注册）。

## 0. 先明确一件事：没有通用 `hooks` API

RiceNote 不存在 `ctx.hooks.register('...')` 这类通用钩子机制。
插件的全部扩展能力就是 `PluginContext` 暴露的下列面：

| 类别 | API 入口 | 数量与范围 |
| --- | --- | --- |
| 生命周期 | `definePlugin({ setup?, start, stop })` | 3 个时机，不可自定义 |
| 公开页面路由 | `ctx.routes.page(...)` | 自由注册，`name` 与 `path` 全局唯一 |
| 原始 HTTP 路由 | `ctx.routes.raw(...)` | 自由注册，路径不得与内置路由冲突 |
| 管理 API | `ctx.routes.adminApi(...)` | 挂在 `/api/admin` 下，自动套用守卫 |
| 插槽 | `ctx.slots.register(slotName, ...)` | 9 个标准插槽 + 任意自定义名字 |
| 服务契约 | `ctx.services.provide/use/tryUse` | 契约名即接口，见第 4 节 |
| 事件 | `ctx.events.on/emit` | 事件名即接口，见第 3 节 |
| 后台菜单 | `ctx.adminMenu.add(...)` | 贡献后台导航入口 |
| 插件设置 | `manifest.settings` / `manifest.settingsSchema` | 声明式表单，见第 7 节 |

权限点（`permission`）与能力白名单（`capabilities`）是上表的**约束条件**，见第 8、9 节。

---

## 1. 标准插槽（Slot）

由说明书 7.7 定义，`packages/plugin-sdk/src/slots.ts` 的 `STANDARD_SLOTS` 是实现版本。
插槽名可自定义（不限于下表），但主题只会调用它认识的那些，因此新插槽需要主题配合。

| 插槽 | 位置（主题约定） | 当前注册者 | 优先级 |
| --- | --- | --- | --- |
| `head.end` | `</head>` 之前 | `rice.seo` → `seo.meta` | 0 |
| `body.start` | `<body>` 起始 | 无 | — |
| `body.end` | `</body>` 之前 | 无 | — |
| `header.navigation` | 主导航区域 | `rice.navigation` → `navigation.header` | 20 |
| `sidebar.widgets` | 侧边栏 | 无 | — |
| `post.beforeContent` | 正文之前 | `acme.reading-time` → `acme.reading-time` | 0 |
| `post.afterContent` | 正文之后 | `rice.posts` → `posts.meta` | 10 |
| `post.comments` | 评论区 | `rice.comments` → `comments.thread` | 0 |
| `footer.widgets` | 页脚 | 无 | — |

排序规则：**priority 降序，同优先级按注册顺序**。
单组件抛错会被隔离（降级为空片段并记 error 日志），不会让整页渲染失败。
插件被禁用后其插槽条目自动消失。

---

## 2. 路由

### 2.1 公开页面路由（`ctx.routes.page`）

| 插件 | name | path | kind | 模板覆盖 | HTML 缓存 |
| --- | --- | --- | --- | --- | --- |
| `rice.posts` | `home` | `/` | `home` | — | 是 |
| `rice.posts` | `post.show` | `/post/:slug` | `post` | 内容可选模板键 | 是 |
| `rice.posts` | `term.category` | `/category/:slug` | `archive` | — | 是 |
| `rice.posts` | `term.tag` | `/tag/:slug` | `archive` | — | 是 |
| `rice.pages` | `page.show` | `/page/:slug` | `page` | 内容可选模板键 | 由插件设置控制 |
| `rice.search` | `search` | `/search` | `search` | — | **否**（结果随关键词变化） |

`name` 供主题的 `url('name', params)` 使用；`kind` 决定主题模板；`template` 见
`docs/plugin-api/v1.md` 第 14 节。

### 2.2 原始 HTTP 路由（`ctx.routes.raw`）

| 插件 | 方法 | 路径 | capability | 说明 |
| --- | --- | --- | --- | --- |
| `rice.hello` | GET | `/hello` | 默认（public） | 示例 JSON 接口 |
| `rice.media` | GET | `/media/:mediaId` | 默认（public） | 文件回传 |
| `rice.comments` | POST | `/comments/submit` | 默认（public） | 访客提交评论（支持无 JS 表单，302 回文章页） |
| `rice.comments` | GET | `/api/comments` | 默认（public） | 按 `postId` 读取已通过评论 |
| `rice.seo` | GET | `/sitemap.xml` | 默认（public） | 受 `settings.enableSitemap` 控制 |
| `rice.seo` | GET | `/robots.txt` | 默认（public） | 受 `settings.enableRobots` 控制 |

### 2.3 管理 API（`ctx.routes.adminApi`，挂载前缀 `/api/admin`）

| 插件 | 方法 | 路径 | 权限点 |
| --- | --- | --- | --- |
| `rice.identity` | GET | `/users` | `user.manage` |
| `rice.identity` | POST | `/users` | `user.manage` |
| `rice.identity` | POST | `/users/:userId/password` | `user.manage` |
| `rice.identity` | POST | `/me/password` | 仅登录 |
| `rice.authorization` | GET | `/roles` | `user.manage` |
| `rice.authorization` | GET | `/permissions` | `user.manage` |
| `rice.authorization` | POST | `/users/:userId/roles` | `user.manage` |
| `rice.authorization` | DELETE | `/users/:userId/roles/:role` | `user.manage` |
| `rice.posts` | GET | `/posts` | `post.view` |
| `rice.posts` | GET | `/posts/:postId` | `post.view` |
| `rice.posts` | GET | `/posts/stats` | `post.view` |
| `rice.posts` | POST | `/posts` | `post.write` |
| `rice.posts` | PUT | `/posts/:postId` | `post.write` |
| `rice.posts` | POST | `/posts/:postId/status` | `post.publish` |
| `rice.posts` | DELETE | `/posts/:postId` | `post.delete` |
| `rice.pages` | GET | `/pages` | `page.view` |
| `rice.pages` | GET | `/pages/:pageId` | `page.view` |
| `rice.pages` | POST | `/pages` | `page.manage` |
| `rice.pages` | PUT | `/pages/:pageId` | `page.manage` |
| `rice.pages` | DELETE | `/pages/:pageId` | `page.manage` |
| `rice.navigation` | GET | `/navigation/items` | `nav.view` |
| `rice.navigation` | GET | `/navigation/targets` | `nav.view` |
| `rice.navigation` | POST | `/navigation/items` | `nav.manage` |
| `rice.navigation` | PUT | `/navigation/items/:itemId` | `nav.manage` |
| `rice.navigation` | POST | `/navigation/items/:itemId/move` | `nav.manage` |
| `rice.navigation` | DELETE | `/navigation/items/:itemId` | `nav.manage` |
| `rice.taxonomy` | GET | `/terms` | `post.view` |
| `rice.taxonomy` | POST | `/terms` | `taxonomy.manage` |
| `rice.taxonomy` | DELETE | `/terms/:termId` | `taxonomy.manage` |
| `rice.media` | GET | `/media` | `media.manage` |
| `rice.media` | POST | `/media` | `media.manage` |
| `rice.media` | DELETE | `/media/:mediaId` | `media.manage` |
| `rice.comments` | GET | `/comments` | `comment.moderate` |
| `rice.comments` | GET | `/comments/counts` | `comment.moderate` |
| `rice.comments` | POST | `/comments/moderate` | `comment.moderate` |

### 2.4 Core 自有的管理 API（不属于插件，供对照）

`/dashboard`、`/menu`、`/site`（GET/PUT，写需 `theme.manage`）、`/audit`（`system.audit`）、
`/capabilities`（`plugin.view`）、`/me`（GET/PUT，仅登录）、
`/themes*`、`/plugins*`、`/logs`（`system.maintain`）、`/backup*`（`system.maintain`）、
`/system/state`（仅登录）、`/system/restart`（`system.restart`）。

---

## 3. 事件

命名约定：`<域>.<实体>.<动作>.v<主版本>`；事件总线**不保证持久性**。

| 事件 | 发布者 | 订阅者 | 用途 |
| --- | --- | --- | --- |
| `core.runtime.started.v1` | **Core** | `rice.identity`、`rice.posts`、`rice.pages`、`rice.navigation`、`rice.search` | 全部插件启动完成后的初始化时机 |
| `core.hello.ping.v1` | 外部触发（示例） | `rice.hello` | 演示事件通道 |
| `identity.user.created.v1` | `rice.identity` | `rice.authorization`（priority 10） | 新用户自动分派角色 |
| `identity.session.created.v1` | `rice.identity` | 无 | 登录审计扩展点 |
| `identity.user.password.changed.v1` | `rice.identity` | 无 | 改密/重置（重置时带 `byAdmin: true`） |
| `identity.user.profile.updated.v1` | `rice.identity` | 无 | 资料修改 |
| `identity.authorization.role.assigned.v1` | `rice.authorization` | 无 | 角色分派 |
| `identity.authorization.role.revoked.v1` | `rice.authorization` | 无 | 角色回收 |
| `identity.authorization.bootstrap.completed.v1` | `rice.authorization` | 无 | 内置角色同步完成 |
| `content.post.published.v1` | `rice.posts` | `rice.navigation`（仅当该文章被导航引用） | 由非发布态转发布 |
| `content.post.updated.v1` | `rice.posts` | `rice.navigation`（仅当该文章被导航引用） | 更新既有文章（标题 / 别名变更也在此广播） |
| `content.post.unpublished.v1` | `rice.posts` | `rice.navigation`（仅当该文章被导航引用） | 由发布态转非发布 |
| `content.post.deleted.v1` | `rice.posts` | `rice.navigation`（仅当该文章被导航引用） | 文章删除 |
| `content.pages.changed.v1` | `rice.pages` | `rice.navigation`（仅当该页面被导航引用） | 页面新建/更新 |
| `content.pages.deleted.v1` | `rice.pages` | `rice.navigation`（仅当该页面被导航引用） | 页面删除 |

> `rice.navigation` 订阅内容事件的目的只有一个：判断"变了的内容是否被导航引用"，
> 是则清空 HTML 缓存（导航栏出现在每个页面上，按标签失效覆盖不到）。
> 未被引用的内容变化不会触发任何缓存操作。

> `rice.pages` 同时订阅 `core.runtime.started.v1`，因此它的能力声明里必须同时有
> `events:publish` 与 `events:subscribe` —— 少声明一个不会静默降级，
> 而是启动时直接抛 `RN_FORBIDDEN`（能力白名单是硬约束）。

不发布任何事件的插件：`rice.media`、`rice.taxonomy`、`rice.comments`、`rice.seo`、`rice.search`。
订阅 `core.runtime.started.v1` 是本仓最常用的启动后钩子（见 `docs/plugin-api/v1.md` 6.1）。

---

## 4. 服务契约

### 4.1 Core 提供

| 契约 | 方法 | 消费方 |
| --- | --- | --- |
| `core.security@1` | `registerSessionResolver` / `registerAuthorizationResolver` | `rice.identity`、`rice.authorization` |
| `core.theme@1` | `activeThemeId` / `settings` / `pageTemplates` / `invalidate` / `clearCache` | `rice.posts`、`rice.pages`、`rice.comments`、`rice.seo`、`rice.navigation` |
| `core.html@1` | `sanitize` / `markTrusted` / `escape` | `rice.posts`、`rice.pages`、`rice.comments`、`rice.seo`、`rice.navigation` |
| `core.setup@1` | `siteId` / `bootstrapAdmin` / `paths` | `rice.identity`、`rice.media`、`rice.taxonomy`、`rice.posts`、`rice.pages`、`rice.navigation` |
| `core.site@1` | `info()`（生效站点信息，同步） | 保留给第三方插件（官方插件经 `ctx.site` 使用） |
| `core.runtime@1` | `markRestartRequired` / `requestRestart` / `state` / `clearRestartRequired` / `registerRestartHandler` | 保留给需要"重启生效"语义的插件 |

### 4.2 插件提供

| 契约 | 提供者 | 消费方（必需 / 可选） |
| --- | --- | --- |
| `identity.auth@1` | `rice.identity` | `core.security` 的解析器注册（必需） |
| `identity.users@1` | `rice.identity` | `rice.posts`（**requires 硬依赖**）、`rice.authorization`（**requires 硬依赖**）、`rice.comments`（可选） |
| `identity.authorization@1` | `rice.authorization` | `rice.identity`（可选）、`rice.posts`（可选） |
| `content.posts@1` | `rice.posts` | `rice.comments`（可选）、`rice.seo`（可选）、`rice.navigation`（可选） |
| `content.pages@1` | `rice.pages` | `rice.navigation`（可选）、供第三方与后台仪表盘使用 |
| `content.navigation@1` | `rice.navigation` | 暂无（`header.navigation` 插槽是主要消费方，契约供主题/第三方自行渲染） |
| `content.taxonomy@1` | `rice.taxonomy` | `rice.posts`（可选） |
| `taxonomy.internal@1` | `rice.taxonomy` | `rice.posts`（可选，官方插件间约定） |
| `media.library@1` | `rice.media` | `rice.posts`（可选）、后台站点设置（Logo 上传） |
| `content.search@1` | `rice.search` | `rice.posts`（可选，注册可搜索数据源） |
| `content.comments@1` | `rice.comments` | 后台仪表盘（可选） |
| `demo.hello@1` | `rice.hello` | 示例 |

> 只有"没有它就无法工作"的依赖才写进 `requires`。
> 目前仅 `rice.authorization` 与 `rice.posts` 声明了 `requires`（都是 `identity.users@1`）。

---

## 5. 后台菜单

| 菜单项 id | label | path | icon | order | permission | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `demo.hello` | Hello 示例 | `/hello` | `Sparkles` | -10 | `plugin.view` | `rice.hello` |
| `media.library` | 媒体库 | `/media` | `Image` | 10 | `media.manage` | `rice.media` |
| `pages.list` | 页面 | `/pages` | `FileStack` | 15 | `page.view` | `rice.pages` |
| `navigation.items` | 导航栏 | `/navigation` | `Navigation` | 18 | `nav.view` | `rice.navigation` |
| `taxonomy.terms` | 分类与标签 | `/taxonomy` | `Tags` | 15 | `post.view` | `rice.taxonomy` |
| `users.roles` | 角色与权限 | `/roles` | `ShieldCheck` | 20 | `user.manage` | `rice.authorization` |
| `comments.moderate` | 评论审核 | `/comments` | `MessageSquare` | 20 | `comment.moderate` | `rice.comments` |
| `users.list` | 用户 | `/users` | `Users` | 30 | `user.manage` | `rice.identity` |
| `posts.list` | 文章 | `/posts` | `FileText` | 50 | `post.view` | `rice.posts` |

Core 固定入口（不来自插件）：仪表盘 `/`、外观中心 `/themes`、扩展中心 `/plugins`、
运行日志 `/logs`、备份与恢复 `/backup`、系统设置 `/settings`；个人资料 `/profile` 位于右上角用户菜单。

---

## 6. 主题侧扩展点

主题的完整扩展点清单见 `docs/theme-api/v1.md` 第 13 节（模板文件、清单字段、kind、
上下文变量、helper、过滤器、标准插槽、设置字段类型与属性、多语言文案位置、静态资源）。
摘要：

- 上下文变量：`site`、`page`、`theme`、`viewer`、`post`、`posts`、`content`、`pagination`、`seoDescription`
- Helper：`theme_asset`、`url`、`slot`、`has_feature`、`site_url`
- 过滤器：`css_color`、`date`、`excerpt`、`number`、`json`
- 页面类型（kind）：`home`、`post`、`page`、`archive`、`search`、`404`
- 声明式差异化：`templates[kind]`、`pageTemplates`（供页面/文章选择）、`settings`

---

## 7. 插件设置声明

| 写法 | 字段 | 校验 | 后台表现 |
| --- | --- | --- | --- |
| 旧（仅兼容） | `manifest.settings`（扁平键值） | 键必须在声明范围内 | 只读键值预览 |
| 新（推荐，**全部官方插件已迁移**） | `manifest.settingsSchema`（分组 + 字段） | 类型 / `min` / `max` / `maxLength` / `maxItems` / 枚举 / URL 格式 | 自动生成表单，可编辑 |

字段类型：`text`、`textarea`、`color`、`boolean`、`number`、`select`、`image`、`url`、`stringList`
（`stringList` 的值为 `string[]`，后台表现为"每行一项"）。

当前使用情况（后台入口：扩展中心 → 对应插件 → 设置）：

| 插件 | 分组 | 字段 |
| --- | --- | --- |
| `rice.seo` | `social`、`crawler` | `enableOpenGraph`、`enableTwitterCard`、`twitterSite`、`defaultOgImage`、`enableJsonLd`、`enableSitemap`、`enableRobots`、`sitemapMaxUrls`、`sitemapPageSize`、`robotsDisallow`(**stringList**) |
| `rice.comments` | `general`、`antispam` | `enabled`、`requireApproval`、`pageSize`、`maxLength`、`maxDepth`、`rateLimitWindowSeconds`、`rateLimitMaxSubmissions`、`maxLinksPerComment`、`blockedKeywords`(**stringList**) |
| `rice.posts` | `general` | `pageSize`、`excerptLength` |
| `rice.pages` | `general` | `listPageSize`、`cacheEnabled` |
| `rice.navigation` | `general` | `maxItems` |
| `rice.search` | `general` | `resultPageSize`、`maxKeywordLength`、`maxItemsPerSource` |
| `rice.identity` | `session` | `sessionTtlSeconds`、`maxSessionsPerUser` |
| `rice.media` | `upload` | `maxFileBytes` |
| `acme.reading-time`（第三方） | `display` | `wordsPerMinute`、`showWordCount`、`label` |
| `rice.authorization`、`rice.taxonomy`、`rice.hello` | 无 | 无可配置项，后台不显示设置入口 |

设置生效时机：`ctx.config` 是**插件启动期快照**，因此保存后需重启（ADR-004 / ADR-012）。
校验与合并由 `packages/core/src/plugins/settings-schema.ts` 统一提供，
后台表单与 `ctx.config` 使用同一个合并函数，不会出现"显示值与实际值不一致"。

---

## 8. 能力白名单（capabilities）

插件必须在 manifest 中声明它要用的能力，否则对应 `ctx.*` 调用会抛 `RN_FORBIDDEN`：

`routes:public`、`routes:admin`、`database:own`、`events:publish`、`events:subscribe`、
`services:provide`、`services:consume`、`slots:register`、`admin:menu`、`media:store`。

---

## 9. 权限点

| 权限点 | 含义 | 使用它的位置 |
| --- | --- | --- |
| `post.view` | 查看文章 | posts 后台列表、taxonomy 词条读取、后台菜单 |
| `post.write` | 撰写与编辑文章 | posts 保存 |
| `post.publish` | 发布与撤回文章 | posts 状态切换 |
| `post.delete` | 删除文章 | posts 删除 |
| `page.view` | 查看页面 | pages 列表与详情、后台菜单 |
| `page.manage` | 管理独立页面 | pages 增删改 |
| `nav.view` | 查看导航栏 | 导航项列表、目标候选、后台菜单 |
| `nav.manage` | 管理导航栏 | 导航项增删改与排序 |
| `taxonomy.manage` | 管理分类与标签 | taxonomy 增删 |
| `media.manage` | 管理媒体库 | media 上传/删除 |
| `comment.moderate` | 审核与管理评论 | comments 后台 |
| `theme.view` | 查看主题 | 外观中心、`/api/admin/themes` |
| `theme.manage` | 管理主题与设置 | 主题激活/设置/安装，**站点信息写入** |
| `plugin.view` | 查看插件 | 扩展中心、能力清单 |
| `plugin.manage` | 启用与配置插件 | 插件启停/安装/**设置保存** |
| `user.manage` | 管理用户与角色 | identity 用户管理、authorization 角色 |
| `system.audit` | 查看审计日志 | `/api/admin/audit` |
| `system.maintain` | 系统维护（日志与备份恢复） | `/logs`、`/backup*` |
| `system.restart` | 重启服务 | `/api/admin/system/restart` |

`*` 表示全部权限（内置 `administrator` 角色）。
前端权限仅用于**界面门控**；鉴权始终在服务端守卫中执行（fail-closed）。

---

## 10. 生命周期与状态机

```
DISCOVERED → VALIDATED → INSTALLED → ENABLED → STARTED → STOPPED / DISABLED
                                                     ↘ FAILED（独立记录，不阻塞其他插件）
```

| 时机 | 钩子 | 允许做什么 |
| --- | --- | --- |
| 安装 | `setup(ctx)` | 注册迁移、准备静态资源、读配置。**不得注册路由** |
| 启用 | `start(ctx)` | 注册路由、服务、插槽、菜单，订阅事件 |
| 停用 | `stop(ctx)` | 可主动注销句柄（未注销由 Core 兜底）；停用后必须**零残留** |

启停与设置变更遵循**受控重启**语义（ADR-004）：写库后需重启进程生效；
后台提供一键软重启（ADR-012），顶栏会出现「重启」按钮。

---

## 11. 如何自查"清单是否过期"

1. 启动服务，用管理员登录后台；
2. 打开「系统设置」→ 查看「运行时能力」「插槽与事件」两块，或直接请求
   `GET /api/admin/capabilities`；
3. 把返回的 `capabilities` / `services` / `events` / `slots` / `routes.pages` /
   `routes.admin` / `routes.raw` 与本文件逐项对照；
4. 差异分为两类：
   - **文档缺项** → 更新本文件；
   - **代码里有未登记的注册** → 说明某个插件没走 `ctx.*`（例如直接改了 Core），属于需要修复的问题。
