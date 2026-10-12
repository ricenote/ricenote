# ADR-018：权限点声明下放到插件，内置角色收敛为 administrator

- 状态：已接受
- 日期：2026-10-12
- 修订：[ADR-005](ADR-005-security-control-plane-in-core.md)（把"权限点由插件声明"从口号落实为可校验的清单字段）

## 背景

ADR-005 定下了"**权限点由插件声明、Core 校验**"。但它只实现了后半句：

- **Core 校验**做到了 —— `SecurityGateway` 只依赖 authorization 注册的 `permissionsOf()`，
  按权限点标识字符串比对，与"谁声明了它"无关；
- **插件声明**没做到 —— `{ key, label, group }` 目录与内置角色的默认授权集合，
  全部硬编码在 `plugins/official/authorization/src/permissions.ts` 里，而且是**别人家**的权限点：
  `post.*`、`page.*`、`nav.*`、`taxonomy.manage`、`media.manage`、`comment.moderate` 都写在那里。

后果在"新增一个插件"时暴露得最清楚：加 `rice.friend-links` 要往 authorization 里塞
`link.view` / `link.manage` —— **插件之间因此产生了反向的源码耦合**：
authorization 必须知道所有插件的权限点，而它本不该知道。

同期的另一类问题出在内置角色上：`editor` / `author` / `contributor` 的权限集合也在那里硬编码，
且 `syncBuiltinRoles()` **每次启动 DELETE 后重写**。于是：

- 每加一个插件都要回来改这份清单，还要替站点决定"作者该不该有它"；
- 管理员在后台给内置角色做的调整会在下次重启被清掉（"以代码为准"的代价）；
- 内置角色实际上把"站点该怎么分工"固化成了产品决定，而这是站点自己的事。

## 决策

### 1. 权限点在 `manifest.json` 里声明（与 `extensionPoints` / `admin.pages` 同构）

```jsonc
"permissions": [
  {
    "key": "post.publish",
    "label": { "zh-CN": "发布与撤回文章", "en": "Publish and unpublish posts" },
    "group": { "zh-CN": "内容", "en": "Content" }
  }
]
```

`label` / `group` 复用设置字段的 `localizedText`（字符串或多语言对象）：
权限目录的文案与站点语言一致，不再只有中文。

### 2. Core 是唯一的聚合者，authorization 只消费

- **声明**：插件在 `manifest.permissions`；Core 自己在 `packages/core/src/security/permissions.ts`
  声明**控制面与共用**权限点（`theme.*` / `plugin.*` / `user.manage` / `system.*`）。
  `user.manage` 被 identity 与 authorization 两个插件共用，因此归 Core，不属于任何一个插件。
- **使用**：`manifest.admin.pages[].permission`、`contributions[].permission`（静态）与
  运行期的 `ctx.routes.adminApi({ permission })` / `ctx.adminMenu.add({ permission })` 都会被记录，
  合起来就是"这个权限点是谁在用"。
- **聚合与暴露**：`PermissionRegistry`（`packages/core/src/security/permission-registry.ts`）
  持有"声明 + 使用"的合并视图，通过 `core.security@1` 的 `listDeclaredPermissions()` 暴露。
  authorization 的 `listPermissions()` 只做本地化 —— **新增插件无需再改 authorization 一行代码**。

### 3. 两条刻意不对称的规则

| 情况 | 处理 | 为什么 |
| --- | --- | --- |
| 同一个标识被两方声明 | **错误**（启动失败、`pnpm validate` 失败） | 归属不清：权限目录会出现两个同名项，且"谁该给它写文案"无解 |
| 某个标识被使用但无人声明 | **仅告警**（启动日志 + `pnpm validate` 提示） | 鉴权按标识字符串比对、不依赖声明，因此不拦；第三方插件在补上声明之前照旧可用 |

"未登记"的权限点不会从目录里消失，只是 `label` 回退为标识本身、归入「未登记」分组，
管理员仍可把它分配给角色。

### 4. 内置角色只剩 `administrator`，新用户默认没有角色

- `editor` / `author` / `contributor` **退出内置**：插件不替站点决定"谁该有什么权限"，
  站点管理员按需自建角色并显式授权。升级时这三个角色由迁移一次性删除
  （`plugins/official/authorization/migrations/0002_*.sql`）。
- **内置角色不再"每次启动重写权限"**：启动只保证 `administrator` 存在且权限为 `*`。
  否则"管理员在后台给内置角色配权限"这件事永远不可能成立。
- `identity.user.created.v1` 的处理改为：**首个用户**仍然自动成为 `administrator`
  （否则全新站点没人能进后台）；其余新用户**不分配任何角色**，只记一条提示日志。
  后台新建用户时显式指定了角色才分派。

### 5. 权限点标识不与插件 ID 绑定

沿用既有语义域命名（`post.` / `page.` / `nav.` / `taxonomy.` …），
因为它们的域表达的是**业务归属**而不是包名（`rice.posts` 声明 `post.*`，
历史命名已经如此）。Core 只强制：`<域>.<动作>` 形式、全局唯一。

## 后果

**正面**

- 新增/删除插件与权限点**不再触碰 authorization**，插件之间没有反向耦合；
- 权限目录的文案跟着插件走（含多语言），不会出现"插件升级了但目录还是旧文案"；
- 站点可以真正按自己的组织方式建角色；内置角色不再替站点做决定；
- 拼写错误与漏声明在 `pnpm validate` 与启动日志就会被指出。

**负面 / 约束**

- **行为变更**：升级后 `editor` / `author` / `contributor` 会被删除，
  挂在它们上面的用户失去角色；新用户默认无任何权限，必须由管理员显式授权
  （升级说明与 CHANGELOG 必须写清楚）；
- 插件作者多了一项清单字段要维护；漏写只告警不报错，因此需要靠 `pnpm validate` 兜住；
- "声明"与"使用"是两处信息，运行期用到的权限点 CLI 看不到（只有启动日志能看到），
  静态校验覆盖的是清单里可见的那部分；
- `resolveLocalizedText()` 从 `@ricenote/theme-sdk` 下沉到 `@ricenote/shared`
  （插件只依赖 shared / plugin-sdk，不该为了解析文案去依赖 theme-sdk）；
  theme-sdk 保留同名转发，既有导入路径不变。

## 被否决的方案

| 方案 | 否决原因 |
| --- | --- |
| 把权限目录从 authorization 挪到 Core 集中维护 | 只消掉了"插件↔插件"耦合，新增插件仍要改 Core；与 `extensionPoints` / `admin.pages` 的既有形态不一致 |
| 不新增字段，Core 启动时从代码里"自动收集"权限点 | 收集不到 `label` / `group`，权限目录会退化成满屏标识符；且需要反射式扫描插件产物，代价与不确定性都更高 |
| 让插件声明 `defaultRoles`（自己决定默认授予哪些内置角色） | 方向仍错：默认授权是**站点**的决定，不是插件的决定；既然内置角色收敛为 administrator，这个字段就没有存在意义 |
| 保留三个内置角色，但把它们的权限改为"首次创建时写入、之后不重写" | 仍然是插件替站点决定分工；且"三个名字 + 每次升级不知道要不要补权限"会长期暧昧 |
| 直接改 `migrations/0001_authorization.sql` 不再插入三个角色 | 已应用的迁移改内容会让校验值不一致；必须用新迁移修正 |

## 相关实现

- `packages/core/src/security/permission-registry.ts`：声明/使用登记、合并视图、未声明告警
- `packages/core/src/security/permissions.ts`：Core 自有与共用权限点
- `packages/core/src/plugins/{context-factory,manager}.ts`：运行期使用登记与启动期告警
- `packages/shared/manifests/plugin.schema.json` 的 `permissions`：字段契约
- `apps/server/src/cli/validate.ts`：复用同一份登记表做静态校验
- `plugins/official/authorization/src/{permissions,repository,index}.ts`：目录消费与内置角色收敛
- `plugins/official/authorization/migrations/0002_remove_legacy_builtin_roles.sql`：删除历史内置角色
