# rice.pages —— 页面

为站点提供**独立页面**：创建「关于我们」「联系方式」「隐私政策」这类固定内容页，
拥有自己的地址 `/page/:slug`，并可通过主题声明的**页面模板**选择版式。

> 与 `rice.posts` 的区别：页面不参与分类/标签与列表归档，也不出现在首页列表里；
> 它是一块"固定地址的独立内容"，可选用主题提供的版式（标准 / 落地页 / 窄栏阅读等）。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.pages` |
| version | `1.5.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `content.pages@1` |
| requires | 无（Core 提供的 `core.html@1` / `core.theme@1` / `core.setup@1` 不计入 `requires`，它们先于所有插件注册） |
| capabilities | `database:own`、`services:provide`、`services:consume`、`routes:public`、`routes:admin`、`events:publish`、`events:subscribe`、`slots:register`、`extensions:declare` |
| migrations | `./migrations`（`0001_pages.sql`、`0002_page_fields.sql`） |
| 数据表 | `rn_pages` |

## 扩展点（Hook）

### 公开页面路由

| name | path | kind | 说明 |
| --- | --- | --- | --- |
| `page.show` | `/page/:slug` | `page` | 按别名渲染已发布页面；未找到或非发布状态时返回主题的 404 模板 |

渲染时会：
1. 把内容放进模板变量 `content`（`title` / `html` / `slug` / `url` / `fields` / `updatedAt` / `template`）；
2. 若页面选择了模板键，则把该键作为 `PageViewModel.template` 交给 Core 渲染器解析；
   键在当前主题下不存在时**优雅回退**到主题的 `templates.page`（不报 500）。

### 管理 API

| 方法 | 路径 | 权限点 |
| --- | --- | --- |
| GET | `/api/admin/pages` | `page.view` |
| GET | `/api/admin/pages/:pageId` | `page.view` |
| POST | `/api/admin/pages` | `page.manage` |
| PUT | `/api/admin/pages/:pageId` | `page.manage` |
| DELETE | `/api/admin/pages/:pageId` | `page.manage` |
| POST | `/api/admin/pages/preview` | `page.manage` |

`POST /pages/preview` 是**正文预览的唯一权威来源**：请求体 `{ content }`，返回 `{ data: { html } }`，
走的是与保存/发布**完全同一条管线**（Markdown 渲染 → 消毒）。编辑器若自己实现一套预览，
必然与前台出现差异，作者会怀疑"保存后变了样"，因此贡献者应调用编辑页提供的 `onPreview()`。

权限与保存一致（`page.manage`）：预览会把**未保存的正文**渲染出来，若放开给只读用户，
等于让他们绕过"谁能写"的边界。

### 后台扩展点（对外声明）

插件声明三个 `admin` 作用域的锚点（`capabilities` 里的 `extensions:declare` 是前提）。
其它插件通过清单 `contributions`（或 `ctx.extensions`）贡献浏览器模块为 `.js` 入口，
后台的 `<PluginSlot>` 负责渲染；宿主 `/api/admin/extensions` 会按"插件已启用 + 权限"过滤后再下发。

| 扩展点 | 位置 | 默认内容 | context 字段 |
| --- | --- | --- | --- |
| `rice.pages.listActions` | 列表页操作按钮区 | 「新建页面」按钮 | `kind` |
| `rice.pages.editorToolbar` | 编辑页正文工具栏 | 无（默认不渲染任何内容） | `kind` / `value` / `onChange` / `onPreview` |
| `rice.pages.editorBody` | 编辑页正文输入区 | 多行文本域 | `kind` / `value` / `onChange` / `onPreview` |

- `kind` 恒为 `page`（与文章侧的同名锚点保持一致，贡献者据此复用同一份界面代码）；
- `value` 是当前正文（Markdown 原文）；`onChange(markdown)` 改写正文；
- `onPreview()` 请求服务端渲染预览，**返回已消毒的 HTML**（`Promise<string>`），
  **展示方式由消费方决定**（编辑增强用自己的 Dialog），贡献者不需要知道预览接口地址；
- `replaceable: true`：`replace` 贡献可整体接管默认内容（富文本编辑器接管 `editorBody` 即是此用法）。

契约承诺：**停用编辑器增强后正文输入仍然可用**（`editorBody` 的默认内容就是文本域），
裁决（replace 胜出 / append 按 order 降序）由宿主统一执行，插件停用即贡献消失。

### 服务契约（提供）

`content.pages@1`：

```ts
listPublished({ page, pageSize })      // 前台：已发布页面
findPublishedBySlug(slug)              // 前台：按别名取详情（含消毒后的 HTML）
navItems()                             // 已发布页面清单（id / title / slug / url），供导航等引用方解析目标
listForAdmin(query) / findForAdmin(id) // 后台列表与详情
save({ id?, authorId?, payload })      // 新建或更新
remove(id)                             // 删除
countByStatus()                        // 统计（仪表盘）
```

### 服务契约（消费）

| 契约 | 用途 |
| --- | --- |
| `core.setup@1` | 取站点标识 `siteId()` 作为数据分区键 |
| `core.html@1` | 正文消毒（`sanitize`）；Markdown 渲染结果**必须**经此处理后才落库 |
| `core.theme@1` | 读取当前主题声明的模板清单 `pageTemplates()`；内容变更后失效 HTML 缓存 |

### 插槽

**无。** 本插件不注册任何**前台渲染**插槽；对外声明的三个后台锚点见上文「后台扩展点」。

顶部导航栏由 `rice.navigation` 独占（它才是 `header.navigation` 的注册者）。
页面只是"可作为导航项的一种来源"：在后台「导航栏」里引用某个页面，
它才会出现在前台导航里。这样做的原因：

- 两个插件同时往同一个插槽写链接会出现重复内容，而且顺序无从协调；
- "哪些内容进导航、第几位、显示什么文案"属于站点结构，需要一个统一的编排入口。

### 事件

| 事件 | 时机 | 载荷 |
| --- | --- | --- |
| `content.pages.changed.v1` | 页面新建或更新后 | `{ pageId, slug, status }` |
| `content.pages.deleted.v1` | 页面删除后 | `{ pageId, slug }` |

订阅：`core.runtime.started.v1`（用于在全部插件就绪后上报模板清单与告警）。

### 后台菜单

`{ id: 'pages.list', label: '页面', path: '/pages', icon: 'FileStack', order: 15, permission: 'page.view' }`

## 后台界面（插件自带）

界面代码就在本插件目录内，**零构建**（纯 ESM + 模板字符串，不装依赖、不打包）：

| 项 | 值 |
| --- | --- |
| 入口 | `admin/main.js`（`defineAdminPage` 导出页面组件） |
| 托管 URL | `/plugin-admin/rice.pages/main.js`（需登录；插件启用时才可取） |
| 菜单声明 | `manifest.json` → `admin.pages[]`：id `pages.list`、路径 `/pages`、图标 `FileStack`、权限 `page.view` |
| 依赖 | 仅 `/admin-sdk/v1/ricenote-admin.js`（宿主与插件共用同一份 SDK 与同一份 Vue 实例） |
| 编辑页 | `admin/editor.js`（隐藏页，路由 `/pages/editor`，见下文「独立编辑页」） |

列表页保留列表、筛选与状态/模板展示；**编辑已移入独立编辑页** —— 正文区要占满视口、
要容纳外部插件贡献的编辑器、还要做未保存保护，弹窗承载不了。
模板下拉的可选项来自**当前主题声明**的 `pageTemplates`（主题未声明时只有"跟随主题默认"）。
开发方式与样式可用范围见 `docs/plugin-api/v1.md` 第 16 节与 ADR-014。

## 独立编辑页

`admin/editor.js` 是**独立**的编辑页，路由 `/pages/editor`（`?id=` 表示编辑既有页面）：

- 在 `manifest.admin.pages` 里声明为 `hidden: true`：只注册路由（深链、刷新、书签都可用），
  不出现在侧栏；列表页的「新建 / 编辑」用 `router.push` 跳进来；
- 左栏是元信息卡片（标题、别名、状态、页面模板、排序、SEO 标题/描述）与**内容字段区**：
  直接用 admin-sdk 的共享组件 `<ContentFields v-model="fields" />` —— 它自己按当前主题声明取数
  （模块级缓存、无声明时什么都不渲染），与文章编辑页是同一份实现，因此两页的字段控件
  天然一致；值随保存放进 `fields` 提交，未声明的键由服务端拒绝保存；
- 右栏是占满剩余视口高度（最小 420px）的正文区，内含两个锚点：
  `rice.pages.editorToolbar`（工具栏）与 `rice.pages.editorBody`（正文输入区）；
- 顶栏是标题 +「取消 / 创建|保存」，保存带加载态，失败原因显示在顶栏下方一行；
- **未保存离开保护**：有改动时点「取消」，或被侧栏/浏览器后退带走，都会弹出确认对话框
  （不使用 `window.confirm`）。

预览由本页提供（`POST /pages/preview`，返回已消毒的 HTML），**展示交给调用方**（编辑增强有自己的
Dialog），因此编辑页自身不弹预览框，避免叠出两个。

## 设置项（settingsSchema）

| 分组 | 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `general` | `listPageSize` | number (1–100) | `20` | 后台列表每页条数 |
| `general` | `cacheEnabled` | boolean | `true` | 是否为页面渲染启用 HTML 缓存（关闭便于调试主题） |

修改设置后需要**重启服务**生效（插件配置在启动时读取，见 ADR-004）；
后台保存后顶栏会出现「重启」按钮。

## 页面模板（主题侧）

主题在 `theme.json` 中声明可选模板清单，页面编辑时即可下拉选择：

```json
{
  "templates": { "page": "page.njk" },
  "pageTemplates": {
    "default": { "template": "page.njk",        "label": "标准页面" },
    "plain":   { "template": "page-plain.njk",  "label": "落地页（无标题）" },
    "narrow":  { "template": "page-narrow.njk", "label": "阅读版式（窄栏）" }
  }
}
```

- 页面保存的 `template` 存的是**键**（如 `narrow`），不是文件名：主题换文件名不会让旧数据失效；
- 保存时服务端会校验键是否在当前主题的清单内，不在则拒绝并返回可选值；
- `templates.page` 是未选择模板（或键失效）时的兜底模板。

## 内容自定义字段（主题侧）

主题在 `theme.json` 中声明一组内容字段，**文章与页面共用同一份**（例如特色图片）：

```json
{
  "contentFields": {
    "featuredImage": { "type": "image", "label": "特色图片" }
  }
}
```

- 声明来自当前激活主题（`core.theme@1` 的 `contentFields()`），页面保存时据此校验；
- **只接受声明的键**：提交未声明的键、类型不符或越界都会返回 400 并拒绝保存（fail-closed），
  而不是"静默丢弃后假装成功"；
- 空字符串 / 空数组视为"未填写"，不会写进字段值（模板里 `{% if page.fields.x %}` 自然为假）；
- 模板中读取 `{{ page.fields.featuredImage }}`：`fields` 始终是对象（可能为空），无需判空；
- **读取按声明过滤**：换主题后旧键仍留在数据库里，但不再出现在后台响应与模板上下文中。

## 依赖与启停

- 无插件级依赖，可独立启用/禁用；
- 禁用后：页面路由、管理 API、`content.pages@1` 契约、后台菜单**全部注销**
  （由 Core 的句柄回收机制保证，测试中以 `assertNoLeaks()` 断言）；
- 禁用时若 `rice.navigation` 里有引用页面的导航项，那些项会变成"目标不存在"
  （前台跳过、后台提示），重新启用后自动恢复，无需重建导航。
