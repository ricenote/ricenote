# rice.seo —— SEO

为前台页面注入元信息（title / description / canonical / Open Graph / Twitter Card / JSON-LD），
并提供 `sitemap.xml` 与 `robots.txt`。

> 本插件**不持有数据表、不提供任何服务契约**：它只消费已有数据与主题信息。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.seo` |
| version | `1.0.0` |
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

## 设置项（旧写法 `settings`）

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enableOpenGraph` | `true` | 输出 `og:*` |
| `enableTwitterCard` | `true` | 输出 `twitter:*` |
| `twitterSite` | `""` | 例如 `@ricenote` |
| `enableJsonLd` | `true` | 输出 JSON-LD 结构化数据 |
| `defaultOgImage` | `""` | 无封面时的默认分享图 |
| `enableSitemap` | `true` | 注册 `/sitemap.xml` |
| `enableRobots` | `true` | 注册 `/robots.txt` |
| `sitemapMaxUrls` | `1000` | sitemap 最多输出的 URL 数 |
| `sitemapPageSize` | `50` | 逐页拉取文章的分页大小 |
| `robotsDisallow` | `["/admin","/api"]` | `robots.txt` 的 Disallow 前缀 |

> 关闭 `enableSitemap` / `enableRobots` 后对应路由**不会注册**，
> 因此启用后必须重启进程才会生效（路由在插件启动时注册）。

## 依赖与启停

- 可独立启停；
- 禁用后：`head.end` 插槽为空片段，`/sitemap.xml` 与 `/robots.txt` 消失；
- posts 不可用时 sitemap 只输出静态页（首页），不报错。
