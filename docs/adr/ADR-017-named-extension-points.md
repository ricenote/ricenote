# ADR-017：命名扩展点（三作用域统一模型）与内容自定义字段

- 状态：已接受
- 日期：2026-10-12
- 修订：[ADR-014](ADR-014-plugin-owned-admin-ui.md)（把"插件自带后台界面"从"只能提供页面"推广为"可声明挂载点供别的插件接入"）、
  [ADR-003](ADR-003-declarative-theme-settings.md)（把声明式设置字段的定义复用到内容自定义字段）

## 背景

到 ADR-014 为止，插件能"自带后台界面"，但**只能提供页面、无法被别的插件扩展**：

1. 插件与站点交互的全部通道是 `ctx.routes` / `ctx.services` / `ctx.events` / `ctx.slots` / `ctx.adminMenu`
   （见 `docs/architecture/hooks-inventory.md` §0）。其中**唯一**"往别人界面里放东西"的通道是
   `ctx.slots.register`，而它只覆盖站点渲染（render），且调用方只能"塞片段"，没有"接管"概念。
2. "在文章列表页加一个「新建」按钮、在编辑器工具栏加一个按钮、把正文编辑器换成 Markdown 双栏"
   这类需求属于 **admin 作用域**，此前没有任何机制。唯一的办法是让内容插件去 import 别的插件
   （违反"插件之间只走契约"），或 Core 为它写死。
3. 反过来，内容插件也无法声明"我的编辑页有哪些挂载点、会传给贡献者什么数据"。
4. 站点渲染侧的既有插槽还有一处历史包袱：没有"替换"——只能追加，无法用插件整体接管默认区块
   （例如媒体库面板要替换掉消费者默认的"直接填链接"输入框）。

此外，主题设置（ADR-003）已经有一套成熟的**声明式字段定义**（类型白名单、范围约束、多语言文案），
而"文章/页面里属于版式的字段"（如特色图片）此前无处安放：逐字段加列要随主题迁移，放任自由键又无法校验。

## 决策

### 1. 一套注册表，三个作用域

`ExtensionRegistry`（`packages/core/src/extensions/registry.ts`）是**声明 — 贡献 — 渲染/触发**的
唯一事实来源。三个作用域共用同一份记录结构与裁决规则，但注册表**不解释 payload**：

| 作用域 | payload 形状 | 谁渲染 / 触发 |
| --- | --- | --- |
| `render` | `SlotComponent`（`{ name, render(context) }`） | Core 渲染管线的模板 `slot()` helper |
| `admin` | **浏览器可 import 的 ESM 模块 URL 字符串** | 后台 SPA 的 `<PluginSlot>` |
| `server` | `ExtensionHookModule`（`{ apply(payload, ctx) }`） | 提供方在自己的流程里 `ctx.extensions.apply()` |

payload 形状按作用域而异是**刻意**的：渲染作用域要的是可执行组件、admin 作用域要的是可 import 的地址、
server 作用域要的是可调用钩子——三者本来就不同。注册表只回答"谁在哪个点上贡献了什么"，
"怎么用"交给各作用域的宿主，从而避免把三种语义挤进同一个形状。

扩展点名形如 `<pluginId>.<area>[.<position>]`，段内允许驼峰（标准插槽已有 `post.beforeContent` /
`post.afterContent` 这类历史命名）。Core 预置的九个标准渲染插槽在启动时即声明（提供方 `core`），
因此"贡献到标准插槽"永远不需要先声明，校验阶段也不会判"扩展点不存在"。

### 2. 声明与贡献分离，且都能声明式完成

提供方在 `manifest.json` 的 `extensionPoints[]` 声明（名字、作用域、是否可替换、会传给贡献者什么 `props`）；
消费方在 `contributions[]` 贡献。Core 在插件启动时把它们变成注册表记录，
**与插件自己在 `start()` 里调 `ctx.extensions` 等价，但插件零代码**（`packages/core/src/extensions/contributions.ts`），
并且能被 `pnpm validate` 静态校验。只有需要运行期动态判定的场景才改用 `ctx.extensions` 门面。

### 3. 替换语义：胜出者唯一，且提供方自己不受 `replaceable` 约束

生效裁决（`ExtensionRegistry.effective()`）：

- 存在 `replace` 贡献 → 默认内容与全部 `append` 贡献都不呈现，只返回**胜出者**
  （`order` 最大；同分取 `consumerId` 字典序在前的那个并记警告）；
- 否则返回全部贡献，按 `order` **降序**（同序保持注册顺序）。

`replaceable: false` 约束的是**第三方**：别的插件不能用 `replace` 接管这个扩展点。
**提供方自己的 `replace` 不受该开关限制**——因为提供方贡献的 `replace` 往往就是它最自然的出厂形态：
媒体库声明 `rice.media.picker`，默认实现就是自己的选择面板，它就是"默认内容"本身，
没有理由被自己声明的开关拦下。若这里不排除提供方，`replaceable: false` 就会被逼成
"任何插件都能替换我的面板"，语义反而失真。

判据是贡献校验里的三段条件 `mode === 'replace' && !declaration.replaceable && pluginId !== declaration.providerId`。
活样例：`plugins/official/media/manifest.json` 声明 `rice.media.picker` 为 `replaceable: false`，
媒体库自己用 `mode: "replace"` 贡献面板。

### 4. render 作用域：`SlotRegistry` 退化为门面，主题与既有插件零改动

`SlotRegistry`（`packages/core/src/render/slots.ts`）的方法签名与"单组件错误隔离"行为**保持不变**，
内部全部委托给注册表：`register` 等价于"向 render 作用域该点做一次 `append` 贡献"（`priority` 映射为 `order`）。
因此：

- 主题模板的 `slot('post.comments')` 与九个标准插槽的渲染路径不变；
- 只声明 `slots:register` 的第三方插件（如 `acme.reading-time` 的 `ctx.slots.register('post.beforeContent', …)`）无需改动；
- 同时白捡注册表的能力：`replace` 接管、按插件清理、零残留断言与统一裁决。

换言之，"插槽"与"扩展点"不再有两套注册表，只是同一套模型的两个入口。

### 5. 错误策略按作用域相反：server 响亮失败，render 降级为空片段

**server 作用域默认 `abort`**（`apply()` 的 `onError` 缺省值）：贡献抛错直接上抛，让调用方（如"保存文章前"）失败。
因为它是**保存前的钩子**——静默放行未经验证的数据比报错更危险：数据一旦进库，
事后无法区分"没跑钩子"与"跑了但跳过"。需要容错时由调用方显式传 `skip`（记日志后沿用上一版 payload）。

**render 作用域降级为空片段**：某个组件 `render()` 抛错时降级为空片段并记日志，绝不让整页渲染失败。
因为它是**展示位**——页面少一块内容可以接受，报错却会毁掉整页。

两者相反不是不一致，而是"数据正确性"与"页面可用性"在各自语境下的正确取舍。admin 作用域同理，
每条贡献独立错误边界（见决策 7）：一条崩溃不影响默认内容、其它贡献与整页。

### 6. `apply` 刻意不做能力门控

`apply` 是提供方在自己的流程里"运行别人声明要参与的钩子"，真正的风险面在**贡献侧**（执行他人代码），
因此只在声明（`extensions:declare`）与贡献（`extensions:contribute`）两处做能力门控；
`apply` 不需要额外能力，避免把"使用钩子"也变成需要申请的权限。

### 7. admin 作用域：服务端过滤下发 + SDK 渲染

安全边界在服务端（`apps/server/src/http/admin/extensions-routes.ts`）。对**贡献**有三重不可绕过的过滤：

1. 只下发**已启动**插件贡献的内容（停用 / 启动失败 = 贡献消失，前端不判断）；
2. 只下发 `scope === 'admin'` 的贡献（render / server 与后台界面无关）；
3. 按当前用户权限过滤（`permission`；超级管理员 `*` 全放行）。

**扩展点声明（`points`）刻意不按权限过滤**（仅下发提供方已启动的声明）：声明是静态能力信息，
与"你能否往这里贡献"是两回事；保留声明后，"贡献为什么没生效"才能一眼分辨是"扩展点不存在"
还是"提供方在、但贡献被启用态/权限挡下"。

裁决（`replace` 胜出者）在**内核注册表**里完成，下发的就是最终生效集合——少一处双份实现，
少一处两边裁决不一致的机会。命令式贡献（`ctx.extensions.contribute`）没有 `entry` 入口、
无法被浏览器 import，因此 admin 作用域**只支持声明式贡献**：遇到无 meta 的命令式贡献会跳过后台下发并留 debug 日志，
避免"贡献了却永远不显示"的静默黑洞。

SDK 侧（`packages/admin-sdk/src/extension/`）：

- `useAdminExtensions()`：整个会话只拉一次 `/api/admin/extensions`；**失败绝不抛错**，退化为"无贡献"
  并只告警一次（否则每个插槽每次渲染都刷同一条警告，噪声淹没真正的问题）；
- `<PluginSlot>`：默认插槽即默认内容；无贡献 → 只渲染默认；append → 默认 + 贡献（order 降序）；
  replace → 只渲染胜出者，默认内容不渲染；
- 每条贡献独立错误边界（`onErrorCaptured` 返回 `false` 并渲染为空）：单条崩溃不影响默认内容、其它贡献与整页；
- 样式**按引用计数**注入/卸载（同一插件样式可能被多个插槽引用，谁先卸载都不能误删别人的 `<link>`）；
- 模块加载失败追加 `?retry=1` **重试一次**（浏览器会缓存失败的模块表，用原 URL 重试不会真正重发请求）；
  仍失败则渲染空，可观测性交给 `console.warn`。

**贡献组件必须在 `defineAdminContribution({ props: [...] })` 里显式声明 context**：宿主用
`h(component, context)` 传值，而 Vue 只把**组件自己声明过**的字段填进 `setup(props)`——未声明者会落进
`ctx.attrs`，`setup(props)` 静默拿到 `undefined`（表现为"点了没反应且无报错"）。不便声明时
可从第二参数读 `ctx.attrs.value`，两种形态指向同一份 context。

### 8. 能力门面 fail-closed

`extensions:declare`（声明扩展点）与 `extensions:contribute`（贡献）是两个新能力，
未声明即抛 `RN_FORBIDDEN`；`slots:register` 作为 **render 作用域贡献的别名能力**保留，
只声明 `slots:register` 的既有插件无需改动。

### 9. 失败隔离、零残留与静态校验

- **声明式注册单条失败只跳过该条并记错误**，不让整个插件启动失败（`contributions.ts`）：
  清单里的拼写 / 产物缺失应在部署前被 `pnpm validate` 拦下，运行期为一条写错的贡献让整个插件不可用代价过大；
- **未声明的扩展点只告警不拒绝**（`contribute`）：插件启停顺序不确定，消费方完全可能先于提供方启动；
  真正的拼写错误由 `pnpm validate` 静态拦下；
- **零残留**：声明与贡献的 `Dispose` 句柄随插件 bundle 一起回收，"插件停止 = 声明与贡献一起消失"；
  `PluginManager.assertNoLeaks()` 把 `extensionDeclarations` / `adminContributions` / `serverContributions`
  一并断言；
- `pnpm validate` 的静态项（`apps/server/src/cli/validate.ts`）：声明了 `extensionPoints` 必须有
  `extensions:declare`；扩展点全局唯一（标准插槽视为 `core` 已存在）；声明了 `contributions` 必须有
  `extensions:contribute`；贡献入口的作用域白名单（admin → `./admin/`，render/server → `./dist/`）与文件存在；
  `style` / `permission` 仅 admin；贡献的 `point` 必须已声明；同一扩展点上多个 `replace` 且 `order` 相同
  （无法裁决）判错；主题的 `contentFields` 不得占用内置内容字段名。

### 10. 内容自定义字段：一套声明，文章与页面共用

主题在 `theme.json` 的 `contentFields` 声明一组字段（复用设置字段定义与多语言结构），文章与页面共用同一份：

- **声明**由主题给出，经 `core.theme@1` 服务新增的 `contentFields()` 交给内容插件
  （契约在 `packages/shared/src/types/services.ts`，实现在 `packages/core/src/bootstrap.ts`）；
- **值级校验与读取过滤**在 `@ricenote/shared`（`content-fields.ts`），因为真正用它的是内容插件，
  而插件不依赖宿主 Core；**本地化 DTO** 由 Core 解析（`packages/core/src/extensions/content-fields.ts`），
  后台经 `GET /api/admin/content-fields` 取得；
- **存储**为 `rn_posts.fields` / `rn_pages.fields` JSON 列（新增可空列，历史行保持 NULL = 未填写）；
- **写入 fail-closed**：只接受声明的键，未声明的键**拒绝保存**（而非静默丢弃——静默丢弃会让作者
  以为"填了却没生效"）；空字符串 / 空数组视为"未填写"（不落库），模板 `{% if %}` 自然为假；
- **读取按声明过滤**：换主题后旧键仍留在 JSON 里，但不再暴露给后台与模板，切回原主题即恢复展示。

为什么不给每个字段各建一列：字段集合由主题动态声明、不同主题互不相同，逐字段建列要随主题迁移，
且无法表达"未声明即不存在"的语义。

## 后果

- 插件从"只能提供页面"变成"能声明挂载点供别的插件接入"，且三个作用域共用一套模型与裁决；
- 主题与既有插件（含 `acme.reading-time`）**零改动**：`slot()` 与 `ctx.slots.register` 继续可用，
  只是背后换成了同一套注册表；
- 内容字段让"属于版式的字段"有了声明式位置：换主题不迁移表结构、旧值不丢但不展示；
- 代价：
  - 三个作用域的 payload 形状不同，贡献者必须按作用域写对产物（render 导出 `{ name, render }`、
    server 导出 `{ apply }`、admin 导出组件）；校验只能检查入口存在，产物形状依赖文档与运行期；
  - 由 SDK 宿主承担了错误边界、样式引用计数与重试这类"细节正确性"，改动 SDK 需重新构建
    （`pnpm --filter @ricenote/admin-sdk build`）。

## 被否决的方案

| 方案 | 否决原因 |
| --- | --- |
| 按作用域拆成三套注册表 | 三份"声明/贡献/清理/零残留/校验"实现必然漂移；且 `slots` 与 render 扩展点会变成两套事实来源 |
| 前端自行裁决 replace | 服务端已经过滤出安全子集，前端再裁决会出现两处口径（注册顺序、同分规则），不一致时表现为"有时生效有时不生效" |
| 让插件直接 import 别的插件改其界面 | 破坏"插件之间只走契约"，版本与启停耦合不可控 |
| `replaceable: false` 连提供方自己也约束 | 会把开关语义变成"任何插件都能替换我的面板"，与设计意图相反（见决策 3） |
| 内容字段逐字段建列 | 字段集合随主题变化，需随主题迁移表结构，且无法表达"未声明即不存在" |
| 未声明的贡献直接拒绝（而非仅告警） | 插件启停顺序不确定，消费方可能先于提供方启动；静态错误应由 `pnpm validate` 拦下 |
