# ADR-005：管理安全控制面保留在 Core，用户/权限业务仍为插件

- 状态：已接受
- 日期：2026-10-11

## 背景

若"用户认证"与"权限校验"全部下沉为插件，会出现一个致命的安全悖论：
**只要禁用权限插件，管理接口就失去了守卫**。攻击者（或误操作）可以通过禁用插件来绕过鉴权。

但另一方面，若把用户与角色全部内建进 Core，又违背"Core 不内建业务实体"的原则。

## 决策

将"安全控制面"与"身份业务"分离：

| 归属 | 内容 |
| --- | --- |
| **Core（安全网关）** | 会话 Cookie 边界（HttpOnly/SameSite）、CSRF Token 校验、能力校验入口、审计写入、**默认拒绝**策略、恢复模式的最小管理员登录 |
| **identity 插件（业务）** | 用户表、密码哈希、登录/登出流程、会话存储、管理员账号初始化 |
| **authorization 插件（业务）** | 角色、权限点、角色-权限映射、用户-角色映射 |
| **Core（不可禁用）** | 恢复模式：当 identity / authorization 插件缺失或失败时，Core 仍提供最小化的安装与维护入口 |

关键规则：

1. **默认拒绝（fail-closed）**：能力校验在"无法确定权限"时一律拒绝，绝不默认放行。
2. **网关不依赖插件存活**：`SecurityGateway` 的鉴权链路在插件不可用时退化为
   "仅允许恢复模式入口 + 其他管理接口一律 403"。
3. **权限点由插件声明、Core 校验**：插件通过 `ctx.routes.adminApi({ permission })` 声明所需权限点，
   Core 在路由层统一校验，插件内部无需重复实现鉴权。
4. **审计不可绕过**：所有管理写操作经 Core 的审计通道记录到 `rn_audit_logs`。

## 理由

- 消除"禁用插件即绕过鉴权"的攻击路径；
- Core 依然不持有用户/角色业务数据，符合"内核最小化"；
- 权限点集中校验避免每个插件各自实现鉴权而产生不一致；
- 恢复模式保证在无业务插件时站点仍可被管理员修复。

## 后果

**正面**

- 安全边界清晰且不可通过插件开关绕过；
- 新插件接入管理后台时，鉴权与审计"自动获得"，降低出错概率；
- identity 插件可以被替换（如换成 OAuth/LDAP 实现）而不影响安全基线。

**负面 / 约束**

- 需要定义"最小安全契约"（Core 与 identity 插件之间的接口），该契约必须稳定；
- 恢复模式必须自带一套最小的管理员凭据引导逻辑，增加了 Core 的复杂度（约一个模块）；
- 插件作者必须理解 permission 命名规范，文档成本上升。

## 修订（2026-10-12，见 ADR-018）

本 ADR 的决策**不变**：安全控制面留在 Core、鉴权 fail-closed、插件只声明所需权限点。

被落实与修订的是第 3 条"**权限点由插件声明**"到底落在哪里：

- 过去"声明"只体现在 `ctx.routes.adminApi({ permission })` 这样的**使用**上，
  而权限点的展示文案与归属都硬编码在 authorization 插件的 `permissions.ts` 里；
- 现在权限点在**各插件自己的** `manifest.permissions` 里声明（含多语言文案与分组），
  Core 自己声明控制面与共用权限点（`theme.*` / `plugin.*` / `user.manage` / `system.*`），
  由 Core 聚合、校验全局唯一，并通过 `core.security@1` 暴露给 authorization 展示。

同时本 ADR 的"authorization 插件（业务）：角色、权限点、角色-权限映射"**收窄**：
authorization 不再持有权限点目录，也不再把内置角色当作"替站点决定分工"的手段 ——
内置角色只保留 `administrator`（`*`），其余角色由站点管理员自建。

详见 ADR-018。

## 相关实现

- `packages/core/src/security/gateway.ts`：能力校验与 fail-closed 策略
- `packages/core/src/security/session.ts` / `csrf.ts` / `audit.ts`
- `packages/core/src/security/permission-registry.ts`：权限点声明/使用的聚合（ADR-018）
- `apps/server/src/recovery/recovery-mode.ts`：无业务插件时的安装/维护界面
