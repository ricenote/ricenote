# 官方插件一览

RiceNote 的业务能力全部由插件实现。仓库随附 **14 个官方插件**（`plugins/official/`）与 **1 个第三方示例**（`plugins/third-party/reading-time`）。

> **官方插件 vs 内置插件**：从官方目录随仓库分发的插件带「官方」身份但**可更新、可卸载**；
> 内置（随进程分发、不可卸载）的只有 Core 自身的基础设施。所有 14 个官方插件都可以独立启停。

官方插件提供了博客系统的基础功能，开发主题或者其他增强插件时可以直接使用。

---

## 全景

| 插件 | ID | 版本 | 提供的能力契约 | 依赖 | 后台页面 |
| --- | --- | --- | --- | --- | --- |
| 身份与认证 | `rice.identity` | 1.4.0 | `identity.auth@1`、`identity.users@1` | —— | 用户 `/users` |
| 角色与权限 | `rice.authorization` | 1.4.0 | `identity.authorization@1` | `identity.users@1` | 角色与权限 `/roles` |
| 文章 | `rice.posts` | 1.8.0 | `content.posts@1` | `identity.users@1` | 文章 `/posts`、编辑文章 `/posts/editor` |
| 页面 | `rice.pages` | 1.5.0 | `content.pages@1` | —— | 页面 `/pages`、页面编辑 `/pages/editor` |
| 导航栏 | `rice.navigation` | 1.2.0 | `content.navigation@1` | —— | 导航栏 `/navigation` |
| 固定链接 | `rice.permalink` | 1.0.0 | `permalink.routes@1` | ——（对 posts / pages / taxonomy 为可选依赖） | 固定链接 `/permalink` |
| 分类与标签 | `rice.taxonomy` | 1.3.0 | `content.taxonomy@1` | —— | 分类与标签 `/taxonomy` |
| 媒体库 | `rice.media` | 1.3.0 | `media.library@1` | —— | 媒体库 `/media` |
| 评论 | `rice.comments` | 1.3.1 | `content.comments@1` | ——（对 posts / identity 为请求期可选依赖） | 评论审核 `/comments` |
| 搜索 | `rice.search` | 1.2.0 | `content.search@1` | —— | —— |
| SEO | `rice.seo` | 1.2.1 | ——（消费 `content.posts@1`） | —— | —— |
| 编辑增强 | `rice.editor-enhance` | 1.1.1 | ——（纯前端贡献） | —— | —— |
| RSS 订阅 | `rice.feed` | 1.1.1 | ——（消费 `content.posts@1`） | —— | —— |
| 友情链接 | `rice.friend-links` | 1.1.1 | —— | —— | 友情链接 `/friend-links` |
| _示例：阅读时长_ | `acme.reading-time` | 1.1.0 | —— | —— | —— |

“提供的能力契约”是插件对外暴露的**能力名**；其它插件依赖能力而不是插件 ID，因此可以替换实现。
若某个插件被禁用，依赖它的功能会按各自的降级策略工作（见各插件小节与 [[安装与更新|Plugins-Install-and-Update]]）。

**必需的两项**：`rice.identity`（没有它就没有登录端点）与 `rice.authorization`（没有它权限校验会全部拒绝）。
安装向导中这两项不可取消。

---

## 身份与认证 `rice.identity`

- **做什么**：用户、登录会话、密码哈希（scrypt）、会话数上限与过期清理。
- **对外能力**：`identity.auth@1`（认证）、`identity.users@1`（用户读写）。
- **数据表**：`rn_identity_users`、`rn_identity_sessions`。
- **后台页面**：用户 `/users`（`user.manage`）——列表、创建、**重置他人密码**（刻意拒绝重置自己，本人改密必须走 `/me/password`）。
- **设置**：会话有效期（默认 7200 秒）、单用户并发会话上限（默认 10）。
- **接口**：`GET/POST /api/admin/users`、`POST /api/admin/users/:userId/password`、`POST /api/admin/me/password`。
- **关键设计**：通过 `core.security@1` 注册会话解析器（依赖倒置）——Core 只管安全边界，不认用户表。

---

## 角色与权限 `rice.authorization`

- **做什么**：角色、权限点、用户-角色分派。
- **对外能力**：`identity.authorization@1`；依赖 `identity.users@1`。
- **数据表**：`rn_authz_roles`、`rn_authz_role_permissions`、`rn_authz_user_roles`。
- **后台页面**：角色与权限 `/roles`（`user.manage`）。
- **内置角色**：只有 `administrator`（`*`），启动只保证它存在且权限为 `*`（防止"库被改坏后没人能进后台"）。其余角色由站点管理员自建 —— 插件不替站点决定"谁该有什么权限"。
- **权限点**：**不持有**权限点目录。目录来自 Core 的聚合视图（各插件在 `manifest.permissions` 里声明 + Core 的控制面权限点 + 实际使用点），本插件只按站点语言解析文案。详见 [[后台功能导览|Admin-Guide]]。
- **订阅事件**：`identity.user.created.v1` —— **首个用户**自动成为管理员，其余新用户**默认不分配角色**（后台创建时显式指定了角色才分派）。**这是为了避免与 identity 形成循环依赖**（identity 不反向依赖 authorization）。

---

## 文章 `rice.posts`

- **做什么**：Markdown 写作、发布 / 撤回 / 归档、首页 / 文章页 / 分类标签归档页路由。
- **对外能力**：`content.posts@1`；依赖 `identity.users@1`。
- **数据表**：`rn_posts`（含 ngram FULLTEXT 索引，由搜索使用；`template` 列保存版式键）。
- **公开路由**：`/`（首页）、`/post/:slug`、`/category/:slug`、`/tag/:slug`。
- **后台页面**：文章 `/posts`（`post.view`）、编辑文章 `/posts/editor`（`post.write`，**不进侧栏**）。
- **设置**：列表每页条数（默认 10）、自动摘要长度（默认 160）。
- **声明扩展点**：`rice.posts.listActions`、`rice.posts.editorToolbar`、`rice.posts.editorBody`（供其它插件扩展列表与编辑器界面）。
- **事件**：发布状态翻转与 `content.post.updated.v1`（改标题/别名时也发信号，供导航等缓存消费者使用）。
- **接口**：`/api/admin/posts`（增删改查）、`/posts/:postId/status`（状态）、`/posts/preview`（预览）、`/posts/stats`。

---

## 页面 `rice.pages`

- **做什么**：独立页面（标题 / 别名 / Markdown 正文 / 状态 / 排序 / SEO 字段 / 版式）。
- **对外能力**：`content.pages@1`。
- **数据表**：`rn_pages`。
- **公开路由**：`/page/:slug`。
- **后台页面**：页面 `/pages`（`page.view`）、页面编辑 `/pages/editor`（`page.manage`，**不进侧栏**）。
- **设置**：列表每页条数（默认 20）、是否启用页面缓存。
- **声明扩展点**：`rice.pages.listActions`、`rice.pages.editorToolbar`、`rice.pages.editorBody`。
- **与导航的关系**：`rice.pages` **不再**输出顶部导航 —— 导航由 `rice.navigation` 拥有。页面插件只提供 `navItems()` 作为“有哪些已发布页面”的查询入口。

---

## 导航栏 `rice.navigation`

- **做什么**：顶部导航栏成为**独立可管理的实体**，不再由页面插件“顺带”输出。
- **对外能力**：`content.navigation@1`。
- **数据表**：`rn_nav_items`。
- **导航项三种来源**：自定义链接（站内路径或外部地址）、页面、文章。
- **引用式设计**：引用类项只保存内容 ID，标题与地址在读取时解析 —— 内容改名后导航自动跟随；
  目标被删除或未发布时**前台跳过（绝不输出死链）**，后台标记 `exists` / `published` 并给出提示。
- **后台页面**：导航栏 `/navigation`（`nav.view` / `nav.manage`）—— 前台预览、上下移排序、启用开关、类型化编辑。
- **设置**：前台最多渲染项数（默认 10）。
- **安全**：地址白名单只接受 `/` 开头的站内路径与 `http(s)://` 绝对地址，
  拒绝 `javascript:` / `data:` / `vbscript:` / `mailto:` / 相对路径 / 协议相对地址（`//evil.com`）；外链固定输出 `rel="noopener noreferrer"`。
- **渲染**：通过标准插槽 `header.navigation` 输出。

---

## 固定链接 `rice.permalink`

- **做什么**：为**文章 / 独立页面 / 分类**三类内容各配一套路径模板，决定站点地址长什么样
  （如 `/archives/{cid}/`、`/{year}/{month}/{day}/{slug}.html`）。它**只接管路径**，
  内容解析与页面渲染仍在 posts / pages。
- **对外能力**：`permalink.routes@1`（模板解读、地址生成、命中校验）。
- **数据表**：`rn_permalink_settings`（按方案一行：`site_id + scheme_id → template`）。
- **可用参数**：文章 `{cid}` `{slug}` `{category}` `{year}` `{month}` `{day}`；
  页面 `{cid}` `{slug}`；分类 `{mid}` `{slug}`。每类路径至少含一个参数，非法写法保存时即被拒绝。
- **预设风格**：文章内置「内核默认 `/post/{slug}`」「默认风格 `/archives/{cid}/`」
  「WordPress 风格 `/archives/{slug}.html`」「按日期归档」「按分类归档」等预设，
  也可「个性化定义」；页面与分类各有两个预设。
- **后台页面**：固定链接 `/permalink`（`permalink.view` / `permalink.manage`）——
  预设单选、参数标签（在光标处插入）、实时预览、风险提示、保存后标记「待重启」。
- **对外开放**：声明两个 **server 作用域**扩展点 —— `rice.permalink.schemes`
  （第三方内容插件为自己的内容类型新增一整套方案）与 `rice.permalink.tokens`
  （为已有方案追加自定义参数并提供同步取值与命中校验）。
- **零破坏**：未启用该插件（或启用但未改设置）时，前台地址与内建完全一致
  （`/post/:slug`、`/page/:slug`、`/category/:slug`）；停用后立即回退。
- **生效方式**：保存后需**重启**（地址在启动期装配，与插件设置同一语义）。
- **注意**：一旦选定风格请勿轻易修改 —— 换风格后旧地址不再可用（不做 301 兼容）。

---

## 分类与标签 `rice.taxonomy`

- **做什么**：分类与标签词条及文章关联。**不注册页面路由**（归档页由 `rice.posts` 渲染）。
- **对外能力**：`content.taxonomy@1`。
- **数据表**：`rn_terms`、`rn_term_relations`。
- **后台页面**：分类与标签 `/taxonomy`（查看 `post.view`，写入 `taxonomy.manage`）。
- **接口**：`GET /api/admin/terms`、`POST /api/admin/terms`、`PUT /api/admin/terms/:termId`。
- **与编辑器协作**：文章编辑页的“输入即创建标签”正是调用 `POST /api/admin/terms`；无 `taxonomy.manage` 的角色只能选择已有标签。

---

## 媒体库 `rice.media`

- **做什么**：上传（扩展名白名单 + 文件名随机化 + 路径归一化）、媒体元数据、公开访问。
- **对外能力**：`media.library@1`。
- **数据表**：`rn_media`。
- **公开路由**：`GET /media/:mediaId`（SVG 响应附加严格 CSP）。
- **后台页面**：媒体库 `/media`（`media.manage`）。
- **设置**：单文件体积上限（默认 8MB）。
- **声明扩展点**：`rice.media.picker`（`replaceable: false`）—— 并用 `replace` 贡献默认面板。
  其它插件（如 SEO 的默认分享图、站点 Logo）可复用这个选择器；**媒体库未启用时消费方渲染默认内容**（直接填链接）。

---

## 评论 `rice.comments`

- **做什么**：访客评论（昵称 / 邮箱 / 网址，可与登录用户关联）、无限层嵌套回复、四态审核状态机。
- **对外能力**：`content.comments@1`。
- **数据表**：`rn_comments`。
- **审核状态**：`pending` / `approved` / `spam` / `trash`，支持批量操作。
- **反垃圾**：关键词黑名单、单条链接数上限、按来源哈希的频率限制（默认 60 秒 3 条）；
  **来源 IP 只以加盐哈希留档，不落明文**。另有同源校验与蜜罐字段（蜜罐命中时静默返回成功）。
- **正文安全**：按**纯文本**处理（入库即转义、输出只保留换行），因此不存在用户 HTML 进入模板的路径。
- **前台**：通过插槽 `post.comments` 输出；支持**无 JavaScript 回退**（表单直接 POST 到 `/comments/submit`，服务端 302 回文章页并附 `?comment=<结果>`）。
- **后台页面**：评论审核 `/comments`（`comment.moderate`）。
- **设置**：常规（开关、先审后发、分页、字数上限、嵌套深度）与反垃圾两组。
- **可选依赖**：`content.posts@1` 与 `identity.users@1` 在**请求期惰性解析**，缺失时自动降级。

---

## 搜索 `rice.search`

- **做什么**：提供 `/search` 页面与全局搜索；**不感知任何具体内容类型**。
- **对外能力**：`content.search@1` —— 一个**可搜索数据源注册表**（`registerSource` / `unregisterSource` / `search` / `listSources`）。
- **数据表**：**无**（不持有任何数据表）。
- **公开路由**：`/search`。
- **设置**：每页结果数、关键词长度上限、单数据源条数上限。
- **检索实现**：`rice.posts` 在 `core.runtime.started.v1` 时注册数据源，停止时注销；
  查询走 `rn_posts` 的 **ngram FULLTEXT 索引 + `IN BOOLEAN MODE` 引号短语**（中文可命中、拉丁词不过匹配），
  关键词过短或索引缺失时自动回退 `LIKE`。单个数据源查询失败被隔离，不影响其它来源。

> **可替换性示例**：任何插件都可以向 `content.search@1` 注册自己的数据源，从而“进入全站搜索”，而搜索插件本身无需改动。

---

## SEO `rice.seo`

- **做什么**：注入社交与爬虫相关的元数据、提供站点地图与 robots。
- **对外能力**：无（**消费** `content.posts@1`，且为可选 —— 仅用于 sitemap）。
- **数据表**：无。
- **公开路由**：`GET /sitemap.xml`（首页 + 全部已发布文章，带 `lastmod` 与收录上限）、`GET /robots.txt`。
- **渲染**：通过标准插槽 `head.end` 注入 Open Graph、Twitter Card、`robots` 指令与 JSON-LD
  （文章页 `BlogPosting`、首页 `WebSite`、归档页 `CollectionPage`）。搜索页与 404 页自动标注 `noindex,follow`。
- **设置**：社交（Open Graph / Twitter Card / JSON-LD / 默认分享图）与爬虫（sitemap 开关与上限、robots 屏蔽列表，默认屏蔽 `/admin` 与 `/api`）两组。
- **注意**：不重复输出 canonical（由主题声明），避免双 canonical。

---

## 编辑增强 `rice.editor-enhance`

- **做什么**：**不提供任何页面**，纯前端贡献 —— 把文章/页面编辑页升级为真正的 Markdown 编辑器。
- **对外能力**：无。能力只有 `extensions:contribute`。
- **数据表**：无。
- **贡献的扩展点**（全部 `admin` 作用域）：

| 扩展点 | 模式 | 效果 |
| --- | --- | --- |
| `rice.posts.listActions` / `rice.pages.listActions` | `replace` | 替换列表页的操作按钮区 |
| `rice.posts.editorToolbar` / `rice.pages.editorToolbar` | `append` | 在编辑器工具栏追加按钮 |
| `rice.posts.editorBody` / `rice.pages.editorBody` | `replace` | 正文区换成 **Toast UI Editor**（Markdown 双栏实时预览、中文界面、关闭使用统计） |

- **分发方式**：把上游 `@toast-ui/editor@3.2.2`（MIT）的自包含产物 vendor 进插件 `admin/vendor/`，**宿主不新增依赖、插件侧无构建步骤**。
- **降级**：vendor 缺失时自动回退为普通文本域，**编辑功能与草稿都不缺失**。

---

## RSS 订阅 `rice.feed`

- **做什么**：为站点提供标准 **RSS 2.0** 订阅地址 `/feed.xml`，并在 `<head>` 注入自动发现链接 —— 读者把站点地址粘进阅读器即可订阅。
- **对外能力**：无（**消费** `content.posts@1`，且为可选 —— posts 被禁用时降级为"只有站点信息的空订阅源"，不报错）。
- **数据表**：无。
- **公开路由**：`GET /feed.xml` —— 只收录**已发布**文章，按发布时间倒序；每条含标题、链接、`guid`、`pubDate`（RFC 822 / GMT）、分类与摘要。
- **渲染**：通过标准插槽 `head.end` 注入 `<link rel="alternate" type="application/rss+xml">`。
- **设置**：是否提供订阅（默认开）、条数上限（默认 20，上限 100）、是否输出正文全文（默认关）、缓存时间（默认 1800 秒）。
- **注意**：关闭「开启订阅」后路由与自动发现链接都不注册，因此改动需重启服务生效。

---

## 友情链接 `rice.friend-links`

- **做什么**：管理站点的友情链接（名称 / 地址 / 头像 / 描述 / 排序 / 启用），并在前台提供 `/links` 页面。
- **对外能力**：无。刻意**不提供跨插件服务契约** —— 友链只给**主题**用，而主题读不到服务契约，取数走页面注入的 `data.friendLinks`（元素含 `name` / `url` / `avatarUrl` / `description`）。
- **数据表**：`rn_friend_links`。
- **公开路由**：`/links`（`kind=links`）。主题需在 `theme.json` 声明 `templates.links` 并提供模板；两套官方主题已内置 `links.njk`（默认主题为头像卡片网格、极简主题为单列列表），**导航栏与页脚未做改动**。
- **后台页面**：友情链接 `/friend-links`（`link.view` / `link.manage`）—— 列表 + 弹窗表单、启用开关、排序数值（越小越靠前）。
- **接口**：`GET/POST /api/admin/friend-links/items`、`PUT/DELETE /api/admin/friend-links/items/:linkId`。
- **缓存**：`/links` 参与 HTML 缓存，增删改后按 `friend-links` 标签**精确失效**（本插件的内容只出现在这一个页面上，无需整站清缓存）。
- **校验**：地址必须是 `http(s)://` 完整地址；头像可空、可为完整地址或媒体库路径（`/uploads/…`、`/media/…`）。

---

## 第三方示例 `acme.reading-time`（阅读时长）

放在 `plugins/third-party/reading-time/`，作为第三方插件的**起手模板**：

- 只声明一个能力：`slots:register`；
- **不依赖任何插件、不持有数据表、不注册路由、无后台页面**；
- 仅通过插槽 `post.beforeContent` 在正文前插入“阅读时长”；
- 设置：阅读速度（字/分，默认 300）、是否显示字数、前缀文案。

它证明了**第三方插件与官方插件在能力上是等价的**：声明式设置、插槽、能力白名单对两者完全一致。

---

## 相关页面

- [[插件安装与更新|Plugins-Install-and-Update]]
- [[后台功能导览|Admin-Guide]]
- [[扩展点全量清单|Hooks-Inventory]]
- [[跨插件服务契约|Plugin-API-Service-Contracts]]
