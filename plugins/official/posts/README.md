# rice.posts —— 文章

站点的主要内容插件：文章的撰写、发布、归档与前台展示（首页、文章页、分类/标签归档），
并向搜索插件注册可搜索数据源。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.posts` |
| version | `1.2.0` |
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
`listPublishedByTerm` / `searchPublished` / `titlesOf` / `listForAdmin` / `findForAdmin` /
`save` / `remove` / `countByStatus` / `recent`）。

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
| `content.post.unpublished.v1` | 由发布态转为非发布态 | `{ postId, slug }` |
| `content.post.deleted.v1` | 删除 | `{ postId, slug }` |

订阅：`core.runtime.started.v1`（在全部插件就绪后注册搜索数据源并上报可选依赖可用性）。

### 后台菜单

`{ id: 'posts.list', label: '文章', path: '/posts', icon: 'FileText', order: 50, permission: 'post.view' }`

## 设置项（旧写法 `settings`）

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `pageSize` | `10` | 列表每页文章数 |
| `excerptLength` | `160` | 自动摘要长度 |

> 本插件仍使用扁平键值的 `settings` 写法（向后兼容路径）；新插件建议改用 `settingsSchema`
> 以获得后台自动生成的表单，参见 `plugins/official/pages/manifest.json`。

## 文章模板（1.2.0 新增）

`rn_posts.template` 保存主题 `pageTemplates` 声明的**模板键**：

- 后台文章编辑可选择版式；服务端校验键必须命中当前主题清单；
- 主题切换后旧键失效时不报错，渲染器回退到 `templates.post`；
- 迁移 `0003_post_template.sql` 只新增可空列，历史文章行为不变。

## 依赖与启停

- `identity.users@1` 为硬依赖：identity 被禁用时本插件会被依赖解析排除（`FAILED`）；
- taxonomy / media / search 为软依赖：缺失时对应功能静默降级（不报错、不 500）。
