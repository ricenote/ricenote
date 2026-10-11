# ADR-009：搜索独立成插件并接管 `/search`，索引采用 MySQL ngram FULLTEXT（布尔短语）

- 状态：已接受
- 日期：2026-10-11

## 背景

M2 的内容 MVP 中，`/search` 页面与文章检索实现在 `rice.posts` 内部（`LIKE` 匹配）。
M4 要求"搜索"作为独立能力，且架构原则是"**所有功能以插件形式实现，核心仅提供基础框架**"。

若 search 插件也注册 `/search`，会与 posts 的路由产生冲突（Router Registry 会显式报 `RN_ROUTE_CONFLICT`）。
同时中文检索有一个现实问题：MySQL 默认分词器按空格切词，对中文几乎不可用
（整句被当作一个 token，`LIKE '%关键词%'` 会退化为全表扫描）。

## 决策

1. **路由归属 search 插件**：`/search` 的路由名与路径由 `rice.search` 注册，
   **posts 移除自带的 `/search` 路由**。主题侧无感：路由名仍为 `search`、kind 仍为 `search`、
   数据字段仍为 `keyword / posts / pagination`，因此两套既有主题**零改动**。
2. **注册方向为"数据源拥有者主动注册"**：search 提供 `content.search@1` 契约
   （`registerSource` / `unregisterSource` / `search`），posts 等数据源拥有者向它注册
   `SearchSource`。因此 posts 与 search **没有编译期与启动期依赖**：
   search 被禁用时 posts 静默跳过注册，反之亦然。
3. **注册时机在 `core.runtime.started.v1`**：拓扑排序只保证依赖在前，
   不保证无依赖插件之间的先后顺序；启动期直接取服务会出现假阴性。
   同理，posts 在 `stop()` 中主动 `unregisterSource('posts')`，避免搜索页拿到已停用插件的实现。
4. **索引：`FULLTEXT ... WITH PARSER ngram`**，由 posts 的迁移 0002 创建。
   遵守表所有权纪律——**search 插件不越权操作 `rn_posts`**，索引维护归数据源方。
5. **检索模式：`IN BOOLEAN MODE` + 引号短语**。
   ngram 会把拉丁词切成 2 字符片段（`Slot` → `Sl`/`lo`/`ot`），自然语言模式下命中任一片段即算匹配，
   实测出现明显过匹配（`Slot` 命中 2 篇，实际只有 1 篇）；加引号的短语要求片段按序相邻，
   语义等价于子串匹配，既精确又仍然走索引。
6. **降级链**：关键词清洗后短于 2 个字符（ngram 最短分词长度）或含有布尔特殊字符 → 回退 `LIKE`；
   FULLTEXT 索引缺失（迁移未执行）→ 捕获错误并**永久回退** `LIKE`，同时在日志中告警一次。

## 理由

- 中文站点的搜索体验与性能同时改善（索引加速 + 子串级精度），且**不引入外部依赖**；
- 数据源注册机制把"内容类型"与"搜索引擎"解耦：将来评论、页面、媒体要参与搜索，
  只需各自注册一个 `SearchSource`，search 插件无需改动；
- 路由归属清晰，消除 `RN_ROUTE_CONFLICT` 的隐患。

## 后果

**正面**

- search 可独立启停；禁用后 `/search` 路由消失，其他插件不受影响；
- 单源失败被隔离（`onSourceError`），搜索页仍能渲染其他数据源的结果；
- 主题无需感知搜索引擎变化。

**负面 / 约束**

- 全局分页需要给每个数据源请求 `page * pageSize` 的窗口（上限 `maxItemsPerSource`），
  因此**很靠后的页码**可能不完整；对博客规模可接受；
- 搜索结果卡片不携带词条与封面（避免按行查询其他插件导致的 N+1），
  卡片模板对这些字段本就有条件渲染；
- 短语语义意味着多词查询要求词序相邻（不拆词、不 OR），需在文档中向使用者说明；
- 模板若引用了未注册的可选路由（如 search 被禁用时的 `url('search')`），
  `url()` 会降级为 `#` 并告警一次，而不是让整页渲染失败。

## 相关实现

- `plugins/official/search/`：`content.search@1` 注册表与 `/search` 页面
- `plugins/official/posts/src/search-source.ts`：数据源实现（FULLTEXT → LIKE 降级）
- `plugins/official/posts/migrations/0002_search_index.sql`：ngram FULLTEXT 索引
- `packages/shared/src/types/services.ts`：`SearchSource` / `ContentSearchService`
- `tests/integration/m4-features.test.ts`：路由归属、中文检索、单字降级、无匹配
