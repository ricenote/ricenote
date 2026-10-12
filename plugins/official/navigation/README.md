# rice.navigation —— 导航栏

站点的**顶部导航栏**：把「自定义链接 / 页面 / 文章」编排成有序导航项，
通过 `header.navigation` 插槽输出到前台，并在后台提供独立管理页。

> 为什么单独做一个插件：导航栏是"出现在每个页面上的全局展示"，
> 而页面与文章的知识只属于各自的内容插件。把「哪些内容进导航、第几位、显示什么文案」
> 收进一个统一入口，才能避免两个插件往同一个插槽写重复链接、顺序无人协调。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.navigation` |
| version | `1.2.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `content.navigation@1` |
| requires | 无（pages / posts 是**可选**依赖：未启用时自定义链接照常工作） |
| capabilities | `database:own`、`services:provide`、`services:consume`、`routes:admin`、`events:subscribe`、`slots:register`、`admin:menu` |
| migrations | `./migrations`（`0001_navigation.sql`） |
| 数据表 | `rn_nav_items` |

## 扩展点（Hook）

### 插槽

| 插槽 | 组件名 | 优先级 | 输出 |
| --- | --- | --- | --- |
| `header.navigation` | `navigation.header` | 20 | 每项一个 `<a href class="rn-nav-link">文案</a>` |

标记约定（与旧版 `rice.pages` 的输出**完全一致**，主题无需改动）：

```html
<a href="/page/about" class="rn-nav-link rn-nav-link--active" aria-current="page">关于</a>
<a href="https://example.com" class="rn-nav-link" target="_blank" rel="noopener noreferrer">外部站点</a>
```

- 当前项判定（`aria-current="page"` + `rn-nav-link--active`）由本插槽负责，
  两套官方主题据此高亮，**主题不应自己计算**；
- `target="_blank"` 一定带 `rel="noopener noreferrer"`；
- 未启用、目标未发布、目标已被删除的项**不输出**（前台永远不会出现死链）。

### 管理 API

| 方法 | 路径 | 权限点 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/navigation/items` | `nav.view` | 全部导航项（含停用），附目标解析状态 |
| GET | `/api/admin/navigation/targets` | `nav.view` | 目标候选项（`?type=page\|post&keyword=`，只列已发布内容） |
| POST | `/api/admin/navigation/items` | `nav.manage` | 新建（追加到末尾） |
| PUT | `/api/admin/navigation/items/:itemId` | `nav.manage` | 更新（文案 / 目标 / 新窗口 / 启用） |
| POST | `/api/admin/navigation/items/:itemId/move` | `nav.manage` | 上移/下移一位，返回重排后的完整列表 |
| DELETE | `/api/admin/navigation/items/:itemId` | `nav.manage` | 删除 |

### 服务契约（提供）

`content.navigation@1`：

```ts
listRenderable()                        // 前台：可直接渲染的项（已启用 + 目标可解析，已按 maxItems 截断）
listForAdmin()                          // 后台：全部项 + 目标状态（exists / published / title / url）
save({ id?, payload })                  // 新建或更新
remove(id)                              // 删除
move({ id, direction })                 // 上移/下移，返回重排后的列表
targets({ type, keyword? })             // 选择器候选项（只含已发布内容）
```

其他插件通常**不需要**直接调用它：让本插件渲染插槽即可。
确需自行渲染（例如换一种标记结构）时才读该服务。

### 服务契约（消费）

| 契约 | 必需性 | 用途 |
| --- | --- | --- |
| `core.setup@1` | 必需 | 取 `siteId()` 作为数据分区键 |
| `core.html@1` | 必需 | 输出链接前转义文案与地址 |
| `core.theme@1` | 必需 | 导航变化后 `clearCache()`（导航出现在每个页面上，按标签失效覆盖不到） |
| `content.pages@1` | 可选 | 解析页面引用（`navItems()` / `findForAdmin()` / `listForAdmin()`） |
| `content.posts@1` | 可选 | 解析文章引用（`publishedRefs()` / `titlesOf()` / `listPublished()` / `searchPublished()`） |

### 事件（订阅）

| 事件 | 用途 |
| --- | --- |
| `core.runtime.started.v1` | 上报就绪状态；存在"目标失效"的导航项时给出告警 |
| `content.pages.changed.v1` / `content.pages.deleted.v1` | 页面变化 → 若被导航引用则清 HTML 缓存 |
| `content.post.published.v1` / `content.post.updated.v1` / `content.post.unpublished.v1` / `content.post.deleted.v1` | 文章变化 → 若被导航引用则清 HTML 缓存 |

> 只在"该内容确实被某个已启用导航项引用"时才清缓存（`referencesContent()` 判定），
> 否则每次保存文章都会清空全站 HTML 缓存。

### 后台菜单

`{ id: 'navigation.items', label: '导航栏', path: '/navigation', icon: 'Navigation', order: 18, permission: 'nav.view' }`

## 后台界面（插件自带）

界面代码就在本插件目录内，**零构建**（纯 ESM + 模板字符串，不装依赖、不打包）：

| 项 | 值 |
| --- | --- |
| 入口 | `admin/main.js`（`defineAdminPage` 导出页面组件） |
| 托管 URL | `/plugin-admin/rice.navigation/main.js`（需登录；插件启用时才可取） |
| 菜单声明 | `manifest.json` → `admin.pages[]`：id `navigation.items`、路径 `/navigation`、图标 `Navigation`、权限 `nav.view` |
| 依赖 | 仅 `/admin-sdk/v1/ricenote-admin.js`（宿主与插件共用同一份 SDK 与同一份 Vue 实例） |

由后台通用宿主加载：有加载态、出错可重试、插件未启用时给出"由插件提供"的提示。
开发方式、组件清单与样式可用范围见 `docs/plugin-api/v1.md` 第 16 节与 ADR-014。

## 设置项（settingsSchema）

后台「扩展中心 → 导航栏 → 设置」。保存后需**重启服务**生效。

### 分组「通用」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `maxItems` | number（1–50） | `10` | 前台最多渲染多少项（超出部分按后台顺序截断，防止导航被塞爆） |

## 数据表

`rn_nav_items`（表所有权归本插件）：

| 列 | 说明 |
| --- | --- |
| `item_type` | `custom` / `page` / `post` |
| `label` | 展示文案；`custom` 必填，`page`/`post` 可留空以跟随目标标题 |
| `href` | `custom` 的地址（站内路径或 http(s) 地址） |
| `ref_id` | `page` / `post` 引用的内容 ID（**不建外键、不冗余标题**） |
| `new_tab` / `enabled` | 是否新窗口打开 / 是否启用 |
| `sort_order` | 顺序（间隔 10；重排时整体重编号） |

**引用而非快照**：`page` / `post` 项只保存 ID，标题与地址在读取时解析 ——
页面改名、改别名后导航自动跟随；标题被删除后该项自动不显示，后台给出提示。

## 安全要点

- **地址白名单**：只接受以 `/` 开头的站内路径与 `http(s)://` 绝对地址；
  `javascript:`、`data:`、`vbscript:`、`mailto:`、相对路径与协议相对地址（`//evil.com`）
  一律拒绝（校验在 `src/nav.ts`，有专门的单元测试）；
- 链接文案与地址输出前都经 `core.html@1` 的 `escape()`；
- 外链固定带 `rel="noopener noreferrer"`；
- 目标 ID 必须真实存在才会被保存（内容插件被禁用时跳过校验并记为警告日志）；
- 写入权限点为 `nav.manage`，读取为 `nav.view`；所有写操作经 Core 守卫的
  认证 → CSRF → 权限 → 审计链路。

## 依赖与启停

- 无插件级硬依赖。pages / posts 被禁用时，引用类导航项全部视为"未解析"
  （前台跳过、后台提示"目标不存在"），自定义链接照常工作；
- 禁用后：导航插槽、管理 API、`content.navigation@1`、后台菜单全部注销，
  前台导航栏变空（主题里的首页等内置入口不受影响），数据保留在库中；
- 重新启用后导航项自动恢复（`ref_id` 未变，目标插件重新可用即可解析）。
