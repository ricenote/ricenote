# rice.friend-links —— 友情链接

管理站点的友情链接（名称 / 地址 / 头像 / 描述 / 排序 / 启用），并在前台提供 `/links`
页面把友链列表交给主题渲染。

> 本插件**不提供任何跨插件服务契约**：友链是"给主题看"的数据，
> 而主题读不到服务契约——它通过 `/links` 页面注入的 `data.friendLinks` 取数。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.friend-links` |
| version | `1.1.1` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | 无 |
| requires | 无 |
| capabilities | `database:own`、`services:consume`、`routes:public`、`routes:admin` |
| migrations | `./migrations` |
| 数据表 | `rn_friend_links` |

## 扩展点（Hook）

### 公开页面路由

| 路由名 | 路径 | kind | 缓存标签 |
| --- | --- | --- | --- |
| `links` | `/links` | `links` | `friend-links` |

### 后台菜单与界面

`manifest.admin.pages` 声明一项：

```json
{ "id": "friend-links.list", "label": "友情链接", "path": "/friend-links",
  "icon": "Link", "order": 19, "permission": "link.view", "entry": "./admin/main.js" }
```

### 管理 API

前缀 `/api/admin`，全部经 Core 守卫的 认证 → CSRF → 权限 → 审计：

| 方法 | 路径 | 权限点 | 说明 |
| --- | --- | --- | --- |
| GET | `/friend-links/items` | `link.view` | 全部友链（含停用） |
| POST | `/friend-links/items` | `link.manage` | 新建 |
| PUT | `/friend-links/items/:linkId` | `link.manage` | 更新 |
| DELETE | `/friend-links/items/:linkId` | `link.manage` | 删除 |

### 服务契约（消费）

| 契约 | 必需性 | 用途 |
| --- | --- | --- |
| `core.setup@1` | 必需 | 站点标识 |
| `core.theme@1` | 必需 | 友链变化后失效 `/links` 的 HTML 缓存 |

### 插槽 / 事件

无（本插件不注册插槽，也不订阅事件）。

## 主题用法

主题需要在 `theme.json` 的 `templates` 里声明该 kind 对应的模板文件：

```json
{ "templates": { "links": "links.njk" } }
```

然后在 `templates/links.njk` 里直接遍历顶层变量 `friendLinks`：

```njk
{% for link in friendLinks %}
  <a class="friend-link" href="{{ link.url }}" target="_blank" rel="noopener">
    {% if link.avatarUrl %}<img src="{{ link.avatarUrl }}" alt="{{ link.name }}">{% endif %}
    <strong>{{ link.name }}</strong>
    <span>{{ link.description }}</span>
  </a>
{% endfor %}
```

元素形状（`data.friendLinks` 的每一项）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 友链名称 |
| `url` | string | 完整地址（已校验为 `http(s)://`） |
| `avatarUrl` | string | 头像地址；未填写为空串，由主题自行回退占位 |
| `description` | string | 描述；未填写为空串 |

> 未声明 `templates.links` 的主题不会报错：模板回退链会落到该主题的 `fallback.njk`。
> 页脚与导航栏**不受本插件影响**——需要入口时，用 `rice.navigation` 添加一条指向
> `/links` 的自定义链接即可。

## 数据表

`rn_friend_links`（迁移 `migrations/0001_friend_links.sql`）：

| 列 | 说明 |
| --- | --- |
| `id` / `site_id` | 主键 / 站点分区 |
| `name` | 名称（≤120，必填） |
| `url` | 地址（≤500，必填，必须 `http(s)://`） |
| `avatar_url` | 头像（≤500，可空；完整地址或 `/uploads/…`、`/media/…`） |
| `description` | 描述（≤300，可空） |
| `sort_order` | 排序，数值越小越靠前（新建追加到末尾） |
| `enabled` | 启用；停用后前台不展示但数据保留 |
| `created_at` / `updated_at` | 时间戳 |

索引：`(site_id, sort_order, id)`、`(site_id, enabled)`。

不持有其他插件的表，也不建跨插件外键。

## 设置项

无（`settingsSchema` 未声明）。启停与排序都由数据本身决定，不需要额外配置。

## 依赖与启停

- 可独立启停，无必需依赖；
- 禁用后：`/links` 页面与后台菜单消失（路由由 Core 注销），数据保留在库中；
- 重新启用后链接自动恢复，无需重建。
