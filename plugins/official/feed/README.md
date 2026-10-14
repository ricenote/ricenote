# rice.feed —— RSS 订阅

为站点提供标准 **RSS 2.0** 订阅源 `/feed.xml`，读者用任意 RSS 阅读器即可订阅最新文章；
同时在页面 `<head>` 注入自动发现链接，把站点地址粘进阅读器也能找到订阅源。

> 本插件**不持有数据表、不提供任何服务契约**：它只消费 `content.posts@1` 的已发布文章与站点信息。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.feed` |
| version | `1.1.1` |
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
| `head.end` | `feed.discovery` | 输出 `<link rel="alternate" type="application/rss+xml">` |

主题侧无需改动——两套官方主题的 `layout.njk` 已在 `<head>` 末尾调用：

```njk
{{ slot('head.end') }}
```

### 原始路由（公开）

| 方法 | 路径 | 注册条件 |
| --- | --- | --- |
| GET | `/feed.xml` | `settings.enableFeed` 为真 |

响应头由本插件自行设置：`content-type: application/rss+xml; charset=utf-8`，
`cache-control: public, max-age=<cacheMaxAge>`（`cacheMaxAge` 为 0 时输出 `no-cache`）。
原始路由**不经过主题渲染与 HTML 缓存**，因此不占用缓存内存。

### 服务契约（消费）

| 契约 | 必需性 | 用途 |
| --- | --- | --- |
| `core.html@1` | 必需 | 自动发现链接的属性转义 |
| `content.posts@1` | 可选 | 订阅条目来源；缺失时降级为空订阅源 |

### 事件 / 后台菜单 / 管理 API

无。

## 订阅内容

- 只收录**已发布**文章（走 `content.posts@1` 的 `listPublished`，草稿与归档不会出现）；
- 按发布时间倒序，条数由 `itemLimit` 控制；
- 每条包含 `<title>`、`<link>`、`<guid isPermaLink="true">`、`<pubDate>`（RFC 822 / GMT）、
  `<category>`（分类与标签名）与 `<description>`；
- `<description>` 默认是摘要（截断到 500 字），开启「输出正文全文」后为该文章的渲染结果。
  全文模式会对每条文章多查一次数据库，条数受 `itemLimit` 上限 100 约束。

文章链接按前台约定拼接为 `<站点地址>/post/<slug>`（`PostSummary` 不携带 url 字段）。

## 设置项（`settingsSchema`，后台自动生成表单）

后台「扩展中心 → RSS 订阅 → 设置」。保存后需**重启服务**生效（`ctx.config` 是插件启动期快照）。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enableFeed` | boolean | `true` | 是否提供订阅地址；关闭后路由与自动发现链接都不注册 |
| `itemLimit` | number（1–100） | `20` | 订阅最多输出多少篇最新文章 |
| `fullText` | boolean | `false` | 输出正文全文（关闭时只输出摘要） |
| `cacheMaxAge` | number（0–86400） | `1800` | 阅读器与浏览器的缓存时间（秒） |

## 依赖与启停

- 可独立启停，无必需依赖；
- 禁用后：`head.end` 不再输出自动发现链接，`/feed.xml` 消失；
- posts 不可用时：`/feed.xml` 仍返回结构合法的订阅源，只是不含任何条目（记一条 info 日志），
  而不是报错——保证插件可以任意顺序启停。
