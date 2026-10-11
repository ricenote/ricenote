# 架构决策记录（ADR）索引

本目录记录 RiceNote 的关键架构决策。每条 ADR 一经接受即冻结，变更需新增 ADR 而非改写历史。

| 编号 | 标题 | 状态 |
| --- | --- | --- |
| [ADR-001](ADR-001-modular-monolith.md) | v1 采用模块化单体，而非微服务 | 已接受 |
| [ADR-002](ADR-002-nunjucks-ssr-themes.md) | 主题仅使用 Nunjucks + CSS/JS，前台默认 SSR | 已接受 |
| [ADR-003](ADR-003-declarative-theme-settings.md) | 主题设置采用 Manifest 声明式表单，保存与预览分离 | 已接受 |
| [ADR-004](ADR-004-controlled-restart.md) | 插件启停采用受控重启，不支持路由热卸载 | 已接受 |
| [ADR-005](ADR-005-security-control-plane-in-core.md) | 管理安全控制面保留在 Core，用户/权限业务仍为插件 | 已接受 |
| [ADR-006](ADR-006-admin-ui-shadcn-vue.md) | 管理后台 UI 采用 shadcn-vue | 已接受 |

## 说明书「待定项」的默认取值（M0–M2 实现依据）

原规划说明书第 13 章留下三项待定，实现期按以下取值落地，避免阻塞：

1. **依赖版本锁定**
   - Node.js：`>= 20.11`（开发机实测 22.23.x）
   - TypeScript：`^5.7`
   - Fastify：`^5`
   - MySQL：`8.x`（开发机 MySQL 8.0.45；Compose 镜像使用 `mysql:8.4`）
   - Drizzle ORM：`^0.38`
   - Nunjucks：`^3.2`
   - Vue / Vite：`^3.5` / `^5`
   - Tailwind CSS：`3.4.17`
   - 正式发布前需在本文档中补记锁定的精确版本与校验和。

2. **是否支持多站点**
   - v1 **单站点**，站点标识固定为 `default`。
   - 但 `rn_site_state`、`rn_theme_settings`、`rn_posts` 等表均保留 `site_id` 字段作为扩展点，
     且所有 Core 服务以 `siteId` 作为显式参数，为后续多站点留出升级路径。

3. **主题设置字段的 i18n 与 SDK 文档自动生成**
   - v1 采用"字段 `label` 即字面量"的最小方案；`theme.json` 允许 `label` 直接写中文。
   - 多语言留待 v2，预留形式为 `label` 可扩展为 `{ "zh-CN": "...", "en": "..." }` 对象。
   - SDK 文档当前手工维护于 `docs/plugin-api`、`docs/theme-api`；
     后续可基于 `packages/shared/manifests/*.schema.json` 自动生成字段说明。
