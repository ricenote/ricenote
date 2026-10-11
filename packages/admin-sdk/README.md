# @ricenote/admin-sdk —— 后台界面 SDK

插件自带后台界面所使用的组件库与运行时能力。**后台 SPA 与插件界面共用同一份**，
因此插件的页面在观感、权限、提示、待重启提示上与官方页面完全一致。

- 面向插件作者的用法与约束：`docs/plugin-api/v1.md` 第 16 节
- 架构决策与代价（单实例、同源信任、CSP 依赖）：`docs/adr/ADR-014-plugin-owned-admin-ui.md`

## 两种使用形态

| 形态 | 入口 | 使用方 |
| --- | --- | --- |
| 浏览器 ESM（零构建） | `/admin-sdk/v1/ricenote-admin.js`（由 Core 托管） | 插件 `admin/main.js` |
| 源码导出（TS） | `@ricenote/admin-sdk`（`exports` 指向 `src/index.ts`） | 类型检查、构建型消费方 |

> 后台 SPA 自身也通过 `external` 指向托管 URL：**宿主与插件必须是同一个模块实例**，
> 否则 `provide/inject`、响应式与全局状态（会话、提示条）都会各走各的。

## 构建产物

```bash
pnpm --filter @ricenote/admin-sdk build
```

产出 `dist/browser/`：

| 文件 | 说明 |
| --- | --- |
| `vue.js` | Vue 官方 `esm-browser.prod`（**含运行时编译器**，插件模板字符串需要） |
| `vue-router.js` | Vue Router 官方 `esm-browser.prod`；内部 `from "vue"` 已在构建时改写为托管 URL |
| `ricenote-admin.js` | SDK 主体（组件 + 令牌入口 + api + composables），Vue 外部化为托管 URL |
| `SINGLETON.md` | 产物说明（不要手工编辑这些文件） |

构建期有两条断言，防止"两个 Vue 实例"这类极难排查的问题：

1. 产物必须引用 `/admin-sdk/v1/vue.js`（Vue 已外部化）；
2. 产物中不允许出现**裸模块名**（`from "vue"` / `from "@vue/devtools-api"`）——
   浏览器无法解析，必须使用生产版产物或把它外部化。

## 内容清单

| 分类 | 内容 |
| --- | --- |
| 设计令牌 | `src/styles/index.css`：颜色/圆角/字体令牌、后台公共类（`rn-card`/`rn-th`/`rn-td`）、无阴影与无毛玻璃兜底规则 |
| 原子组件 | Badge、Button、Card、Dialog、Input、Label、Select、Switch、Textarea、Toaster |
| 复合组件 | AdminPage、DataTable、Field、Pagination、Tabs、EmptyState、LoadingState、ConfirmDialog、Icon |
| 能力 | `api`（CSRF/会话/错误归一化）、`useSession`、`useToast`、`useSystemState`、`useAsyncData`、`navigate`、`defineAdminPage`、`createAdminSdk`、`setHostContext` |
| 工具 | `cn`、`formatDateTime`、`formatDate`、`formatBytes`、`formatDuration`、`resolveIcon` |
| 自省 | `SDK_VERSION`、`sdkInstanceCount()`（正常恒为 1） |

## 视觉硬约束（不可违背）

主色为柠檬浅黄 `#FDE047`（黄底禁用白字）；**禁用阴影与毛玻璃**；
层级只用 1px 边框与背景色差表达。SDK 组件与插件自有样式都要遵守。

## 给后台 SPA 的接入方式

`apps/admin/vite.config.ts`：

- 开发（`serve`）：`hostedVue()` 插件把 `vue` / `vue-router` / `@ricenote/admin-sdk`
  解析为托管 URL 并标记 external；`base` 必须是 `/`，避免 Vite 加前缀后产生第二份实例。
- 生产（`build`）：`rollupOptions.external` + `output.paths` 产出同样的 URL。

`apps/admin/src/main.ts`：`app.use(createAdminSdk())` 全局注册组件、
`setHostContext({ navigate })` 注入宿主路由。

## 注意

- 修改本包的**组件**后必须重新构建（后台加载的是产物，不是源码）；
- 开发期托管资源为 `no-cache`，生产为 `immutable`（路径里带 `/v1/` 大版本）；
- 新增图标请加入 `src/icons.ts` 的受控映射（全量 lucide 会让产物膨胀数倍）。
