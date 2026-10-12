# 跨插件服务契约

**插件之间不直接调用对方，而是通过"能力契约"通信。** 契约名形如 `content.posts@1`，
`@1` 是主版本。消费方按契约名解析实现，因此提供方可以被替换（甚至由第三方实现同一契约）。

定义位置：`packages/shared/src/types/services.ts`。

---

## 1. 降级语义（先看这个）

| 方法 | 契约不存在 | 未声明 `services:consume` |
| --- | --- | --- |
| `ctx.services.use<T>(name)` | 抛 `RN_SERVICE_NOT_FOUND` | 抛 `RN_FORBIDDEN` |
| `ctx.services.tryUse<T>(name)` | 返回 `undefined` | 返回 `undefined` |
| `ctx.services.has(name)` | `false` | 正常返回 |
| `ctx.services.list()` | —— | 正常返回 |

**规则：硬依赖用 `use()` 并写进 `requires`；可选依赖用 `tryUse()` 且不写进 `requires`。**

```ts
// 硬依赖：没有它插件就没意义
const posts = ctx.services.use<ContentPostsService>('content.posts@1');

// 可选依赖：没有它就走降级路径
const media = ctx.services.tryUse<MediaLibraryService>('media.library@1');
const coverUrl = media ? await media.findById(id) : null;
```

---

## 2. 契约全清单

| 契约 | 提供者 | 用途 |
| --- | --- | --- |
| `core.security@1` | Core | 注册会话与授权解析器（依赖倒置） |
| `core.theme@1` | Core | 活动主题、设置、页面模板、内容字段、缓存失效 |
| `core.site@1` | Core | 读取生效站点信息 |
| `core.runtime@1` | Core | 待重启标记与重启请求 |
| `core.setup@1` | Core | 站点 ID、初始管理员凭据、路径 |
| `core.html@1` | Core | HTML 消毒 / 标记受信 / 转义 |
| `identity.auth@1` | `rice.identity` | 登录、会话解析、用户管理 |
| `identity.users@1` | `rice.identity` | 用户读取（无侧效） |
| `identity.authorization@1` | `rice.authorization` | 角色与权限点 |
| `content.posts@1` | `rice.posts` | 文章读写 |
| `content.pages@1` | `rice.pages` | 页面读写 |
| `content.navigation@1` | `rice.navigation` | 导航项 |
| `content.taxonomy@1` | `rice.taxonomy` | 分类与标签 |
| `taxonomy.internal@1` | `rice.taxonomy` | 文章与词条的关联（内部契约） |
| `media.library@1` | `rice.media` | 媒体读写 |
| `content.search@1` | `rice.search` | **可搜索数据源注册表** |
| `content.comments@1` | `rice.comments` | 评论读写与审核 |

> **注意命名的两个坑**：
> 1. 媒体契约是 **`media.library@1`**（不是 `content.media@...`）；
> 2. `identity.users@1` 有对应的 TypeScript 接口，但在共享包里**没有导出的字符串常量** ——
>    在 `requires` 里直接写字符串字面量即可。

---

## 3. Core 提供的契约

### `core.security@1` — 依赖倒置的接口

```ts
registerSessionResolver(resolver: (sessionId: string) => Promise<ResolvedSession | undefined>): void
registerAuthorizationResolver(resolver: {
  permissionsOf(userId: number): Promise<string[]>;
  rolesOf(userId: number): Promise<string[]>;
}): void
```

**为什么存在**：Core 必须守住认证/授权边界（[ADR-005](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-005-security-control-plane-in-core.md)），
但"用户是什么"是业务概念。于是 Core 定义"**怎么问**"，插件提供"**答案**"。

未注册 resolver 时，认证 fail-closed（返回未登录）—— 因此禁用 `rice.identity` 不会变成"谁都能进后台"。

### `core.theme@1`

```ts
activeThemeId(): Promise<string>
settings(): Promise<Record<string, unknown>>
pageTemplates(): Promise<PageTemplateDescriptor[]>
contentFields(): Promise<ContentFieldsSchema>
invalidate(tags: string[]): number      // 按标签失效缓存，返回受影响条目数
clearCache(): void                      // 整体清空
```

`clearCache()` 用在"内容出现在全局插槽"的场景（如导航栏出现在每个页面，按标签覆盖不到所有已缓存页）。

### `core.site@1`

```ts
info(): EffectiveSiteInfo     // 同步
```

与 `ctx.site` 相比，它显式表达"取当前生效值"（动态），且可用于需要传参的场景。

### `core.runtime@1`

```ts
registerRestartHandler(handler: (input: { reason: string }) => Promise<void> | void): void
markRestartRequired(input: { reason: string; actorId?: number }): Promise<void>
requestRestart(input: { reason: string; actorId?: number }): Promise<{ accepted: boolean }>
clearRestartRequired(): Promise<void>
state(): { restartRequired: boolean; reason?: string; requestedAt?: string; restarting: boolean }
```

| 方法 | 用在哪 |
| --- | --- |
| `markRestartRequired` | 插件保存了"改完要重启才生效"的设置 |
| `requestRestart` | 后台一键盘重启按钮（`accepted: false` 表示已有重启在进行） |
| `registerRestartHandler` | 由 `apps/server` 的 Supervisor 注入，插件一般不用 |

### `core.setup@1`

```ts
siteId(): string
bootstrapAdmin(): { username: string; password: string; email: string }
paths(): { storageDir: string; uploadsDir: string; cacheDir: string }
```

用于"首次启动创建管理员"与需要落盘路径的场景。

### `core.html@1`

```ts
sanitize(dirty: string, options?: { extraTags?: string[] }): TrustedHtmlHandle
markTrusted(html: string): TrustedHtmlHandle
escape(text: string): string
```

`TrustedHtmlHandle` 带 `readonly __trustedHtml: true` 与 `value`，是"已受信、模板中不转义"的凭证。

> **标准用法**：先把富文本 `sanitize()` 消毒，再交给模板。
> 直接 `markTrusted(userInput)` 等于放弃转义保护。

---

## 4. 身份与权限契约

### `identity.auth@1`

```ts
login(input: { username: string; password: string; ip?: string; userAgent?: string })
  : Promise<{ user: AuthUser; sessionId: string; expiresAt: string }>     // 失败抛 RN_UNAUTHENTICATED
resolveSession(sessionId: string): Promise<ResolvedSession | undefined>
logout(sessionId: string): Promise<void>
ensureBootstrapAdmin(input: { username; password; email }): Promise<{ created: boolean; userId?: number }>
changePassword(input: { userId: number; currentPassword: string; nextPassword: string }): Promise<void>
updateProfile(input: { userId: number; displayName?: string; email?: string }): Promise<AuthUser>
resetPassword(input: { userId: number; newPassword: string }): Promise<void>
listUsers(query: { page?: number; pageSize?: number; keyword?: string })
  : Promise<{ items: AdminUserSummary[]; total: number }>
countUsers(): Promise<{ total: number }>
countActiveSessions(): Promise<number>
```

- `ResolvedSession = { user, sessionId, expiresAt }`；
- `resolveSession()` 是 `core.security@1` 会话解析器的实现本体 —— **Core 通过它认识用户**；
- 密码相关方法都遵循"改密后其它会话失效"。

### `identity.users@1`

```ts
findById(userId: number): Promise<PublicUserInfo | undefined>
displayNames(userIds: number[]): Promise<Record<number, string>>
// PublicUserInfo = { id, username, displayName, email }
```

**只读、无副作用**，而且有**批量**接口 —— 需要展示作者名时请用 `displayNames(ids)` **一次查完**，
不要循环调用 `findById`（典型的 N+1）。

### `identity.authorization@1`

```ts
permissionsOf(userId: number): Promise<string[]>
rolesOf(userId: number): Promise<string[]>
listRoles(): Promise<RoleDefinition[]>          // { id, name, description?, permissions, builtin }
listPermissions(): Promise<{ key; label; group }[]>
assignRole(userId: number, roleName: string): Promise<void>
revokeRole(userId: number, roleName: string): Promise<void>
```

这是 `core.security@1` 授权解析器的实现本体。

---

## 5. 内容契约

### `content.posts@1`

```ts
// 读取（公开侧）
listPublished(input: { page: number; pageSize: number }): Promise<PostQueryResult>
findPublishedBySlug(slug: string): Promise<PostDetail | undefined>
findPublishedById(id: number): Promise<PostDetail | undefined>
listPublishedByTerm(input: { termSlug: string; page: number; pageSize: number }): Promise<PostQueryResult>
searchPublished(input: { keyword: string; page: number; pageSize: number }): Promise<PostQueryResult>
titlesOf(postIds: number[]): Promise<Record<number, string>>          // 含草稿与归档
publishedRefs(postIds: number[]): Promise<Array<{ id; title; url }>>  // 仅已发布，带前台地址
// 管理侧
listForAdmin(query: PostListQuery): Promise<PostQueryResult>
findForAdmin(id: number): Promise<PostDetail | undefined>
save(input: { id?: number; authorId: number; payload: PostSaveRequest }): Promise<{ id: number }>
remove(id: number): Promise<void>
countByStatus(): Promise<Record<PostStatus | 'total', number>>
recent(limit: number): Promise<PostSummary[]>
// PostQueryResult = { items: PostSummary[]; total: number }
```

| 方法 | 要点 |
| --- | --- |
| `titlesOf` / `publishedRefs` | **批量**接口，供导航等全局组件使用，避免 N+1 |
| `publishedRefs` | 只返回**已发布**的文章 → 导航插件用它保证"绝不输出死链" |
| `countByStatus` | 仪表盘统计用 |

### `content.pages@1`

```ts
listPublished(input: { page; pageSize }): Promise<PageQueryResult>
findPublishedBySlug(slug: string): Promise<PageDetail | undefined>
navItems(): Promise<Array<{ id; title; slug; url }>>    // 供导航插件解析引用目标
listForAdmin(query: PageListQuery): Promise<PageQueryResult>
findForAdmin(id: number): Promise<PageDetail | undefined>
save(input: { id?; authorId?; payload: PageSaveRequest }): Promise<{ id: number }>
remove(id: number): Promise<void>
countByStatus(): Promise<Record<PageStatus | 'total', number>>
```

> `rice.pages` **不注册导航插槽**：导航由 `rice.navigation` 拥有，
> 页面插件只通过 `navItems()` 告诉别人"有哪些已发布页面"。

### `content.taxonomy@1`

```ts
list(type?: TermType): Promise<TermSummary[]>
listWithCounts(): Promise<TermSummary[]>
findBySlug(slug: string): Promise<TermSummary | undefined>
save(input: { id?; name; slug?; type: TermType; description? }): Promise<{ id: number }>
remove(id: number): Promise<void>
termsOfPost(postId: number): Promise<TermSummary[]>
```

### `taxonomy.internal@1`（内部契约）

```ts
setPostTerms(postId: number, termIds: number[]): Promise<void>
clearPostTerms(postId: number): Promise<void>
termIdsOfPost(postId: number): Promise<number[]>
postIdsOfTerm(slug: string): Promise<number[]>
```

面向"文章 ↔ 词条关联"的写入。名字带 `internal` 提示这是实现间协作，**第三方插件一般不应依赖**。

### `content.navigation@1`

```ts
listRenderable(): Promise<NavRenderItem[]>                       // 前台渲染用（已过滤失效目标）
listForAdmin(): Promise<NavItemSummary[]>                        // 后台列表（带 exists / published 标记）
save(input: { id?: number; payload: NavItemSaveRequest }): Promise<{ id: number }>
remove(id: number): Promise<void>
move(input: { id: number; direction: 'up' | 'down' }): Promise<NavItemSummary[]>
targets(input: { type: Exclude<NavItemType, 'custom'>; keyword?: string }): Promise<NavTargetOption[]>
```

| 方法 | 要点 |
| --- | --- |
| `listRenderable` | 已剔除"目标被删/未发布"的项，**前台绝不输出死链** |
| `listForAdmin` | 带 `exists` / `published`，供后台给出失效原因 |
| `targets` | 类型化目标选择器（页面 / 文章） |

### `media.library@1`

```ts
list(input: { page?; pageSize?; keyword? }): Promise<{ items: MediaSummary[]; total: number }>
findById(id: number): Promise<MediaSummary | undefined>
save(input: { fileName; mimeType; buffer: Buffer; alt?; uploaderId? }): Promise<MediaSummary>
remove(id: number): Promise<void>
countAll(): Promise<{ total: number; size: number }>
```

上传走这里（而不是自己写文件），才能复用体积与类型校验、随机文件名与路径归一化。

### `content.search@1` — 可搜索数据源注册表

```ts
registerSource(source: SearchSource): () => void
unregisterSource(id: string): void
listSources(): Array<{ id: string; label: string }>
search(input: SearchQuery): Promise<{ items: SearchHit[]; total: number }>
hasSources(): boolean

interface SearchSource {
  id: string;
  label: string;
  query(input: SearchQuery): Promise<{ items: SearchHit[]; total: number }>;
}
```

**这是"让内容类型进入全站搜索"的扩展点**：任何插件注册一个数据源即可加入搜索，
搜索插件本身完全不感知具体内容类型。

```ts
// 典型用法：在插件启动完成后注册（不要在 start() 里假设搜索插件已启动）
ctx.events.on('core.runtime.started.v1', () => {
  const search = ctx.services.tryUse<ContentSearchService>('content.search@1');
  if (!search) return;
  unregister = search.registerSource({
    id: 'posts',
    label: '文章',
    query: async (input) => ({ items: await myQuery(input), total: await myCount(input) })
  });
});
// 停止时注销
ctx.services.tryUse<ContentSearchService>('content.search@1')?.unregisterSource('posts');
```

`rice.posts` 正是这样接入搜索的（并在 `stop()` 注销，保证零残留）。

### `content.comments@1`

```ts
listApprovedThreaded(input: { postId: number; page: number; pageSize: number })
  : Promise<{ items: CommentThreadItem[]; total: number; totalApproved: number }>
submit(input: CommentSubmitRequest & { ip?; userAgent?; userId? })
  : Promise<{ id: number; status: CommentStatus }>
listForAdmin(query: CommentListQuery): Promise<{ items: CommentSummary[]; total: number }>
moderate(input: CommentModerateRequest): Promise<{ affected: number }>
countByStatus(): Promise<{ pending; approved; spam; trash; total }>
countsForPosts(postIds: number[]): Promise<Record<number, number>>
recent(limit: number): Promise<CommentSummary[]>
```

`submit()` 里带 `ip` / `userAgent` 用于反垃圾；来源 IP 只以**加盐哈希**留档。

---

## 6. 事件清单

事件名以**字符串字面量**使用（共享包里没有集中常量导出，只在 `services.ts` 里给了示例）。

| 事件 | 发布者 | payload |
| --- | --- | --- |
| `core.runtime.started.v1` | Core | `{ started: string[]; failed: string[]; excluded: string[] }` |
| `identity.session.created.v1` | identity | `{ userId, sessionId, ip: string \| null }` |
| `identity.user.created.v1` | identity | `{ userId, username?, isFirstUser?, role? }` |
| `identity.user.password.changed.v1` | identity | `{ userId, byAdmin?: true }` |
| `identity.user.profile.updated.v1` | identity | `{ userId }` |
| `identity.authorization.role.assigned.v1` | authorization | `{ userId, role: string }` |
| `identity.authorization.role.revoked.v1` | authorization | `{ userId, role: string }` |
| `identity.authorization.bootstrap.completed.v1` | authorization | `{ userId }` |
| `content.post.published.v1` | posts | `{ postId, slug, title, authorId }` |
| `content.post.unpublished.v1` | posts | `{ postId, slug }` |
| `content.post.updated.v1` | posts | `{ postId, slug, title, status }` |
| `content.post.deleted.v1` | posts | `{ postId, slug }` |
| `content.pages.changed.v1` | pages | `{ pageId, slug, status }` |
| `content.pages.deleted.v1` | pages | `{ pageId, slug }` |

订阅关系举例：`rice.navigation` 订阅 6 个 `content.*` 事件以在引用内容变化时清缓存；
`rice.posts` / `rice.pages` / `rice.navigation` / `rice.search` / `rice.identity` 订阅 `core.runtime.started.v1`。

### 为什么要有 `content.post.updated.v1`

早期只有"发布状态翻转"才发事件，于是**改标题或别名没有任何信号** ——
依赖文章标题的全局组件（导航、SEO）不会更新。现在任何改动都会发信号。

---

## 7. 常见误区

| 误区 | 实际 |
| --- | --- |
| 直接查别的插件的表 | 应该走契约。表的归属是唯一的 |
| 在 `start()` 里 `use()` 一个可选依赖 | 可能拿到 `undefined`（假阴性）；可选依赖请**请求期** `tryUse()` |
| 把可选依赖写进 `requires` | 那就变成硬依赖，缺了会启动失败 |
| 循环调用 `findById` 取作者名 | 用 `displayUsers` 式的批量接口（`displayNames`、`titlesOf`） |
| 认为契约名可以自造 | Core 的 `SERVICE_CONTRACTS` 是清单；自造名字前先想清楚谁提供 |
| `emit` 后不等 | `emit` 返回 Promise，不 await 会丢订阅者的错误 |

---

## 相关页面

- [[PluginContext 逐方法参考|Plugin-API-Context-Reference]]
- [[扩展点全量清单|Hooks-Inventory]]
- [[官方插件一览|Plugins-Overview]]
