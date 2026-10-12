# rice.posts —— 文章

站点的主要内容插件：文章的撰写、发布、归档与前台展示（首页、文章页、分类/标签归档），
并向搜索插件注册可搜索数据源。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.posts` |
| version | `1.6.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `content.posts@1` |
| requires | `identity.users@1: ^1.0.0`（**硬依赖**：解析作者显示名） |
| capabilities | `database:own`、`services:provide`、`services:consume`、`routes:public`、`routes:admin`、`events:publish`、`events:subscribe`、`slots:register`、`admin:menu`、`extensions:declare` |
| migrations | `0001_posts.sql`、`0002_search_index.sql`、`0003_post_template.sql`、`0004_post_fields.sql` |
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
| POST | `/api/admin/posts/preview` | `post.write` |
| PUT | `/api/admin/posts/:postId` | `post.write` |
| POST | `/api/admin/posts/:postId/status` | `post.publish` |
| DELETE | `/api/admin/posts/:postId` | `post.delete` |

> `/posts/:postId/status` 只切换状态，但会复用保存流程回传完整字段（封面、SEO、模板），
> 否则"仅发布"会静默清空这些字段。内容字段 `fields` 则**刻意省略**（缺省 = 不改动已存值）。
> `/posts/preview` 复用保存/发布**同一条** Markdown 渲染 + 消毒管线，是编辑页预览的权威来源。

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

另有隐藏页 `{ id: 'posts.editor', path: '/posts/editor', permission: 'post.write', hidden: true }`：
只注册路由、不进侧栏（由列表页跳转进入）。

### 后台命名扩展点（1.6.0 新增）

`manifest.extensionPoints` 声明三处后台锚点。本插件只**声明**、不贡献，因此只需 `extensions:declare`
（不需要 `extensions:contribute`）。名字与 `context` 字段是**跨插件约定**，贡献方须按此声明 props：

| 扩展点 | scope | replaceable | context 字段 |
| --- | --- | --- | --- |
| `rice.posts.listActions` | `admin` | 是 | `kind` |
| `rice.posts.editorToolbar` | `admin` | 是 | `kind`、`value`、`onChange`、`onPreview` |
| `rice.posts.editorBody` | `admin` | 是 | `kind`、`value`、`onChange`、`onPreview` |

- `kind` 固定为 `'post'`；`value` 是当前正文（Markdown 字符串）；`onChange(next)` 更新正文；
  `onPreview()` 返回服务端渲染并消毒后的 HTML（`Promise<string>`）。
- 无贡献时渲染默认内容：`listActions` 是「新建文章」按钮，`editorBody` 是普通多行文本域
  （即"停用编辑增强后正文回落为普通文本域"的回退契约）。
- 有 `replace` 贡献时默认内容被整体接管：第三方因此可以替换正文编辑体验。

## 后台界面（插件自带）

界面代码就在本插件目录内，**零构建**（纯 ESM + 模板字符串，不装依赖、不打包）：

| 项 | 值 |
| --- | --- |
| 列表页 | `admin/main.js`（`defineAdminPage` 导出页面组件） |
| 编辑页 | `admin/editor.js`（隐藏路由 `/posts/editor`；`?id=` 编辑，无 id 新建） |
| 标签输入 | `admin/tag-input.js`（纯 UI 组件）、`admin/tag-utils.js`（纯逻辑，可单测） |
| 托管 URL | `/plugin-admin/rice.posts/main.js`、`/plugin-admin/rice.posts/editor.js`（需登录；插件启用时才可取） |
| 菜单声明 | `manifest.json` → `admin.pages[]`：id `posts.list`、路径 `/posts`、图标 `FileText`、权限 `post.view`；以及隐藏页 id `posts.editor`（`hidden: true`，仅注册路由） |
| 依赖 | 仅 `/admin-sdk/v1/ricenote-admin.js`（宿主与插件共用同一份 SDK 与同一份 Vue 实例） |

服务端分页（每页 10）、状态筛选、关键词搜索、删除，以及列表页的权限门控
（`post.write` / `post.publish` / `post.delete`）与迁移前一致。
开发方式与样式可用范围见 `docs/plugin-api/v1.md` 第 16 节与 ADR-014。

### 独立编辑页（1.6.0 新增）

「新建 / 编辑」不再用对话框，而是跳转到隐藏页 `/posts/editor`（新建）与
`/posts/editor?id=<id>`（编辑）；深链与刷新均可用。

- 左栏：元信息卡片（标题、别名、状态、摘要、分类、标签）+ **内容字段区**
  （字段声明来自 `GET /api/admin/content-fields`，值放入 `fields` 对象随保存提交）；
- 右栏：占满剩余视口高度（最小 420px）的正文容器，内含 `rice.posts.editorToolbar`
  与 `rice.posts.editorBody` 两个锚点；默认内容是一致外观的多行文本域；
- 顶栏：「取消」/「创建文章 | 保存」（保存带加载态），失败原因显示在顶栏下方一行；
- 未保存离开保护：有改动时用**既有确认对话框**提示（不使用 `window.confirm`）；
- 预览由本页提供（`preview()` → `POST /posts/preview`），贡献插件通过 `onPreview` 回调使用，
  无需知道端点名。

### 标签输入（输入即创建）

左栏的「标签」改为**一个输入框里选择或输入**：UI 在 `admin/tag-input.js`
（纯组件、不自发请求，全部经回调 props 交给 `editor.js`），纯逻辑在 `admin/tag-utils.js`
（不 import SDK，可单测）。分类保持原来的药丸按钮，两者视觉上分开：

- 已选标签渲染为**胶囊 + 删除按钮**；输入即过滤候选（**忽略大小写与首尾空白**，高亮匹配片段），
  `↑/↓` 移动、`Enter` 选中、`Esc` 或点击组件外部关闭；
- 回车提交自由文本：命中已有标签则直接选中；**未命中且当前用户有 `taxonomy.manage`**
  （administrator / editor）时才 `POST /api/admin/terms { name, type: 'tag' }` 创建后选中；
- **无 `taxonomy.manage` 时不提供创建**（只能选已有标签），输入框给出
  「没有创建标签的权限」一行提示，不产生任何写请求；
- 本地先按名称查重，尽量不白撞服务端的重名判断；万一命中 **409**（服务端只按 slug 判重），
  改为重拉列表并选中那条同名 / 同 slug 的标签，提示「该标签已存在，已选中」——**不算失败**；
  其它错误用 `useToast` 报错；
- 保存仍只提交 `form.termIds`（分类与标签共用一个 id 数组），提交契约未变。

## 设置项（`settingsSchema`，后台自动生成表单）

后台「扩展中心 → 文章 → 设置」。保存后需**重启服务**生效（`ctx.config` 是插件启动期快照）。

### 分组「列表与摘要」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `pageSize` | number（1–50） | `10` | 列表每页文章数 |
| `excerptLength` | number（20–1000） | `160` | 自动摘要长度（未手写摘要时从正文截取） |

> 插件侧会把这两个值再收敛一次（`1–50` / `20–1000`），防止历史脏值让分页查询失效。

## 内容自定义字段（1.5.0 新增）

主题在 `theme.json` 的 `contentFields` 里声明一组**内容自定义字段**（文章与页面
**共用同一份**声明，例如 `featuredImage`）；宿主通过 `core.theme@1` 的
`contentFields()` 把声明交给插件，文章据此保存与展示：

- `rn_posts.fields` 以 JSON 保存**经声明校验归一化**后的键值对；无字段时写 `NULL`；
- 保存时用 `assertContentFieldValues` 按声明白名单校验：**未声明的键会被拒绝**（`VALIDATION_FAILED`/400），
  而不是静默丢弃——否则作者会以为"填了却没生效"；类型不符、越界同样拒绝；
- 读取时用 `pickDeclaredContentFields` 按**当前**声明过滤：换主题后留在库里的旧键
  不再暴露给模板，切回原主题又能恢复展示；
- 模板用 `{{ post.fields.featuredImage }}` 取值；声明不存在或未填写时为空对象，
  `{% if post.fields.featuredImage %}` 自然为假；
- 字段声明在**请求期**读取（不缓存），因此更换主题无需重启即可生效；
- 迁移 `0004_post_fields.sql` 只新增可空列，历史文章保持 `NULL`，渲染行为不变。

## 文章模板（1.2.0 新增）

`rn_posts.template` 保存主题 `pageTemplates` 声明的**模板键**：

- 后台文章编辑可选择版式；服务端校验键必须命中当前主题清单；
- 主题切换后旧键失效时不报错，渲染器回退到 `templates.post`；
- 迁移 `0003_post_template.sql` 只新增可空列，历史文章行为不变。

## 依赖与启停

- `identity.users@1` 为硬依赖：identity 被禁用时本插件会被依赖解析排除（`FAILED`）；
- taxonomy / media / search 为软依赖：缺失时对应功能静默降级（不报错、不 500）。
