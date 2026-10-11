# rice.pages —— 页面

为站点提供**独立页面**：创建「关于我们」「联系方式」「隐私政策」这类固定内容页，
拥有自己的地址 `/page/:slug`，并可通过主题声明的**页面模板**选择版式。

> 与 `rice.posts` 的区别：页面不参与分类/标签与列表归档，也不出现在首页列表里；
> 它是一块"固定地址的独立内容"，可选用主题提供的版式（标准 / 落地页 / 窄栏阅读等）。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.pages` |
| version | `1.1.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `content.pages@1` |
| requires | 无（Core 提供的 `core.html@1` / `core.theme@1` / `core.setup@1` 不计入 `requires`，它们先于所有插件注册） |
| capabilities | `database:own`、`services:provide`、`services:consume`、`routes:public`、`routes:admin`、`events:publish`、`events:subscribe`、`slots:register`、`admin:menu` |
| migrations | `./migrations`（`0001_pages.sql`） |
| 数据表 | `rn_pages` |

## 扩展点（Hook）

### 公开页面路由

| name | path | kind | 说明 |
| --- | --- | --- | --- |
| `page.show` | `/page/:slug` | `page` | 按别名渲染已发布页面；未找到或非发布状态时返回主题的 404 模板 |

渲染时会：
1. 把内容放进模板变量 `content`（`title` / `html` / `slug` / `url` / `updatedAt` / `template`）；
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

**无。** 本插件不注册任何插槽。

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

列表、筛选、抽屉式编辑、状态与模板选择等能力与迁移前一致；模板下拉的可选项来自
**当前主题声明**的 `pageTemplates`（主题未声明时只有"跟随主题默认"）。
开发方式与样式可用范围见 `docs/plugin-api/v1.md` 第 16 节与 ADR-014。

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

## 依赖与启停

- 无插件级依赖，可独立启用/禁用；
- 禁用后：页面路由、管理 API、`content.pages@1` 契约、后台菜单**全部注销**
  （由 Core 的句柄回收机制保证，测试中以 `assertNoLeaks()` 断言）；
- 禁用时若 `rice.navigation` 里有引用页面的导航项，那些项会变成"目标不存在"
  （前台跳过、后台提示），重新启用后自动恢复，无需重建导航。
