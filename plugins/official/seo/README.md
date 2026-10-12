# rice.seo —— SEO

为前台页面注入元信息（title / description / canonical / Open Graph / Twitter Card / JSON-LD），
并提供 `sitemap.xml` 与 `robots.txt`。

> 本插件**不持有数据表、不提供任何服务契约**：它只消费已有数据与主题信息。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.seo` |
| version | `1.2.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | 无 |
| requires | 无 |
| capabilities | `routes:public`、`services:consume`、`slots:register` |
| migrations | 无 |
| 数据表 | 无 |

## 扩展点（Hook）

### 插槽

| 插槽 | 组件名 | 说明 |
| --- | --- | --- |
| `head.end` | `seo.meta` | 输出 `<meta>`、`<link rel="canonical">`、`og:*`、`twitter:*` 与 JSON-LD |

主题侧只需在 `<head>` 末尾写：

```njk
{{ slot('head.end') }}
```

> canonical 与 description 由主题自己输出基础值，本插槽负责**补充与覆盖**
> （例如文章页的 OG 图、结构化数据）。

### 原始路由（公开）

| 方法 | 路径 | 注册条件 |
| --- | --- | --- |
| GET | `/sitemap.xml` | `settings.enableSitemap` 为真 |
| GET | `/robots.txt` | `settings.enableRobots` 为真 |

### 服务契约（消费）

| 契约 | 必需性 | 用途 |
| --- | --- | --- |
| `core.html@1`、`core.theme@1` | 必需 | HTML 转义与站点/主题信息 |
| `content.posts@1` | 可选 | sitemap 需要文章列表 |

### 事件 / 后台菜单 / 管理 API

无。

## 设置项（`settingsSchema`，后台自动生成表单）

后台「扩展中心 → SEO → 设置」。保存后需**重启服务**生效（`ctx.config` 是插件启动期快照）。

### 分组「分享与结构化数据」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enableOpenGraph` | boolean | `true` | 输出 `og:*` |
| `enableTwitterCard` | boolean | `true` | 输出 `twitter:*` |
| `twitterSite` | text | `""` | 例如 `@ricenote` |
| `defaultOgImage` | text | `""` | 无封面时的默认分享图（`/uploads/...` 或绝对 URL） |
| `enableJsonLd` | boolean | `true` | 输出 JSON-LD 结构化数据 |

### 分组「站点地图与 robots.txt」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enableSitemap` | boolean | `true` | 注册 `/sitemap.xml` |
| `enableRobots` | boolean | `true` | 注册 `/robots.txt` |
| `sitemapMaxUrls` | number（1–50000） | `1000` | sitemap 最多输出的 URL 数 |
| `sitemapPageSize` | number（1–100） | `50` | 逐页拉取文章的分页大小 |
| `robotsDisallow` | stringList（≤20 项） | `["/admin","/api"]` | `robots.txt` 的 Disallow 前缀，表单里每行一项 |

> 关闭 `enableSitemap` / `enableRobots` 后对应路由**不会注册**，
> 因此启用后必须重启进程才会生效（路由在插件启动时注册）。

## 依赖与启停

- 可独立启停；
- 禁用后：`head.end` 插槽为空片段，`/sitemap.xml` 与 `/robots.txt` 消失；
- posts 不可用时 sitemap 只输出静态页（首页），不报错。
