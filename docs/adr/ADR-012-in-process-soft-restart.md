# ADR-012：后台「一键重启」采用进程内软重启，不退出进程

- 状态：已接受
- 日期：2026-10-11

## 背景

ADR-004 规定插件启停、插件设置、备份恢复等变更**需要重启进程才生效**，
并把"受控重启"作为架构承诺。但当时重启是纯人工运维动作：
管理员看到"需要重启"提示后，得去服务器上敲 `pm2 restart` / 重启容器 / `Ctrl+C` 再 `pnpm dev`。

这带来两个实际问题：

1. **语义断层**：后台能改状态，却不能让它生效，必须离开后台去做另一件事；
2. **部署形态耦合**：本地 `pnpm dev` 下没有进程管理器，"退出进程再被拉起"并不能保证成功。

## 决策

**用进程内软重启替换人工重启**，由一个新增的 `ServerSupervisor` 编排：

1. **接口语义**：`POST /api/admin/system/restart`（权限 `system.restart`）
   先返回 `202 Accepted`，随后才真正开始重启；
2. **编排顺序**（不可颠倒）：
   1. `server.close()` —— 关闭 HTTP 监听并等待 in-flight 请求结束（保证 202 已写回客户端）；
   2. `kernel.shutdown()` —— 插件 `stopAll()` → 释放数据库连接池；
   3. `bootstrap()` —— 重新装配内核（配置、迁移、主题、插件全部重新装载）；
   4. 重新注入重启执行器 → `startHttpServer()` 监听**同一端口**；
3. **宽限期**：收到请求后延迟约 300ms 才动手，进一步保证响应已发出；
4. **重启期间快速失败**：内核持有 `restarting` 标记，HTTP 层 `onRequest` 钩子对
   新请求返回 `503 RN_RESTART_IN_PROGRESS`（带 `Retry-After`），
   前端据此显示"服务重启中"而不是"网络异常"；
5. **状态落库**：待生效标记写在 `rn_site_state.restart_required` / `restart_reason` /
   `restart_requested_at`，因此**跨进程重启后仍然可见**；bootstrap 成功后清除；
6. **失败不静默**：任一步失败都记录错误并回退到"诊断服务"（与首次启动数据库不可用时的
   行为一致），保证管理员仍能打开页面看到失败原因，而不是留下"端口没人监听但进程还在"；
7. **机制与状态分离**：Core（`core.runtime@1`）只负责状态簿记与请求受理，
   重启**机制**由服务端进程入口通过 `registerRestartHandler()` 注入 ——
   Core 因此不依赖 HTTP 层，测试环境可以只验证状态机。

明确**不做**的事：

- 不做 Fastify 路由热卸载（仍然违反 ADR-004 的理由）；
- 不引入 `RICENOTE_RESTART_MODE=process` 之类的退出模式开关（本 ADR 选定单一路径，
  减少"本地能用、容器里不能用"的配置分叉）。

## 理由

- **与部署形态解耦**：进程内软重启在 `pnpm dev`、`tsx watch`、pm2、Docker 下行为一致，
  不要求运维预先配置 restart policy；
- **响应可预期**：先 202 再重启，前端能精确区分"已受理"与"已完成"（对比轮询 `startedAt`）；
- **失败可诊断**：把"重启失败"纳入既有诊断页面，比让进程静默退出更可运维；
- **状态与机制分离**让 Core 保持"不依赖 HTTP 框架"的边界（这也是 `startHttpServer`
  与 `bootstrap` 一直是两层的原因）。

## 后果

**正面**

- 后台形成了闭环：改设置 → 看到「重启」按钮 → 点击 → 自动等待恢复 → 继续使用；
- 后端与前端都无需知道部署方式；
- 重启动作写入审计日志（`system.restart`），可追溯是谁在什么时候重启了服务。

**负面 / 约束**

- 重启窗口（数秒）内站点不可用，且**连接会被拒绝**（不只是 503），
  因此前端必须按"连接失败也算一次探测"来实现等待逻辑；
- 重启是"整进程"级别，不能在多实例部署下只重启一个实例（v1 单实例，见 ADR-001）；
- 权限点刻意单列 `system.restart`（仅管理员 `*` 天然具备），不下放给内容编辑者；
- `tsx watch` 与软重启可能同时发生（改了源码又点了按钮），此时以最后一次 bootstrap 为准，
  行为仍然收敛。

## 相关实现

- `apps/server/src/runtime/supervisor.ts`：`ServerSupervisor`（编排、失败回退诊断服务）
- `apps/server/src/index.ts`：注入重启执行器、SIGINT/SIGTERM 优雅关停
- `packages/core/src/system/runtime.ts`：`RestartCoordinator`（状态簿记、宽限期、审计友好性）
- `packages/core/src/database/core-migrations.ts`：`rn_site_state` 的待重启列
- `apps/server/src/http/admin/system-routes.ts`：`GET /system/state`、`POST /system/restart`
- `apps/admin/src/stores/system.ts`：前端等待恢复（轮询健康检查 + `startedAt` 变化）
- `docs/plugin-api/v1.md` §15.1
