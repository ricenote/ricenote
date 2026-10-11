# ADR-011：站点信息采用「运行时覆盖层」，插件设置采用「声明式表单 + 重启生效」

- 状态：已接受
- 日期：2026-10-11

## 背景

两处配置语义在 v0.2.0 时都不完整：

1. **站点信息只来自 `.env`**：`config.site.*` 在启动时读取，并被 `ctx.site` 与渲染上下文
   **快照**。后台「系统设置」只能只读展示，页面文案甚至写着"后台不提供任意配置写入"。
   改一次站点标题要改 `.env` 并重启，这对"标题/描述/Logo/备案"这类高频小改动很别扭。
2. **插件设置只有默认值**：`manifest.settings` 是自由对象，没有表单声明；
   后台只能以键值形式编辑，且保存后**不会生效**（`ctx.config` 是启动期快照），
   但用户无从得知这一点。

同时，Core 已经具备可复用的基础设施：`rn_plugin_settings` 表 + `PluginManager.readSettings/writeSettings`
（含 revision 乐观锁），以及 `@ricenote/theme-sdk` 的整套设置校验与多语言解析实现。

## 决策

### 站点信息：DB 稀疏覆盖 `.env`，实时生效

1. 新增 Core 表 `rn_site_settings`（`site_id` / `settings_json` / `revision` / `updated_by` / `updated_at`），
   只存**被后台显式修改过的字段**（稀疏覆盖）；
2. 生效值 = `.env` 默认值 + 覆盖层，由 `SiteSettingsProvider` 统一提供：
   - 读取路径**同步**（带内存缓存与 revision），因为渲染与 `ctx.site` 都在热路径；
   - 写入路径做**字段白名单 + 类型/长度/URL 校验 + revision 乐观锁**，并失效 HTML 缓存
     （缓存键也纳入站点 revision）；
3. `ctx.site` 由"启动期快照"改为**动态取值**（context-factory 用 getter 实现），
   渲染上下文的 `site` 同样实时读取；
4. **不需要重启**：没有插件在启动期依据站点标题做装配决策。

### 插件设置：声明式表单 + 保存后重启生效

1. `manifest.settingsSchema`（可选）声明「分组 + 字段」，与主题设置**共用同一份 JSON Schema
   定义**（`packages/shared/manifests/settings.schema.json`）与同一套校验/解析实现；
2. 旧写法 `manifest.settings` 保留且语义不变；合并顺序为
   「`settings` 默认值 → `settingsSchema` 默认值 → 数据库覆盖」；
3. 保存接口（`PUT /api/admin/plugins/:pluginId/settings`）：
   - 校验（声明式走字段级校验，旧写法只校验"键必须在声明范围内"）；
   - **合并式写入**（只覆盖提交的字段，避免局部提交清空其他字段）；
   - 成功后调用 `core.runtime@1` 的 `markRestartRequired()`，后台顶栏出现「重启」按钮；
4. `ctx.config` 保持**启动期快照**语义不变（插件可能在 `start()` 中依据配置注册路由/服务），
   因此"改设置必须重启"是**设计**而非缺陷，并被显式呈现给用户；
5. 复杂插件可以完全自定义设置页（注册后台菜单 + 自己的管理 API），Core 不强制声明式表单。

## 理由

- **按"是否需要重启"区分两类配置**，而不是统一成一种：
  - 站点信息只需被"读"，实时读取代价极低且体验收益大；
  - 插件配置可能决定启动期装配，强行热更新会引入"路由已注册但配置变了"的不一致态；
- 稀疏覆盖让 `.env` 继续作为默认值与兜底（清空某项即回落），
  不会出现"后台改坏了却不知道原值是什么"；
- 与主题设置共用声明结构与校验实现，避免第二套平行机制（第二套机制必然漂移）；
- 白名单 + 乐观锁把"后台可写配置"的风险控制在与主题设置相同的量级。

## 后果

**正面**

- 站点标题/描述/语言/地址/Logo/图标/备案均可后台即改即生效，无需重启；
- 插件设置有了自动生成的表单与字段级错误提示，且"需要重启"变得可见、可一键完成；
- 主题作者与插件作者面对的是同一套字段类型与多语言规则。

**负面 / 约束**

- 站点信息的读取路径依赖内存缓存，因此**所有**修改入口必须走 `SiteSettingsProvider.update()`
  （直接写库不会刷新缓存）；备份恢复后需要显式 `refresh()`（已在恢复流程中调用）；
- `ctx.config` 与 `ctx.site` 的时效性不同，文档必须讲清楚（已写入 plugin-api §7）；
- 站点信息写入需要 `theme.manage` 权限（复用"管理主题与设置"这一权限点）。

## 相关实现

- `packages/core/src/system/site-settings.ts`：`SiteSettingsProvider` + 白名单校验
- `packages/core/src/system/runtime.ts`：待生效状态与重启受理
- `packages/core/src/plugins/settings-schema.ts`：插件设置解析与校验
- `packages/core/src/database/core-migrations.ts`：`0004_site_settings_and_restart`
- `packages/core/src/render/renderer.ts` / `plugins/context-factory.ts`：实时取站点信息
- `apps/server/src/http/admin/system-routes.ts`：`GET/PUT /api/admin/site`
- `apps/server/src/http/admin/plugins-routes.ts`：插件设置读写
- `apps/admin/src/components/settings/SettingsForm.vue`：主题与插件共用的表单组件
- `docs/plugin-api/v1.md` §12、`docs/theme-api/v1.md` §3
