# rice.search —— 搜索

全站搜索：提供可搜索数据源注册契约 `content.search@1` 与 `/search` 页面，
跨内容类型聚合并做全局分页。

> **零外部依赖**：不引入 Meilisearch / Elasticsearch，字符级检索由各数据源自行实现
> （posts 使用 MySQL FULLTEXT with ngram parser，短词回退 LIKE）。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.search` |
| version | `1.0.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `content.search@1` |
| requires | 无 |
| capabilities | `services:provide`、`routes:public`、`events:subscribe` |
| migrations | 无 |
| 数据表 | **无**（本插件不持有任何表，也不查询其他插件的表） |

## 扩展点（Hook）

### 公开页面路由

| name | path | kind | cacheable |
| --- | --- | --- | --- |
| `search` | `/search` | `search` | **false**（结果随关键词变化，不做 HTML 缓存） |

模板变量：`keyword`、`results`（聚合结果）、`sources`（参与检索的数据源）、`pagination`。

### 服务契约（提供）

`content.search@1`：

```ts
registerSource(source): () => void             // 数据源拥有者主动注册，返回注销句柄
unregisterSource(id): void                     // 幂等；插件 stop 阶段必须调用
listSources(): { id, label }[]
search({ keyword, page, pageSize })            // 跨数据源检索，按数据源聚合后全局分页
hasSources(): boolean
```

`SearchSource` 约定：

```ts
{
  id: string;      // 例如 'posts'
  label: string;   // 结果分组展示名，例如 '文章'
  query({ keyword, page, pageSize }): Promise<{ items: SearchHit[]; total: number }>
}
```

- **分页由实现方负责**；实现方**不得**返回未对公众可见的内容；
- 单个数据源抛错只降级它自己的结果（错误隔离），不影响其他来源。

### 服务契约（消费）

无。这是刻意的：搜索插件不依赖任何内容插件，而是由内容插件"推"数据源进来。

### 事件

订阅 `core.runtime.started.v1`：在全部插件就绪后统计已注册数据源并告警
（若一个都没有，`/search` 会返回空结果）。

### 后台菜单 / 插槽 / 管理 API

无。

## 设置项（`settingsSchema`，后台自动生成表单）

后台「扩展中心 → 搜索 → 设置」。保存后需**重启服务**生效（`ctx.config` 是插件启动期快照）。

### 分组「搜索行为」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `resultPageSize` | number（1–50） | `10` | 每页结果数 |
| `maxKeywordLength` | number（1–500） | `100` | 关键词长度上限（超长直接拒绝） |
| `maxItemsPerSource` | number（1–500） | `50` | 单个数据源最多返回的条数（防止某一个来源淹没结果） |

## 谁在向它注册

| 数据源 id | 拥有者 | 检索实现 |
| --- | --- | --- |
| `posts` | `rice.posts` | MySQL FULLTEXT（ngram）+ 短词 LIKE 回退，见 ADR-009 |

其他内容插件（如 `rice.pages`）如需被检索，只需在 `core.runtime.started.v1` 阶段调用
`registerSource`，并在 `stop()` 中调用 `unregisterSource` —— 两侧都不产生硬依赖。

## 依赖与启停

- 可独立启停；**禁用后 `/search` 路由消失**，此时：
  - 主题里的 `{{ url('search') }}` 会降级为 `#`（Core 记录一次告警），
    官方主题用 `has_feature('search')` 控制入口显隐；
  - 数据源拥有者通过 `tryUse` 得到 `undefined`，静默跳过注册。
