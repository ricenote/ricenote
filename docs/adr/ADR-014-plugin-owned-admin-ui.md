# ADR-014：插件自带后台界面 + 后台界面 SDK（零构建、动态挂载、单实例）

## 状态

已接受（v0.4.0）。修订范围：说明书 §9「管理后台信息架构」、ADR-006 的适用范围。

## 背景

v1 把后台做成**单一 Vue SPA**，插件只贡献菜单项，界面代码写在 Core 的
`apps/admin/src/views/*.vue` 里，并由 `router.ts` 静态登记。这带来三个真实问题：

1. **归属混乱**：8 个插件功能的页面（文章/页面/导航栏/分类/媒体/评论/用户/角色）
   都长在 Core 里，看目录树无法判断"这个界面属于谁"；
2. **停用不等于消失**：插件停用后界面文件仍在，管理员直敲地址还能进入，
   然后撞一串接口 404；`docs/plugin-api/v1.md` §12.4 承诺的"插件注册自己的后台页面"
   实际上落不了地（未知路径被兜底重定向吃掉）；
3. **生态受限**：第三方插件无法自带界面，任何界面需求都要改 Core 并重新发版。

## 决策

1. **插件自带后台界面**：界面代码放在插件目录 `admin/` 下（`plugins/<id>/admin/main.js`），
   由 Core 托管在 `/plugin-admin/:pluginId/**`，以菜单项下发的 `entryUrl` 交给前端动态 `import()`。
2. **零构建**：插件界面是**纯 ESM 模块**（模板写在 JS 字符串里），不装依赖、不跑打包，
   与"零构建主题"（ADR-002）保持同一理念：作者只需写 JS。
3. **新建后台界面 SDK（`@ricenote/admin-sdk`）**：组件（10 个原子 + 9 个复合）、
   设计令牌、`api` 客户端、会话/提示/运行状态等组合式能力都收在这里；
   Core 自己的后台页面也改用 SDK，**组件与令牌只有一份定义**。
4. **单实例托管**：SDK 与 Vue、Vue Router 由 Core 以唯一 URL 托管
   （`/admin-sdk/v1/{vue.js,vue-router.js,ricenote-admin.js}`），
   **宿主 SPA 与插件界面都从这些 URL 加载**。宿主不在自己 bundle 里打包 Vue/SDK。
5. **声明式菜单**：`manifest.json` 新增 `admin.pages[]`（`id/label/path/icon/order/permission/entry`），
   Core 在插件启动时注册菜单并校验入口存在性；`ctx.adminMenu.add` 保留为兼容路径，
   但官方插件已全部迁移（声明式不需要 `admin:menu` 能力）。
6. **宿主是通用组件**：Core 提供 `PluginHostView.vue`（与具体插件无关），
   负责加载态、错误边界、加载失败分类提示、未启用提示与样式注入；
   路由由菜单驱动**动态注册**（URL 与插件声明一致，书签不受影响）。
7. **停用即可见性**：插件停用后菜单条目消失、资源 404；但声明仍在
   （`GET /menu` 下发 `available: false`），因此直接访问该书签时给出
   "该功能由插件提供、当前未启用"的明确提示，而不是 404 或静默跳转。

## 理由

- **归属随插件走**：安装、启用、停用、卸载决定了界面是否存在，Core 里不再有插件专属文件；
- **零构建 + SDK 让第三方门槛最低**：不需要前端工程能力就能做出与官方一致的页面；
- **单实例是硬约束**：宿主与插件必须共用同一份 Vue，否则 `provide/inject`、
  响应式、`h()` 渲染都会出问题（本项目实测：两份 Vue 时表现是**页面一片空白且控制台干净**，
  极难定位）；SDK 内部持有会话/权限/提示条等全局状态，同理必须只有一份；
- **动态挂载而不是 iframe**：观感与交互与官方页面完全一体，不引入跨文档通信协议。

## 代价与约束（必须知悉）

1. **插件前端脚本在后台同源上下文执行**：等价于"以当前登录用户身份调用任意
   `/api/admin/*`"。这与"插件服务端代码在进程内运行、没有真实沙箱"是同一事实，
   **它不是安全沙箱**；扩展中心与文档都必须保留高风险提示。
2. **依赖 Vue 的运行时编译器**：零构建的 `template` 字符串需要 `new Function`。
   当前全仓库没有 CSP，因此可用；**一旦引入严格 CSP（`script-src` 不含 `unsafe-eval`）
   就必须改造**（改用渲染函数，或放宽 CSP）。
3. **开发期 base 必须是 `/`**：Vite 会给"项目内文件的根绝对路径 import"加 base 前缀，
   导致同一个托管 URL 出现两种写法 → 两份 Vue。因此
   `apps/admin/vite.config.ts` 在 `serve` 时用 `base: '/'`（生产仍为 `/admin/`），
   路由侧统一取 `import.meta.env.BASE_URL`。
4. **样式范围受 Tailwind 静态扫描限制**：插件模板里的工具类不在构建期扫描范围内，
   因此有三个层次：SDK 组件承载主要外观 → 受控工具类白名单（`safelist`）→
   插件可自带 `admin/style.css`（宿主动态注入）。这条必须写进插件文档。
5. **改 SDK 组件需重新构建 SDK**：宿主加载的是 SDK 产物而非源码，
   改完 `packages/admin-sdk` 要 `pnpm --filter @ricenote/admin-sdk build`
   （开发期缓存为 `no-cache`，不需要清浏览器缓存）。
6. **进程内软重启不会重载界面代码**：与插件服务端代码同理（见 ADR-012），
   改动后必须重启进程。

## 被否决的方案

| 方案 | 否决原因 |
| --- | --- |
| 微前端 / iframe 沙箱 | 拿不到设计令牌、导航割裂、通信成本高；且在"插件服务端代码本来就在进程内"的前提下并不提升安全性 |
| 插件自带整页 HTML（`routes.raw` + 侧栏外链） | 后台体验退化为"点击整页刷新"，Core 无法保证视觉一致。留作将来"复杂工具型插件"的备选，需要时另出 ADR |
| 插件打包自己的 Vue | 直接违反单实例硬约束（实测表现是页面空白且控制台干净，极难定位） |
| 让第三方插件改 Core 提交页面 | 与"业务皆插件"的定位冲突，且把生态门槛抬到必须能改核心代码 |

## 相关实现

- `packages/admin-sdk/`：SDK 本体（组件/令牌/api/composables/defineAdminPage）与浏览器产物构建
- `apps/server/src/http/admin-sdk-assets.ts`：`/admin-sdk/v1/**` 托管（MIME 白名单、防穿越、
  生产 `immutable` / 开发 `no-cache`、缺产物仅告警）
- `apps/server/src/http/plugin-admin-assets.ts`：`/plugin-admin/:pluginId/**` 托管
  （登录 + 插件启用校验 + 限定 `admin/` 目录 + `no-cache`）
- `packages/core/src/plugins/admin-pages.ts`：声明解析、入口换算、菜单注册
- `apps/admin/src/views/PluginHostView.vue`：通用宿主（四态 + 错误边界 + 样式注入）
- `apps/admin/src/router.ts`：菜单驱动动态路由
- `tests/unit/plugin-admin-pages.test.ts`、`tests/integration/http-surface.test.ts`：契约与托管校验
