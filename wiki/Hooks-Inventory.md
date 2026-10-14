# 扩展点全量清单

一页查完所有可扩展的位置。**每一条都对应代码中的实际实现**，并给出"谁提供、谁消费"。

> 先澄清一件事：**没有通用的 `hooks` API**。RiceNote 把扩展点分成五类，
> 每类有明确的语义与所有权，而不是一个万能钩子表。

---

## 1. 渲染插槽（render 作用域）

9 个标准插槽，由 Core 预声明：

| 插槽 | 位置 | 当前消费者 |
| --- | --- | --- |
| `head.end` | `</head>` 前 | `rice.seo`（OG / Twitter / JSON-LD / robots）、`rice.feed`（订阅自动发现链接） |
| `body.start` | `<body>` 开始 | —— |
| `body.end` | `</body>` 前 | —— |
| `header.navigation` | 页眉 | `rice.navigation` |
| `sidebar.widgets` | 侧栏 | —— |
| `post.beforeContent` | 正文前 | `acme.reading-time` |
| `post.afterContent` | 正文后 | —— |
| `post.comments` | 文章底部 | `rice.comments` |
| `footer.widgets` | 页脚 | —— |

插件还可以**声明自己的扩展点**（`manifest.extensionPoints`），此时作用域可选
`render` / `admin` / `server`。

---

## 2. 路由

### 2.1 公开页面路由（`page` 作用域，需 `routes:public`）

| 路由名 | 路径 | 提供者 |
| --- | --- | --- |
| `home` | `/` | `rice.posts` |
| `post.show` | `/post/:slug` | `rice.posts` |
| `term.category` | `/category/:slug` | `rice.posts` |
| `term.tag` | `/tag/:slug` | `rice.posts` |
| `page.show` | `/page/:slug` | `rice.pages` |
| `search` | `/search` | `rice.search` |
| `links` | `/links` | `rice.friend-links` |

模板里用 `url('post.show', { slug })` 生成地址；未注册时降级为 `#`。

`post.show`、`term.category`、`page.show` 声明了 `overridable: true`：启用「固定链接」插件后，
这三条的**路径**会被站点配置的路径模板接管（handler 不变），停用插件即恢复内建地址。
其余路由拒绝被接管。

### 2.2 原始路由（`raw`）

| 路径 | 提供者 | 能力 |
| --- | --- | --- |
| `GET /api/health` | Core | —— |
| `GET /preview/:token` | Core | 后台预览（`noindex`） |
| `GET /sitemap.xml` | `rice.seo` | `routes:public` |
| `GET /robots.txt` | `rice.seo` | `routes:public` |
| `GET /feed.xml` | `rice.feed` | `routes:public` |
| `GET /media/:mediaId` | `rice.media` | `routes:public` |
| `POST /comments/submit` | `rice.comments` | `routes:public` |
| `GET /api/comments` | `rice.comments` | `routes:public` |

### 2.3 管理 API（`adminApi`，需 `routes:admin`）

统一挂在 `/api/admin/*`，自动经过**认证 → CSRF → 权限 → 审计**。

| 路径 | 提供者 | 权限 |
| --- | --- | --- |
| `/users`（GET / POST） | `rice.identity` | `user.manage` |
| `/users/:userId/password` | `rice.identity` | `user.manage` |
| `/me/password` | `rice.identity` | 本人 |
| `/roles`、`/permissions` | `rice.authorization` | `user.manage` |
| `/users/:userId/roles`、`/users/:userId/roles/:role` | `rice.authorization` | `user.manage` |
| `/posts`、`/posts/:postId`、`/posts/preview`、`/posts/stats` | `rice.posts` | `post.view` / `post.write` |
| `/posts/:postId/status` | `rice.posts` | `post.publish` |
| `/pages`、`/pages/:pageId`、`/pages/preview` | `rice.pages` | `page.view` / `page.manage` |
| `/navigation/items`、`/navigation/targets` | `rice.navigation` | `nav.view` / `nav.manage` |
| `/terms`、`/terms/:termId` | `rice.taxonomy` | `post.view` / `taxonomy.manage` |
| `/media`、`/media/:mediaId` | `rice.media` | `media.manage` |
| `/comments`、`/comments/counts`、`/comments/moderate` | `rice.comments` | `comment.moderate` |
| `/friend-links/items`、`/friend-links/items/:linkId` | `rice.friend-links` | `link.view` / `link.manage` |
| `/permalink/settings`（GET / PUT）、`/permalink/preview` | `rice.permalink` | `permalink.view` / `permalink.manage` |

### 2.4 Core 管理端点

| 路径 | 权限 |
| --- | --- |
| `GET/POST/DELETE /session`、`GET /me`、`PUT /me` | 登录 |
| `GET /dashboard`、`GET /menu` | 登录 |
| `GET/PUT /site` | 读取登录；写入 `theme.manage` |
| `GET /system/state`、`POST /system/restart` | `system.restart` |
| `GET /audit` | `system.audit` |
| `GET /capabilities` | `plugin.view` |
| `GET /logs`、`/backup/*` | `system.maintain` |
| `/themes*` | `theme.view` / `theme.manage` |
| `/plugins*` | `plugin.view` / `plugin.manage` / `plugin.install` |
| `GET /extensions`、`GET /content-fields` | 登录 / 按贡献权限过滤 |

---

## 3. 事件

| 事件 | 发布者 | payload |
| --- | --- | --- |
| `core.runtime.started.v1` | Core | `{ started, failed, excluded }` |
| `identity.session.created.v1` | `rice.identity` | `{ userId, sessionId, ip }` |
| `identity.user.created.v1` | `rice.identity` | `{ userId, username?, isFirstUser?, role? }` |
| `identity.user.password.changed.v1` | `rice.identity` | `{ userId, byAdmin? }` |
| `identity.user.profile.updated.v1` | `rice.identity` | `{ userId }` |
| `identity.authorization.role.assigned.v1` | `rice.authorization` | `{ userId, role }` |
| `identity.authorization.role.revoked.v1` | `rice.authorization` | `{ userId, role }` |
| `identity.authorization.bootstrap.completed.v1` | `rice.authorization` | `{ userId }` |
| `content.post.published.v1` | `rice.posts` | `{ postId, slug, title, authorId }` |
| `content.post.unpublished.v1` | `rice.posts` | `{ postId, slug }` |
| `content.post.updated.v1` | `rice.posts` | `{ postId, slug, title, status }` |
| `content.post.deleted.v1` | `rice.posts` | `{ postId, slug }` |
| `content.pages.changed.v1` | `rice.pages` | `{ pageId, slug, status }` |
| `content.pages.deleted.v1` | `rice.pages` | `{ pageId, slug }` |

事件名以**字符串字面量**使用（共享包里只有示例常量）。

---

## 4. 服务契约

| 契约 | 提供者 | 文档 |
| --- | --- | --- |
| `core.security@1` | Core | [[契约参考\|Plugin-API-Service-Contracts]] |
| `core.theme@1` | Core | 同上 |
| `core.site@1` | Core | 同上 |
| `core.runtime@1` | Core | 同上 |
| `core.setup@1` | Core | 同上 |
| `core.html@1` | Core | 同上 |
| `identity.auth@1` | `rice.identity` | 同上 |
| `identity.users@1` | `rice.identity` | 同上 |
| `identity.authorization@1` | `rice.authorization` | 同上 |
| `content.posts@1` | `rice.posts` | 同上 |
| `content.pages@1` | `rice.pages` | 同上 |
| `content.navigation@1` | `rice.navigation` | 同上 |
| `content.taxonomy@1` | `rice.taxonomy` | 同上 |
| `taxonomy.internal@1` | `rice.taxonomy` | 内部契约 |
| `media.library@1` | `rice.media` | [[契约参考\|Plugin-API-Service-Contracts]] |
| `content.search@1` | `rice.search` | 同上（**数据源注册表**） |
| `content.comments@1` | `rice.comments` | 同上 |
| `permalink.routes@1` | `rice.permalink` | [[契约参考\|Plugin-API-Service-Contracts]] |

---

## 5. 后台菜单（`admin.pages` 声明式）

| 页面 ID | 标签 | 路径 | 权限 | order | 提供者 |
| --- | --- | --- | --- | --- | --- |
| `users.list` | 用户 | `/users` | `user.manage` | 30 | `rice.identity` |
| `users.roles` | 角色与权限 | `/roles` | `user.manage` | 20 | `rice.authorization` |
| `posts.list` | 文章 | `/posts` | `post.view` | 50 | `rice.posts` |
| `posts.editor` | 编辑文章 | `/posts/editor` | `post.write` | — | `rice.posts`（`hidden`） |
| `pages.list` | 页面 | `/pages` | `page.view` | 15 | `rice.pages` |
| `pages.editor` | 页面编辑 | `/pages/editor` | `page.manage` | — | `rice.pages`（`hidden`） |
| `navigation.items` | 导航栏 | `/navigation` | `nav.view` | 18 | `rice.navigation` |
| `permalink.settings` | 固定链接 | `/permalink` | `permalink.view` | 16 | `rice.permalink` |
| `taxonomy.terms` | 分类与标签 | `/taxonomy` | `post.view` | 15 | `rice.taxonomy` |
| `media.library` | 媒体库 | `/media` | `media.manage` | 10 | `rice.media` |
| `comments.moderate` | 评论审核 | `/comments` | `comment.moderate` | 20 | `rice.comments` |
| `friend-links.list` | 友情链接 | `/friend-links` | `link.view` | 19 | `rice.friend-links` |

Core 自有入口（不通过插件）：仪表盘 `/`、外观中心 `/themes`、扩展中心 `/plugins`、
运行日志 `/logs`、备份与恢复 `/backup`、系统设置 `/settings`、个人资料 `/profile`。

排序规则：**`order` 降序，同分按 ID 升序**。
`rice.search`、`rice.seo` 与 `rice.feed` **没有**后台页面。

---

## 6. 权限点

**声明方 = 拥有它的那一方**：插件在自己的 `manifest.permissions` 里声明，
Core 的控制面与共用权限点在 `packages/core/src/security/permissions.ts` 里声明。
Core 校验全局唯一并聚合（`core.security@1` 的 `listDeclaredPermissions()`），
`rice.authorization` 只负责按站点语言展示与分派（见 ADR-018）。

| 组 | 权限点 | 声明方 |
| --- | --- | --- |
| 内容 | `post.view`、`post.write`、`post.publish`、`post.delete` | `rice.posts` |
| 内容 | `page.view`、`page.manage` | `rice.pages` |
| 内容 | `taxonomy.manage` | `rice.taxonomy` |
| 内容 | `media.manage` | `rice.media` |
| 互动 | `comment.moderate` | `rice.comments` |
| 外观 | `nav.view`、`nav.manage` | `rice.navigation` |
| 外观 | `permalink.view`、`permalink.manage` | `rice.permalink` |
| 外观 | `link.view`、`link.manage` | `rice.friend-links` |
| 外观 | `theme.view`、`theme.manage` | Core |
| 扩展 | `plugin.view`、`plugin.manage`、`plugin.install` | Core |
| 用户 | `user.manage` | Core（identity 与 authorization 共用） |
| 系统 | `system.audit`、`system.maintain`、`system.restart` | Core |

内置角色**只有** `administrator`（`*`）。`editor` / `author` / `contributor` 不再是内置角色：
插件不替站点决定分工，管理员按需自建角色并显式授权。

两条规则刻意不对称：**重复声明是错误**（启动与 `pnpm validate` 都会失败），
**用了却没声明只告警** —— 未声明的权限点以「未登记」分组出现在目录里、**仍然可以分配**，
因为鉴权按标识字符串比对，与是否声明无关。

面向插件作者的操作步骤（何时需要、命名约定、声明之后谁来授权、宿主版本要求）见
[[权限点声明与角色分配|Plugin-API-Permissions]]。

---

## 7. 能力白名单（12 项）

```
database:own        routes:public       routes:admin
services:provide    services:consume   events:publish
events:subscribe    slots:register     admin:menu
media:store         extensions:declare extensions:contribute
```

未声明即调用 → `RN_FORBIDDEN`（403）。详见 [[起步|Plugin-API-Getting-Started]]。

---

## 8. 命名扩展点（三作用域）

| 作用域 | 已知扩展点 |
| --- | --- |
| `render` | 9 个标准插槽（见第 1 节） |
| `admin` | `rice.posts.listActions`、`rice.posts.editorToolbar`、`rice.posts.editorBody`、`rice.pages.listActions`、`rice.pages.editorToolbar`、`rice.pages.editorBody`、`rice.media.picker` |
| `server` | `rice.permalink.schemes`（新增一整套路径方案）、`rice.permalink.tokens`（为已有方案追加参数） |

| 扩展点 | 提供者 | `replaceable` | 已知贡献者 |
| --- | --- | --- | --- |
| `rice.posts.listActions` | `rice.posts` | true | `rice.editor-enhance`（replace） |
| `rice.posts.editorToolbar` | `rice.posts` | true | `rice.editor-enhance`（append） |
| `rice.posts.editorBody` | `rice.posts` | true | `rice.editor-enhance`（replace） |
| `rice.pages.listActions` | `rice.pages` | true | `rice.editor-enhance`（replace） |
| `rice.pages.editorToolbar` | `rice.pages` | true | `rice.editor-enhance`（append） |
| `rice.pages.editorBody` | `rice.pages` | true | `rice.editor-enhance`（replace） |
| `rice.media.picker` | `rice.media` | **false** | `rice.media` 自身（replace，提供默认面板） |
| `rice.permalink.schemes` | `rice.permalink` | **false** | 暂无官方消费者（供第三方内容插件接入） |
| `rice.permalink.tokens` | `rice.permalink` | **false** | 暂无官方消费者（供第三方插件追加参数） |

裁决规则：存在 `replace` → 只呈现胜出者（`order` 最大）；否则全部 `append` 按 `order` 降序。

---

## 9. 生命周期状态机

```
DISCOVERED → VALIDATED → INSTALLED → ENABLED → STARTED
                                        ↓          ↓
                                    DISABLED    STOPPED
                       （任一步出错）→ FAILED
```

插件钩子：`setup()`（注册迁移/静态资源，**不注册路由**）、`start()`（注册路由/服务/事件/插槽）、`stop()`（释放）。

内置生命周期事件：`core.runtime.started.v1`。

---

## 10. 主题侧扩展点

| 位置 | 机制 |
| --- | --- |
| 模板挂载点 | `slot('名字', data)` |
| 能力判断 | `has_feature('posts')` |
| 路由链接 | `url('路由名', params)` |
| 静态资源 | `theme_asset('css/style.css')` |
| 短代码 | `{{ shortcode_runtime() }}` + 浏览器脚本 `RiceNoteShortcodes.define()` + 容器标注 `data-rn-shortcodes` |
| 内容字段 | `page.fields.<键>`（由 `contentFields` 声明） |
| 页面版式 | `pageTemplates` 声明 + 内容保存版式键 |

---

## 11. 如何自查本清单是否过期

代码提供了运行时自省接口，**不要靠读文档判断**：

| 想查 | 接口 |
| --- | --- |
| 已启用的能力 | `GET /api/health` 的插件计数 + `GET /api/admin/capabilities` |
| 已注册的路由 | `GET /api/admin/capabilities`（列出页面 / 原始 / 管理路由） |
| 已注册的服务契约 | 同上 |
| 已注册的插槽与事件订阅 | 同上（含订阅者数量） |
| 已声明的扩展点与贡献 | `GET /api/admin/extensions` |
| 后台菜单实际内容 | `GET /api/admin/menu` |
| 权限点目录 | `GET /api/admin/permissions`（`rice.authorization` 提供） |

`GET /api/admin/capabilities` 是这份清单的**运行时对照表** ——
如果本页与它不一致，以运行时为准，并欢迎提 issue。

---

## 相关页面

- [[跨插件服务契约|Plugin-API-Service-Contracts]]
- [[命名扩展点注册表|Architecture-Extension-Registry]]
- [[插件生命周期与依赖解析|Architecture-Plugin-Lifecycle]]
- 仓库文档：[hooks-inventory.md](https://github.com/ricenote/ricenote/blob/main/docs/architecture/hooks-inventory.md)
