# rice.authorization —— 角色与权限

把"用户能做什么"从身份系统中独立出来：维护内置角色与用户-角色分派、展示权限点目录，
并向 Core 注册**权限解析器**，由 Core 的安全网关执行 fail-closed 鉴权。

> 分工：`rice.identity` 回答"你是谁"，本插件回答"你能做什么"。
>
> 本插件**不持有权限点目录**：权限点由各插件在自己的 `manifest.permissions` 里声明、
> 由 Core 声明控制面与共用权限点，Core 校验全局唯一并聚合成
> `core.security@1` 的 `listDeclaredPermissions()`，本插件只做本地化展示。
> 因此新增插件无需改动本插件（见 `docs/adr/ADR-018-plugin-permission-declarations.md`）。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.authorization` |
| version | `1.4.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `identity.authorization@1` |
| requires | `identity.users@1: ^1.0.0` |
| capabilities | `database:own`、`services:provide`、`services:consume`、`events:subscribe`、`events:publish`、`routes:admin` |
| migrations | `0001_authorization.sql`（建表）、`0002_remove_legacy_builtin_roles.sql`（删除历史内置角色） |
| 数据表 | `rn_authz_roles`、`rn_authz_role_permissions`、`rn_authz_user_roles` |

## 扩展点（Hook）

### 管理 API

| 方法 | 路径 | 权限点 |
| --- | --- | --- |
| GET | `/api/admin/roles` | `user.manage` |
| GET | `/api/admin/permissions` | `user.manage` |
| POST | `/api/admin/users/:userId/roles` | `user.manage` |
| DELETE | `/api/admin/users/:userId/roles/:role` | `user.manage` |

### 服务契约（提供）

`identity.authorization@1`：`permissionsOf` / `rolesOf` / `listRoles` / `listPermissions` /
`assignRole` / `revokeRole`。

### 服务契约（消费）

- `core.security@1`（必需）：
  - `registerAuthorizationResolver`：把权限查询能力注入 Core 网关；
  - `listDeclaredPermissions()`：取"声明 + 使用"的合并视图，作为权限目录的数据源。

### 事件

| 事件 | 时机 |
| --- | --- |
| `identity.authorization.role.assigned.v1` | 角色分派 |
| `identity.authorization.role.revoked.v1` | 角色回收 |
| `identity.authorization.bootstrap.completed.v1` | 首个用户成为管理员后发出 |

订阅：`identity.user.created.v1`（`priority: 10`）：
**首个用户**自动成为 `administrator`；其余新用户**默认不分配角色**
（后台创建时显式指定了 `role` 才分派，找不到该角色则记警告并跳过）。
这是"事件驱动替代数据依赖"的范例：本插件不 import identity，也不需要它的表。

### 后台界面

菜单项由 `manifest.json` 的 `admin.pages` 声明（不再调用 `ctx.adminMenu.add`，也无需 `admin:menu` 能力）：

`{ id: 'users.roles', label: '角色与权限', path: '/roles', icon: 'ShieldCheck', order: 20, permission: 'user.manage', entry: './admin/main.js' }`

界面代码位于 `admin/main.js`，是**零构建**的纯 ESM 模块（不打包、不装依赖），由 Core 托管并注入同一份 SDK：

- 角色列表：描述、内置标记与权限点（`*` 显示为「全部权限」）；
- 权限点目录：按分组展示；
- 为用户分配角色：填入用户 ID 选择角色；「不能移除最后一个管理员」由服务端约束，界面给出提示。

## 权限点目录

权限点不在本插件里声明。目录 = Core 的聚合视图：

1. **声明**：各插件 `manifest.permissions`（`key` + `label` + `group`，文案支持多语言）
   与 Core 的控制面权限点（`theme.*`、`plugin.*`、`user.manage`、`system.*`）；
2. **使用**：`manifest.admin.pages[].permission`、`contributions[].permission` 与运行期
   `ctx.routes.adminApi({ permission })` / `ctx.adminMenu.add({ permission })`；
3. **展示**：本插件按站点语言解析文案后返回给后台。

两条规则（与启动期、`pnpm validate` 完全一致）：

| 情况 | 处理 |
| --- | --- |
| 同一标识被两方声明 | 报错（`RN_MANIFEST_INVALID`），启动失败、`pnpm validate` 失败 |
| 标识被使用但无人声明 | 仅警告；该权限点以「未登记」分组出现在目录里，**仍可分配**（鉴权不依赖声明） |

## 内置角色

**只有 `administrator`（`*`）**：启动时只保证它存在、`builtin = 1`（不可删除）、权限含 `*`。

`editor` / `author` / `contributor` **不再是内置角色**：插件不该替站点决定"谁该有什么权限"。
升级时这三个角色连同它们的角色-权限、用户-角色关联由
`migrations/0002_remove_legacy_builtin_roles.sql` 一次性删除；请按自己的分工在后台自建角色。

> 与旧行为的区别：过去内置角色的权限**每次启动都会被 DELETE 后重写**（"以代码为准"），
> 管理员在后台的调整会在重启后消失。现在不再重写 —— 所有角色的权限都由管理员维护。

## 设置项

无（该插件没有可配置项）。

## 依赖与启停

- 硬依赖 `identity.users@1`：identity 被禁用时本插件会被依赖解析排除，
  此时 Core 的权限解析器缺失 → 除 `*` 之外的权限一律不通过（fail-closed）；
- 停用后角色数据保留在库中，重新启用即恢复。
