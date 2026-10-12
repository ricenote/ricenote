# rice.authorization —— 角色与权限

把"用户能做什么"从身份系统中独立出来：定义权限点目录、内置角色与用户-角色分派，
并向 Core 注册**权限解析器**，由 Core 的安全网关执行 fail-closed 鉴权。

> 分工：`rice.identity` 回答"你是谁"，本插件回答"你能做什么"。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.authorization` |
| version | `1.3.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `identity.authorization@1` |
| requires | `identity.users@1: ^1.0.0` |
| capabilities | `database:own`、`services:provide`、`services:consume`、`events:subscribe`、`events:publish`、`routes:admin` |
| migrations | `0001_authorization.sql` |
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

- `core.security@1`（必需）：调用 `registerAuthorizationResolver`，把权限查询能力注入 Core 网关。

### 事件

| 事件 | 时机 |
| --- | --- |
| `identity.authorization.role.assigned.v1` | 角色分派 |
| `identity.authorization.role.revoked.v1` | 角色回收 |
| `identity.authorization.bootstrap.completed.v1` | 内置角色同步完成 |

订阅：`identity.user.created.v1`（`priority: 10`）—— 新用户自动获得默认角色
（后台创建时可指定 `role`，首个用户自动成为管理员）。这是"事件驱动替代数据依赖"的范例：
本插件不 import identity，也不需要它的表。

### 后台界面

菜单项由 `manifest.json` 的 `admin.pages` 声明（不再调用 `ctx.adminMenu.add`，也无需 `admin:menu` 能力）：

`{ id: 'users.roles', label: '角色与权限', path: '/roles', icon: 'ShieldCheck', order: 20, permission: 'user.manage', entry: './admin/main.js' }`

界面代码位于 `admin/main.js`，是**零构建**的纯 ESM 模块（不打包、不装依赖），由 Core 托管并注入同一份 SDK：

- 角色列表：描述、内置标记与权限点（`*` 显示为「全部权限」）；
- 权限点目录：按分组展示；
- 为用户分配角色：填入用户 ID 选择角色；「不能移除最后一个管理员」由服务端约束，界面给出提示。

## 权限点目录（1.2.0）

| 组 | 权限点 |
| --- | --- |
| 内容 | `post.view`、`post.write`、`post.publish`、`post.delete`、`page.view`、`page.manage`、`taxonomy.manage`、`media.manage` |
| 互动 | `comment.moderate` |
| 外观 | **`nav.view`**、**`nav.manage`**、`theme.view`、`theme.manage`（站点信息写入也用 `theme.manage`） |
| 扩展 | `plugin.view`、`plugin.manage` |
| 用户 | `user.manage` |
| 系统 | `system.audit`、`system.maintain`、`system.restart` |

内置角色：

| 角色 | 权限 |
| --- | --- |
| `administrator` | `*`（全部权限） |
| `editor` | 内容全量（含 `page.*`）+ 评论审核 + 导航管理（`nav.*`）+ `theme.view` + `plugin.view` |
| `author` | `post.view/write/publish`、`page.view`、`nav.view`、`media.manage` |
| `contributor` | `post.view/write`、`page.view`、`nav.view` |
| `nav.manage`（谁会用到） | 改导航栏的人：管理员与编辑；作者/投稿者只能看 |

> 内置角色的权限以**代码为准**（`src/permissions.ts`），每次启动同步，
> 因此升级插件即可获得新增权限点；自定义角色不受影响。

## 设置项

无（该插件没有可配置项）。

## 依赖与启停

- 硬依赖 `identity.users@1`：identity 被禁用时本插件会被依赖解析排除，
  此时 Core 的权限解析器缺失 → 除 `*` 之外的权限一律不通过（fail-closed）；
- 停用后角色数据保留在库中，重新启用即恢复。
