# 命名扩展点注册表

扩展点让**插件之间**（以及主题与内容之间）能够互相扩展，而不是各自为政。
本页讲清它的统一模型、`append` / `replace` 的裁决规则，以及后台界面是怎么被下发到前端的。

相关源码：`packages/core/src/extensions/registry.ts`、`contributions.ts`、`packages/core/src/render/slots.ts`、
`apps/server/src/http/admin/extensions-routes.ts`。
权威设计文档：[ADR-017 命名扩展点](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-017-named-extension-points.md)、
[hooks-inventory](https://github.com/ricenote/ricenote/blob/main/docs/architecture/hooks-inventory.md)。

---

## 1. 三作用域统一模型

一个注册表覆盖三个作用域：

| 作用域 | 名字形态 | 典型用途 |
| --- | --- | --- |
| `render` | `post.comments`、`head.end` | 站点渲染时插入 HTML 片段 |
| `admin` | `rice.posts.editorBody`、`rice.media.picker` | 后台界面插入 Vue 组件 |
| `server` | 自定义 | 服务端钩子（filter 语义） |

**统一带来的好处**：声明、贡献、权限过滤、可替换性、按插件清理 —— 五套规则只实现一次，
因此"插槽"与"后台扩展点"不会出现行为漂移。

---

## 2. 两种声明方式

### 声明式（零代码）

在 `manifest.json` 里写：

```json
{
  "extensionPoints": [
    { "name": "rice.posts.editorBody", "scope": "admin", "replaceable": true,
      "description": "文章编辑页正文区", "props": ["postId"] }
  ],
  "contributions": [
    { "point": "rice.posts.editorBody", "mode": "replace", "order": 10,
      "entry": "admin/editor-body.js", "label": "Markdown 编辑器" }
  ]
}
```

适合绝大多数场景 —— 插件作者不需要写任何注册代码。

### 运行时门面（需要动态逻辑时）

```ts
ctx.extensions.declare({ name, scope, replaceable, description, props })
ctx.extensions.contribute(point, payload, { scope, mode, order })
ctx.extensions.apply(point, payload, options)   // server 作用域
ctx.extensions.list()
```

都返回 `Dispose`，插件停止时自动清理。

---

## 3. 声明与贡献的规则

### `declare`

| 情况 | 结果 |
| --- | --- |
| 名称不符合命名规则 | `VALIDATION_FAILED` |
| **他人已声明**同名扩展点 | `VALIDATION_FAILED`（409）—— 扩展点全局唯一 |
| 重复声明 Core 预置插槽 | 仅**告警**（兼容旧 API） |

### `contribute`

默认值：`scope = 'render'`、`mode = 'append'`、`order = 0`。

| 情况 | 结果 |
| --- | --- |
| 向未声明的扩展点贡献 | 仅**告警**（宽松，便于渐进开发） |
| 非提供方向 `replaceable: false` 的点做 `replace` | **拒绝**（`VALIDATION_FAILED`） |

最后一条的**判据是三段条件**：

```
mode === 'replace' && !declaration.replaceable && pluginId !== declaration.providerId
```

关键在最后一项：**提供方自己的 `replace` 不受 `replaceable: false` 约束**。

> 这一点容易踩坑：`replaceable: false` 的本意是"**不允许第三方替换**"，
> 而提供方自己用 `replace` 提供默认实现是完全正常的（例如媒体库自己提供选择器面板）。
> 早期实现漏掉了第三段条件，导致提供方自己的默认面板都注册不上。

---

## 4. `append` 与 `replace` 的裁决

`effective(point, scope)` 的规则：

### 存在 `replace` 时

- 默认内容与所有 `append` 贡献**都不呈现**；
- 只返回**胜出者**：`order` 最大者；
- **同分**时取 `consumerId` 字典序在前者，并**记一条警告**（`pnpm validate` 会把"同 `order` 冲突"判为错误）。

### 不存在 `replace` 时

- 返回全部 `append` 贡献，按 `order` **降序**，同序按注册顺序。

一句话概括：**replace 是"整体接管"，append 是"叠加"**。

---

## 5. `SlotRegistry` 只是门面

`SlotRegistry`（`render/slots.ts`）现在**完全委托**给扩展点注册表：

| 旧 API | 实际行为 |
| --- | --- |
| `slots.register(pluginId, slot, component, priority)` | `extensions.contribute(slot, …, { scope:'render', mode:'append', order: priority })` |
| `slots.componentsFor(slot)` | `extensions.effective(slot, 'render')` |
| `slots.ownedBy(pluginId)` | `extensions.contributionsOwnedBy(pluginId, 'render')` |
| `slots.clear()` | `extensions.clear('render')` |

**因此没有第二套插槽实现** —— `replace` 接管、按插件清理、零残留断言三处行为天然一致。
既有的 `ctx.slots.register`、主题的 `slot()`、9 个标准插槽、第三方示例插件**都无需改动**。

9 个标准插槽在注册表构造时被**预声明**（`providerId` 为 Core）：

```
head.end  body.start  body.end
header.navigation  sidebar.widgets  footer.widgets
post.beforeContent  post.afterContent  post.comments
```

---

## 6. 后台扩展点如何下发到前端

`GET /api/admin/extensions` 返回当前登录者**能看到**的扩展点与贡献。过滤条件有四个：

1. **作用域**：只下发 `admin` 作用域的声明与贡献；
2. **启用态**：提供方与贡献方插件都必须 `isStarted`；
3. **有入口**：贡献必须有元数据（`meta`）—— 命令式贡献因没有前端入口而被跳过；
4. **权限**：贡献声明的 `permission` 必须被当前登录者满足。

返回结构：

| 对象 | 字段 |
| --- | --- |
| points | `{ name, provider, replaceable, description?, props? }` |
| contributions | `{ point, pluginId, mode, order, entryUrl, styleUrl?, label? }` |

前端 SDK 侧（`@ricenote/admin-sdk`）用这些数据：

- `useAdminExtensions()` 拉取并缓存；
- `<PluginSlot point="…">默认内容</PluginSlot>` 渲染：无贡献 → 默认内容；append → 默认 + 贡献按 order 降序；replace → 仅胜出者；
- `defineAdminContribution()` 定义贡献组件（**必须声明 `props`**，否则 `setup(props)` 会静默拿到 `undefined`）。

样式按**引用计数**注入与卸载；`import` 失败会追加 `?retry=1` 重试一次；**每条贡献有独立错误边界**（一个插件界面出错不影响其它）。

详见 [[插件自带后台界面|Plugin-API-Admin-UI]]。

---

## 7. 实际用例：编辑增强插件

`rice.editor-enhance` 是"纯贡献、零页面"的范例。它只声明一个能力（`extensions:contribute`），
通过 6 条贡献改变文章/页面编辑页：

| 扩展点 | 模式 | 效果 |
| --- | --- | --- |
| `rice.posts.listActions` / `rice.pages.listActions` | `replace` | 替换列表页操作区 |
| `rice.posts.editorToolbar` / `rice.pages.editorToolbar` | `append` | 工具栏追加按钮 |
| `rice.posts.editorBody` / `rice.pages.editorBody` | `replace` | 正文区换成 Markdown 编辑器 |

**它证明了扩展点模型的表达力**：不改动 posts/pages 插件一行代码，也不改 Core，就能大幅改变编辑体验。

---

## 8. 静态校验

`pnpm validate` 会检查：

- 贡献的能力声明是否齐备（`extensions:declare` / `extensions:contribute`）；
- 扩展点**名称全局唯一**；
- 贡献入口的作用域是否在白名单内、**入口文件是否存在**；
- `replace` 是否出现**同 `order` 冲突**（运行时是警告，静态校验判错）。

---

## 9. 自查入口

| 问题 | 怎么看 |
| --- | --- |
| 我的贡献没生效 | 该扩展点是否已被声明？贡献方插件是否启用？`pnpm validate` |
| 后台看不到我的贡献 | 是否 `admin` 作用域？插件是否已启动？贡献是否有 `meta`？当前用户是否有 `permission`？ |
| replace 被拒绝 | 检查是不是"第三方替换了 `replaceable: false` 的点" |
| 多个贡献顺序不对 | `order` 降序；同分会取字典序并在 validate 时报错 |

---

## 相关页面

- [[扩展点全量清单|Hooks-Inventory]]
- [[插件自带后台界面|Plugin-API-Admin-UI]]
- [[渲染与缓存|Architecture-Render-Pipeline]]
