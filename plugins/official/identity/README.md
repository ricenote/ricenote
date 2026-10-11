# rice.identity —— 身份与认证

用户账号、会话与登录取证能力的唯一实现：Core 通过它解析"当前请求是谁"，
其他插件通过 `identity.users@1` 获取作者/评论者显示名，**不直接查询用户表**。

> 角色与权限**不在本插件**：由 `rice.authorization` 负责（职责分离，避免循环依赖）。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.identity` |
| version | `1.3.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `identity.auth@1`、`identity.users@1` |
| requires | 无 |
| capabilities | `database:own`、`services:provide`、`services:consume`、`routes:admin`、`events:publish`、`events:subscribe` |
| migrations | `0001_identity.sql` |
| 数据表 | `rn_identity_users`、`rn_identity_sessions` |

## 扩展点（Hook）

### 管理 API

| 方法 | 路径 | 权限点 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/users` | `user.manage` | 用户列表（自动补齐角色） |
| POST | `/api/admin/users` | `user.manage` | 新建用户 |
| POST | `/api/admin/users/:userId/password` | `user.manage` | **管理员重置他人密码**（重置后强制该用户全部会话失效） |
| POST | `/api/admin/me/password` | 仅需登录 | 本人改密（校验原密码） |

> 重置接口**拒绝重置自己**：本人改密必须走 `/me/password` 校验原密码，
> 否则一个被盗用的管理员会话可以无声换掉账号密码。
>
> `GET /api/admin/me` 与 `PUT /api/admin/me`（资料读取/修改）由 Core 提供，
> 写入仍经本插件的服务契约完成。

### 服务契约（提供）

- `identity.auth@1`：`login` / `resolveSession` / `logout` / `ensureBootstrapAdmin` /
  `changePassword` / **`updateProfile`** / **`resetPassword`** / `listUsers` / `countUsers` /
  `countActiveSessions`
- `identity.users@1`：`findById` / `displayNames`

### 服务契约（消费）

| 契约 | 必需性 | 用途 |
| --- | --- | --- |
| `core.security@1` | 必需 | 注册会话解析器（依赖倒置：Core 不 import 插件实现） |
| `core.setup@1` | 必需 | 取首次启动的管理员凭据（`.env` 的 `BOOTSTRAP_ADMIN_*`） |
| `identity.authorization@1` | 可选 | 用户列表展示角色 |

### 事件

| 事件 | 时机 |
| --- | --- |
| `identity.session.created.v1` | 登录成功创建会话后 |
| `identity.user.created.v1` | 创建用户（首次启动的管理员 / 后台新建） |
| `identity.user.password.changed.v1` | 本人改密（无额外字段）或管理员重置（`byAdmin: true`） |
| `identity.user.profile.updated.v1` | 修改显示名/邮箱后 |

订阅：`core.runtime.started.v1`（在 authorization 订阅就绪后创建初始管理员，
避免"事件已发但无人处理"导致管理员拿不到角色）。

### 后台界面

菜单项由 `manifest.json` 的 `admin.pages` 声明（不再调用 `ctx.adminMenu.add`，也无需 `admin:menu` 能力）：

`{ id: 'users.list', label: '用户', path: '/users', icon: 'Users', order: 30, permission: 'user.manage', entry: './admin/main.js' }`

界面代码位于 `admin/main.js`，是**零构建**的纯 ESM 模块（不打包、不装依赖），由 Core 托管并注入同一份 SDK：

- 用户列表：状态、角色、最后登录；服务端分页与关键词搜索；
- 新建用户：用户名 / 显示名 / 邮箱 / 初始密码 / 角色；
- 管理员**重置他人密码**：本人行显示「用「个人资料」改密」指引，重置前有二次确认（后端刻意拒绝重置自己）。

## 设置项（`settingsSchema`，后台自动生成表单）

后台「扩展中心 → 身份与认证 → 设置」。保存后需**重启服务**生效。
只影响之后新建立的会话，已有会话沿用签发时的有效期。

### 分组「会话」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `sessionTtlSeconds` | number（300–2592000） | `7200` | 会话有效期（秒） |
| `maxSessionsPerUser` | number（1–100） | `10` | 单用户并发会话上限（超出时吊销最旧的） |

## 密码与安全策略

- 哈希：`scrypt`（`密码$盐$派生值` 格式，校验使用 `timingSafeEqual`）；
- 强度：≥ 8 位、不能纯数字、不能与用户名相同（服务端二次校验）；
- 登录失败与用户名不存在耗时对齐，降低用户名枚举的可观测差异；
- 改密/重置后强制吊销该用户全部会话。

## 依赖与启停

- 无插件级依赖，可独立启停；
- 被禁用后：Core 无法解析会话 → 后台所有受保护接口返回 401（fail-closed），
  且以 `identity.users@1` 为硬依赖的 posts、authorization 会被依赖解析排除。
