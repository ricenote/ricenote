# `PluginContext` 逐方法参考

`PluginContext` 是插件**唯一**的对外能力入口（import 自 `@ricenote/plugin-sdk`）。
本页逐个列出它的成员、方法签名、能力门与抛错行为。

> **先澄清一处常见误解**：`PluginContext` 上**没有** `ctx.media`、`ctx.runtime`、`ctx.paths`、
> `ctx.settings`、`ctx.capabilities` 这些门面。
> 媒体、运行时、路径等能力是通过**跨插件服务契约**（`media.library@1`、`core.runtime@1`、`core.setup@1`）
> 拿到的，不是 `ctx` 的属性。`capabilities` 只在 `ctx.manifest.capabilities` 上。

---

## 0. 成员总览

```ts
interface PluginContext {
  readonly manifest: PluginManifest;
  readonly logger: PluginLogger;
  readonly config: PluginConfigReader;
  readonly db: PluginDatabase;
  readonly services: ServiceRegistryFacade;
  readonly events: EventBusFacade;
  readonly routes: RouteRegistryFacade;
  readonly slots: SlotRegistryFacade;        // 历史 API，等价于 extensions.contribute(scope: 'render')
  readonly extensions: ExtensionRegistryFacade;
  readonly adminMenu: AdminMenuRegistry;
  readonly site: SiteInfo;
}
```

全部 `readonly`、全部存在（不会出现 `undefined`）。**能力不足时会出现"拒绝桩"而不是缺属性** ——
桩上的方法被调用就抛 `RN_FORBIDDEN`（403）。

---

## 1. `manifest`

类型 `PluginManifest`（来自 `@ricenote/shared`），即你写的 `manifest.json` 的解析结果。

常用：`ctx.manifest.id`、`ctx.manifest.capabilities`、`ctx.manifest.version`。

---

## 2. `logger`

```ts
ctx.logger.debug(message: string, meta?: Record<string, unknown>): void
ctx.logger.info (message: string, meta?: Record<string, unknown>): void
ctx.logger.warn (message: string, meta?: Record<string, unknown>): void
ctx.logger.error(message: string, meta?: Record<string, unknown>): void
```

| 要点 | 说明 |
| --- | --- |
| 前缀 | 日志行自动带**插件名**与**请求 ID**（在请求上下文中记录时） |
| 脱敏 | `meta` 中键名匹配 `password` / `passwd` / `secret` / `token` / `credential` / `authorization` / `cookie` 的值会被替换为 `[redacted]`（递归深度上限 6） |
| 文件 | 日志文件始终是 JSON Lines；终端格式是 `key=value` 的可读格式 |
| 级别 | 由 `LOG_LEVEL` 控制 |

> 脱敏是**兜底**，不是许可：不要把明文密码/令牌往日志里传。

---

## 3. `config`

```ts
ctx.config.get<T>(key: string, fallback: T): T
ctx.config.all(): Record<string, unknown>
```

**值已经合并过默认值**，合并顺序为：

```
manifest.settings 的默认值（旧写法）
  → manifest.settingsSchema 各字段的 default
  → 数据库中的覆盖值
```

该合并与后台设置表单共用同一个解析函数（`resolvePluginSettings`），所以**表单显示的值与插件读到的值一致**。

> ⚠️ `ctx.config` 是**启动期快照**：在后台改插件设置后需要**重启**才生效
> （后台会标记"待生效"并提供一键重启）。

---

## 4. `db`（需要能力 `database:own`）

```ts
ctx.db.pluginId: string
ctx.db.orm: unknown                                    // 逃生舱，类型不确定
ctx.db.query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>
ctx.db.execute(sql: string, params?: readonly unknown[]): Promise<{ affectedRows: number; insertId: number }>
ctx.db.transaction<T>(fn: (tx: PluginDatabase) => Promise<T>): Promise<T>
ctx.db.table(name: string): string                     // 拼上 rn_ 前缀并校验字符集
```

| 要点 | 说明 |
| --- | --- |
| 能力门 | 未声明 `database:own` → `ctx.db` 是拒绝桩，任何方法抛 `RN_FORBIDDEN` |
| 表名 | `table('posts')` → `rn_posts`；名称必须匹配 `/^[a-z][a-z0-9_]{0,60}$/`，否则抛 `RN_VALIDATION_FAILED` |
| 事务 | 在事务内再次调用 `transaction()` 复用同一连接（正确的嵌套语义） |
| 多语句 | 连接池开启 `multipleStatements: false`，单次 `query` 不能塞多条语句 |
| 隔离 | 插件之间"不碰对方表"是**架构约定**；运行时强制的是 `rn_` 前缀与 `db` 能力门（见 [[数据层\|Development/Architecture/Data-and-Migrations]]） |

**用 `table()` 而不是硬编码表名** —— 这样命名约束在任何时候都是生效的。

---

## 5. `services`

```ts
ctx.services.provide<T>(descriptor: { name: string; version: string; implementation: T }): Dispose
ctx.services.use<T>(name: string): T
ctx.services.tryUse<T>(name: string): T | undefined
ctx.services.has(name: string): boolean
ctx.services.list(): string[]
```

| 方法 | 能力门 | 行为 |
| --- | --- | --- |
| `provide` | `services:provide` | 返回 `Dispose`；**重复提供同名契约**抛 `RN_SERVICE_DUPLICATE`（409） |
| `use` | `services:consume` | 找不到抛 `RN_SERVICE_NOT_FOUND`（503）；未声明能力抛 `RN_FORBIDDEN` |
| `tryUse` | `services:consume` | 找不到返回 `undefined`；**未声明能力也返回 `undefined`**（不抛错） |
| `has` / `list` | 无 | 纯查询 |

**降级惯例**：

```ts
const media = ctx.services.tryUse<MediaService>('media.library@1');
if (!media) {
  ctx.logger.warn('媒体库未启用，跳过封面解析');
  return null;              // 走降级路径，而不是让请求失败
}
```

---

## 6. `events`

```ts
ctx.events.on<T>(eventName: string, handler: (payload: T, meta: EventMeta) => void | Promise<void>,
                 options?: { priority?: number }): Unsubscribe
ctx.events.emit<T>(eventName: string, payload: T, requestId?: string): Promise<void>
ctx.events.list(): { name: string; subscribers: number }[]
```

| 项 | 说明 |
| --- | --- |
| 能力门 | `on` 需 `events:subscribe`；`emit` 需 `events:publish` |
| 顺序 | 订阅按 `priority` **降序**，同优先级按注册顺序 |
| 错误隔离 | 单个订阅者抛错**不会中断**其它订阅者；`emit` 返回 `{ failures, delivered }` 风格的结果由总线收集 |
| `meta` | `{ name, source, occurredAt, requestId? }` |
| 清理 | 返回的 `Unsubscribe` 应存入 disposer；插件停止时 Core 也会兜底释放 |
| `emit` 是异步 | 返回值是 `Promise<void>`，需要 `await` 才能保证订阅者已处理 |

事件清单见 [[跨插件服务契约|Development/Plugin-API/Service-Contracts]] 的事件一节。

---

## 7. `routes`（三类）

### 7.1 `page()` —— 公开页面（需要 `routes:public`）

```ts
ctx.routes.page(spec: PageRouteSpec): Dispose

interface PageRouteSpec {
  name: string;                    // 路由名，用于 url('name', params)，全局唯一
  path: string;                    // 路径模板，支持 :param，如 /post/:slug
  kind: string;                    // 页面类型：home / post / page / archive / search / 404 / 自定义
  template?: string;               // 覆盖主题中该 kind 的模板
  cacheable?: boolean;             // 是否参与 HTML 缓存，默认 true
  handler: (request: HttpRequestLike) => Promise<PageViewModel> | PageViewModel;
}
```

**插件只产出 ViewModel，不产出 HTML**：

```ts
interface PageViewModel {
  kind: string;
  title: string;
  canonicalUrl?: string;
  template?: string;               // 优先级高于 spec.template
  status?: number;
  data: Record<string, unknown>;   // 键名即模板中的顶层变量
  cacheTags?: string[];            // 供精确失效
}
```

| 边界 | 说明 |
| --- | --- |
| 路由名冲突 | 按 `name` 去重，冲突抛 `RN_ROUTE_CONFLICT` |
| `url()` 生成 | 模板侧 `url('post.show', { slug })`；**未注册路由降级为 `#` 并告警一次**，不是报错 |
| cacheTags | 变更内容时配合 `core.theme@1.invalidate(tags)` 精确失效 |

### 7.2 `raw()` —— 原始 HTTP（`routes:public`，或 `routes:admin`）

```ts
ctx.routes.raw(spec: RawRouteSpec): Dispose

interface RawRouteSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: (req: HttpRequestLike, reply: HttpResponseLike) => void | Promise<void>;
  capability?: 'routes:public' | 'routes:admin';   // 缺省 routes:public
}
```

用于 `sitemap.xml`、`robots.txt`、`/media/:id`、表单 POST 等**不走主题渲染**的响应。

`HttpResponseLike` 提供：`statusCode`、`header()`、`send()`、`json()`、`html()`、`redirect()`。

> 声明 `capability: 'routes:admin'` 时，Core 会**自动套用会话 / CSRF / 权限**校验链。

### 7.3 `adminApi()` —— 管理 API（需要 `routes:admin`）

```ts
ctx.routes.adminApi(spec: AdminRouteSpec): Dispose

interface AdminRouteSpec {
  method: HttpMethod;
  path: string;
  permission?: string;   // 权限点，如 post.write；为空表示仅需登录
  handler: (req, reply) => void | Promise<void>;
}
```

路由挂载在 `/api/admin` 前缀下，并自动经过"认证 → CSRF → 权限 → 审计"。

| 边界 | 说明 |
| --- | --- |
| 路径冲突 | 方法 + 路径签名去重，冲突抛 `RN_ROUTE_CONFLICT` |
| 权限缺省 | 不写 `permission` = 只要求登录，**不要求任何权限点** —— 写操作请务必显式声明 |

---

## 8. `slots`（历史 API，仍然有效）

```ts
ctx.slots.register(slotName: string, component: SlotComponent, options?: { priority?: number }): Dispose
ctx.slots.list(): { slot: string; components: string[] }[]

interface SlotComponent {
  name: string;
  render(context: SlotRenderContext): Promise<string> | string;
}
interface SlotRenderContext {
  kind: string;
  data: Record<string, unknown>;   // 页面数据 + 本次调用数据
  request?: HttpRequestLike;
}
```

- 需要能力 `slots:register`；
- 等价于 `ctx.extensions.contribute(slotName, component, { scope: 'render' })`；
- 返回值是 HTML 字符串；**Core 会做错误隔离**（单个组件抛错 → 降级为空片段并记日志）；
- 未注册的插槽名 → 什么都不渲染（模板不需要判断）。

9 个标准插槽：`head.end`、`body.start`、`body.end`、`header.navigation`、`sidebar.widgets`、
`post.beforeContent`、`post.afterContent`、`post.comments`、`footer.widgets`。

---

## 9. `extensions`（命名扩展点）

```ts
ctx.extensions.declare(point: {
  name: string; scope: 'render' | 'admin' | 'server';
  replaceable?: boolean; description?: string;
  props?: { name: string; description: string }[];
}): Dispose

ctx.extensions.contribute(point: string, payload: unknown,
  options?: { scope?: 'render' | 'admin' | 'server'; mode?: 'append' | 'replace'; order?: number }): Dispose

ctx.extensions.apply<T>(point: string, payload: T,
  options?: { onError?: 'abort' | 'skip' }): Promise<T>

ctx.extensions.list(): ExtensionPointSummary[]
```

| 方法 | 能力门 | 要点 |
| --- | --- | --- |
| `declare` | `extensions:declare` | 名称非法抛 `RN_VALIDATION_FAILED`；**他人已声明**同名抛 `RN_VALIDATION_FAILED`（409）；重复声明 Core 预置插槽仅告警 |
| `contribute` | `extensions:contribute` | 缺省 `scope='render'`、`mode='append'`、`order=0`；向未声明点贡献仅告警；非提供方对 `replaceable:false` 做 `replace` 会被拒绝 |
| `apply` | **无能力门** | 触发 `server` 作用域钩子链；`onError` 缺省 `'abort'`，可设 `'skip'` 跳过出错环节 |
| `list` | 无 | 查看已声明的扩展点与贡献数 |

`server` 作用域的钩子模块形态：

```ts
interface ExtensionHookModule<T> {
  name?: string;
  apply(payload: T, context: ExtensionHookContext): Promise<T> | T;
}
```

---

## 10. `adminMenu`（需要 `admin:menu`）

```ts
ctx.adminMenu.add(item: AdminMenuItem): Dispose
ctx.adminMenu.list(): AdminMenuItem[]
```

| 边界 | 说明 |
| --- | --- |
| 能力门 | 需要 `admin:menu` |
| 校验 | ID 必须匹配 `^[a-z][a-z0-9._-]{1,80}$`、不可重复、`path` 必须以 `/` 开头，违规抛 `RN_VALIDATION_FAILED` |
| 排序 | `order` **降序**，同分按 `id` 升序 |

> **推荐用声明式 `manifest.admin.pages`** 而不是这个 API —— 声明式不需要 `admin:menu` 能力，
> 且菜单项、入口 URL、样式、权限都在清单里一目了然。

---

## 11. `site`

```ts
interface SiteInfo {
  id: string; title: string; description: string; url: string; language: string;
  logoUrl?: string; faviconUrl?: string; icpText?: string; icpUrl?: string;
}
```

**关键特性：动态取值**。`ctx.site` 每次访问都取当前生效值，
所以后台改了站点标题/地址后，插件无需重启即可读到新值（这是 v0.3.0 起的行为）。

> 可选字段（`logoUrl` 等）**未设置时是 `undefined`**，不是空字符串。判断请用 `if (ctx.site.logoUrl)`。

---

## 12. 错误码速查（插件侧最常撞到的）

| 错误码 | 触发 |
| --- | --- |
| `RN_FORBIDDEN`（403） | 调用未声明能力的 API |
| `RN_VALIDATION_FAILED` | 参数/表名/菜单项/扩展点名不合法 |
| `RN_SERVICE_DUPLICATE`（409） | 重复提供同名服务契约 |
| `RN_SERVICE_NOT_FOUND` | `use()` 找不到契约 |
| `RN_ROUTE_CONFLICT` | 路由名或方法+路径冲突 |
| `RN_PLUGIN_SETTING_INVALID` | 写入了未声明的设置键 |
| `RN_CONTENT_TEMPLATE_INVALID` | 内容版式键不在当前主题清单中 |

完整的 46 个错误码见 `packages/shared/src/errors.ts`。

> 注意：错误码常量**不携带**与 HTTP status 的集中映射，status 由抛错处决定
> （框架层会把未指定的 Fastify 错误按 status 反推为通用码）。

---

## 相关页面

- [[manifest 逐字段参考|Development/Plugin-API/Manifest-Reference]]
- [[跨插件服务契约|Development/Plugin-API/Service-Contracts]]
- [[完整教程：从零写插件|Development/Plugin-API/Tutorial]]
