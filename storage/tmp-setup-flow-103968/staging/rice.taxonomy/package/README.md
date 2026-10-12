# rice.taxonomy —— 分类与标签

统一的词条体系：分类与标签共用一张词条表，并通过关联表与文章建立多对多关系。

> 归档页面（`/category/:slug`、`/tag/:slug`）**由 posts 提供**，
> 本插件只提供词条数据与"文章↔词条"的关联维护能力。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.taxonomy` |
| version | `1.1.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `content.taxonomy@1`、`taxonomy.internal@1` |
| requires | 无 |
| capabilities | `database:own`、`services:provide`、`services:consume`、`routes:admin` |
| migrations | `0001_taxonomy.sql` |
| 数据表 | `rn_terms`、`rn_term_relations` |

## 扩展点（Hook）

### 管理 API

| 方法 | 路径 | 权限点 |
| --- | --- | --- |
| GET | `/api/admin/terms` | `post.view` |
| POST | `/api/admin/terms` | `taxonomy.manage` |
| DELETE | `/api/admin/terms/:termId` | `taxonomy.manage` |

### 服务契约（提供）

- `content.taxonomy@1`（面向所有插件 / 后台）：`list` / `listWithCounts` / `findBySlug` /
  `save` / `remove` / `termsOfPost`
- `taxonomy.internal@1`（**官方插件间约定**）：`setPostTerms` / `clearPostTerms` /
  `termIdsOfPost` / `postIdsOfTerm`

> 两个契约分离的原因：`taxonomy.internal@1` 是 posts 保存文章时**双向协作**用的写接口
> （避免 posts 直接写别人的表）。第三方插件如需同类能力应使用 `content.taxonomy@1`。

### 服务契约（消费）

`core.setup@1`（必需）：取 `siteId()` 作为数据分区键。

### 事件 / 插槽

无。

### 后台界面

界面文件位于 `admin/main.js`：**零构建纯 ESM**（不安装依赖、不打包，模板即字符串），
组件（Card/Button/Dialog/Select/Input/Textarea/Field/Icon…）已由宿主全局注册，
依赖只来自 `/admin-sdk/v1/ricenote-admin.js`。

菜单与入口由 `manifest.json` 的 `admin.pages` 声明式提供，Core 负责注册菜单、
托管界面文件并计算前端入口 URL（无需插件再调用 `ctx.adminMenu.add`）：

`{ id: 'taxonomy.terms', label: '分类与标签', path: '/taxonomy', icon: 'Tags', order: 15, permission: 'post.view' }`

- 入口 URL：`/plugin-admin/rice.taxonomy/main.js`
- 访问权限：页面读取需 `post.view`；新建 / 编辑 / 删除词条需 `taxonomy.manage`

## 数据模型

| 表 | 说明 |
| --- | --- |
| `rn_terms` | 词条：`type` 为 `category` 或 `tag`，`(site_id, slug)` 唯一 |
| `rn_term_relations` | 文章↔词条关联，仅保存两者的 ID |

**不对其他插件的表建外键**（说明书第 8 章）：文章是否存在由 posts 保证，
词条删除时同步清理关联记录。

## 设置项

无（该插件没有可配置项）。

## 依赖与启停

- 可独立启停；
- 禁用后：posts 的归档页降级为"词条不可用"提示，文章编辑里的词条选择消失
  （`tryUse` 返回 `undefined`，静默降级）；
- 词条数据保留在库中，重新启用即恢复。
