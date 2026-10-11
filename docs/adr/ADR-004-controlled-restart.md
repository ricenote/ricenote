# ADR-004：插件启停采用受控重启，不支持 Fastify 路由热卸载

- 状态：已接受
- 日期：2026-10-11

## 背景

插件系统承诺"可独立启用与禁用"。Fastify 的 `register` 封装机制支持 `close()`，
但**运行时卸载单个插件注册的路由**在 Fastify 中并不受支持：路由表在 `ready()` 后
即被编译为静态结构，无法安全移除单条路由而不影响其他路由与 hooks。

规划说明书明确指出："Fastify 自带插件封装，但其 register 不等于业务插件安装/停用系统"。

## 决策

1. **启停语义 = 受控重启生效**：管理后台的"启用/禁用"操作写入 `rn_plugins` 状态，
   随后需要重启进程使路由变更生效；后台会明确提示"需要重启"。
2. **注册表必须可逆**：进程内所有注册 API 都返回 `Dispose` / `Unsubscribe` 句柄：
   - `ctx.events.on(...)` → `Unsubscribe`
   - `ctx.routes.page/raw/adminApi(...)` → `Dispose`
   - `ctx.services.provide(...)` → `Dispose`
   - `ctx.slots.register(...)` → `Dispose`
   - `ctx.adminMenu.add(...)` → `Dispose`
   `stop()` 必须调用全部句柄，否则集成测试会因"泄漏"而失败。
3. **禁用前置校验**：若目标插件被其他已启用插件依赖（按 capability 或插件 ID），
   拒绝禁用并返回依赖者清单。

## 理由

- 强行热卸载路由会产生难以复现的中间态（hooks 残留、路由顺序错乱、缓存不一致）；
- 博客类站点对"启停插件需要重启"的容忍度很高，服务中断仅数秒；
- 保证注册表可逆，可以同时获得"干净的运行时状态"与"简单的实现"，两者并不冲突；
- 为将来若需真正的热插拔，保留了明确的演进点（届时需要引入路由版本化或独立进程，见 ADR-001）。

## 后果

**正面**

- 实现简单且行为可预测，避免大量边界 bug；
- 集成测试可以精确断言"禁用后服务/事件/路由/Slot 全部不可见"；
- 与原说明书 ADR-004 一致，不引入架构漂移。

**负面 / 约束**

- 后台必须显式告知用户重启要求，否则会被认为"禁用无效"；
- CLI 需要提供 `ricenote plugin enable/disable` 以便脚本化重启流程；
- 不可在请求处理中途卸载插件（必须等待进程重启）。

## 相关实现

- `packages/core/src/plugins/lifecycle.ts`：状态机与资源注销
- `packages/core/src/plugins/manager.ts`：启停前置校验与依赖阻塞
