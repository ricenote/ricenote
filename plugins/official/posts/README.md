# rice.posts —— 文章

站点的主要内容插件：文章的撰写、发布、归档与前台展示（首页、文章页、分类/标签归档），
并向搜索插件注册可搜索数据源。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.posts` |
| version | `1.4.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `content.posts@1` |
| requires | `identity.users@1: ^1.0.0`（**硬依赖**：解析作者显示名） |
| capabilities | `database:own`、`services:provide`、`services:consume`、`routes:public`、`routes:admin`、`events:publish`、`events:subscribe`、`slots:register`、`admin:menu` |
| migrations | `0001_posts.sql`、`0002_search_index.sql`、`0003_post_template.sql` |
| 数据表 | `rn_posts` |

## 扩展点（Hook）

### 公开页面路由

| name | path | kind | 说明 |
| --- | --- | --- | --- |
| `home` | `/` | `home` | 首页文章列表（`?page=` 分页） |
| `post.show` | `/post/:slug` | `post` | 文章详情 |
| `term.category` | `/category/:slug` | `archive` | 分类归档 |
| `term.tag` | `/tag/:slug` | `archive` | 标签归档 |

> `/search` **不由本插件提供**：路由名与路径归 `rice.search`（它负责跨内容类型聚合），
> posts 只通过 `content.search@1` 注册自己的数据源。因此 search 可被独立启停。

模板变量（`data`）：`post`（详情）、`posts`（列表）、`term`（归档）、`pagination`、`seoDescription`。

### 管理 API

| 方法 | 路径 | 权限点 |
| --- | --- | --- |
| GET | `/api/admin/posts` | `post.view` |
| GET | `/api/admin/posts/:postId` | `post.view` |
| GET | `/api/admin/posts/stats` | `post.view` |
| POST | `/api/admin/posts` | `post.write` |
| PUT | `/api/admin/posts/:postId` | `post.write` |
| POST | `/api/admin/posts/:postId/status` | `post.publish` |
| DELETE | `/api/admin/posts/:postId` | `post.delete` |

> `/posts/:postId/status` 只切换状态，但会复用保存流程回传完整字段（封面、SEO、模板），
> 否则"仅发布"会静默清空这些字段。

### 服务契约

提供 `content.posts@1`（`listPublished` / `findPublishedBySlug` / `findPublishedById` /
`listPublishedByTerm` / `searchPublished` / `titlesOf` / `publishedRefs` /
`listForAdmin` / `findForAdmin` / `save` / `remove` / `countByStatus` / `recent`）。

其中 `titlesOf(ids)`（含草稿的标题）与 `publishedRefs(ids)`（仅已发布，带前台地址）
是为**其他插件的后台列表与全局插槽**准备的两个批量接口，
避免"为每个 ID 单独查询"的 N+1 模式，也让引用方不必自己拼 `/post/:slug`。

消费：

| 契约 | 必需性 | 用途 |
| --- | --- | --- |
| `core.setup@1`、`core.html@1`、`core.theme@1` | 必需 | 站点标识、正文消毒、主题模板清单与缓存失效 |
| `identity.users@1` | 可选（请求期惰性） | 作者显示名 |
| `content.taxonomy@1` / `taxonomy.internal@1` | 可选（请求期惰性） | 词条读取与关联维护 |
| `media.library@1` | 可选（请求期惰性） | 封面 URL 解析 |
| `content.search@1` | 可选（请求期惰性） | 注册/注销可搜索数据源（数据源 id `posts`） |
| `identity.authorization@1` | 可选（请求期惰性） | 发布动作的二次鉴权 |

### 插槽

| 插槽 | 组件名 | 优先级 | 说明 |
| --- | --- | --- | --- |
| `post.afterContent` | `posts.meta` | 10 | 文章底部展示词条与"最后更新" |

### 事件

| 事件 | 时机 | 载荷 |
| --- | --- | --- |
| `content.post.published.v1` | 由非发布态转为发布态 | `{ postId, slug, title, authorId }` |
| `content.post.updated.v1` | 更新既有文章（**含只改标题/别名的编辑**） | `{ postId, slug, title, status }` |
| `content.post.unpublished.v1` | 由发布态转为非发布态 | `{ postId, slug }` |
| `content.post.deleted.v1` | 删除 | `{ postId, slug }` |

> `content.post.updated.v1` 的存在意义：前三个事件只表达"发布状态翻转"，
> 改标题或改别名不会产生任何信号，而引用了文章的全局插槽（如导航栏）必须能感知
> 这类变化才能准确失效缓存。订阅方 `rice.navigation` 只在"该文章确实被导航引用"时才清缓存。

订阅：`core.runtime.started.v1`（在全部插件就绪后注册搜索数据源并上报可选依赖可用性）。

### 后台菜单

`{ id: 'posts.list', label: '文章', path: '/posts', icon: 'FileText', order: 50, permission: 'post.view' }`

## 后台界面（插件自带）

界面代码就在本插件目录内，**零构建**（纯 ESM + 模板字符串，不装依赖、不打包）：

| 项 | 值 |
| --- | --- |
| 入口 | `admin/main.js`（`defineAdminPage` 导出页面组件） |
| 托管 URL | `/plugin-admin/rice.posts/main.js`（需登录；插件启用时才可取） |
| 菜单声明 | `manifest.json` → `admin.pages[]`：id `posts.list`、路径 `/posts`、图标 `FileText`、权限 `post.view` |
| 依赖 | 仅 `/admin-sdk/v1/ricenote-admin.js`（宿主与插件共用同一份 SDK 与同一份 Vue 实例） |

服务端分页（每页 10）、状态筛选、关键词搜索、Markdown 正文、词条多选、
发布/归档与批量删除的权限门控（`post.write` / `post.publish` / `post.delete`）与迁移前一致。
开发方式与样式可用范围见 `docs/plugin-api/v1.md` 第 16 节与 ADR-014。

## 设置项（`settingsSchema`，后台自动生成表单）

后台「扩展中心 → 文章 → 设置」。保存后需**重启服务**生效（`ctx.config` 是插件启动期快照）。

### 分组「列表与摘要」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `pageSize` | number（1–50） | `10` | 列表每页文章数 |
| `excerptLength` | number（20–1000） | `160` | 自动摘要长度（未手写摘要时从正文截取） |

> 插件侧会把这两个值再收敛一次（`1–50` / `20–1000`），防止历史脏值让分页查询失效。

## 文章模板（1.2.0 新增）

`rn_posts.template` 保存主题 `pageTemplates` 声明的**模板键**：

- 后台文章编辑可选择版式；服务端校验键必须命中当前主题清单；
- 主题切换后旧键失效时不报错，渲染器回退到 `templates.post`；
- 迁移 `0003_post_template.sql` 只新增可空列，历史文章行为不变。

## 依赖与启停

- `identity.users@1` 为硬依赖：identity 被禁用时本插件会被依赖解析排除（`FAILED`）；
- taxonomy / media / search 为软依赖：缺失时对应功能静默降级（不报错、不 500）。
