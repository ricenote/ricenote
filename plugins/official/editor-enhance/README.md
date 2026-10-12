# rice.editor-enhance —— 编辑增强

用**声明式贡献**接管文章与页面的编辑体验：列表页的「新建」入口、编辑器工具栏
（前台预览 + 插入图片）、以及带实时预览的 Markdown 正文编辑器。

本插件**没有自己的后台页面**，也不声明扩展点 —— 它只是向 posts / pages 提供的
扩展点贡献界面块。**停用后一切回退为默认**：新建按钮回到提供方的默认样式、
工具栏为空、正文回到普通多行文本域，无需任何手工清理。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.editor-enhance` |
| version | `1.0.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js`（空实现，仅构建入口） |
| capabilities | `extensions:contribute` |
| requires | 无 |
| 服务端逻辑 | 无（不注册路由 / 服务 / 事件 / 表） |
| 依赖 | 无新增依赖（Toast UI 为静态 vendor 文件，不进 `package.json`） |

## 六条贡献

| 扩展点 | 作用域 | mode | order | entry | style |
| --- | --- | --- | --- | --- | --- |
| `rice.posts.listActions` | admin | replace | 10 | `./admin/list-action.js` | — |
| `rice.pages.listActions` | admin | replace | 10 | `./admin/list-action.js` | — |
| `rice.posts.editorToolbar` | admin | append | 10 | `./admin/toolbar.js` | — |
| `rice.pages.editorToolbar` | admin | append | 10 | `./admin/toolbar.js` | — |
| `rice.posts.editorBody` | admin | replace | 10 | `./admin/editor.js` | `./admin/editor.css` |
| `rice.pages.editorBody` | admin | replace | 10 | `./admin/editor.js` | `./admin/editor.css` |

`listActions` 与 `editorBody` 用 `replace`（整体替换默认内容），`editorToolbar` 用
`append`（默认工具栏为空，只做追加）。

### 消费者传入的 context（由 posts / pages 提供）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `'post' \| 'page'` | 内容类型；列表动作据此选择新建页，编辑器据此区分草稿 |
| `value` | `string` | 当前正文 |
| `onChange` | `(next: string) => void` | 更新正文；编辑器**只在用户输入时**调用 |
| `onPreview` | `() => Promise<string>` | 调服务端渲染管线，返回**已消毒**的 HTML |

> 贡献模块必须显式声明 `props: ['kind', 'value', 'onChange', 'onPreview']`。
> 否则 Vue 会把这些字段放进 `attrs`，`setup(props)` 里全是 `undefined`
> （表现为"点了没反应"且无任何报错）。

## 三个贡献如何协作

- `admin/bridge.js`：模块级共享的「当前编辑器」桥（`setActiveEditor` /
  `insertAtCursor` / `getActiveEditor` / `clearActiveEditor`）。三个贡献同属一个
  插件目录、由同一个托管 URL 加载，ESM 模块实例天然共享，因此不需要改宿主契约，
  也不需要往 `window` 上挂东西。
- `admin/editor.js` 挂载时注册桥、卸载时按句柄比对清空；
- `admin/toolbar.js` 通过桥把 `![文件名](url)` 插到**光标处**；桥为空（正文贡献被
  停用 / 编辑器未挂载）时降级为"追加到正文末尾"，并明确提示用户。

## 编辑器实现与降级

`admin/editor.js` 按能力自动选择实现：

1. **Toast UI Editor**：若 `admin/vendor/` 下存在预构建文件，则注入一次
   `<link>` + `<script>`（模块级 Promise 缓存，同一 URL 只注入一次），
   取 `window.toastui.Editor` 后创建实例
   （`initialEditType: 'markdown'`、`previewStyle: 'vertical'`、
   `hideModeSwitch: true`、`height: '100%'`，工具栏按需裁剪）；
2. **textarea + 右栏实时预览**：vendor 文件缺失或注入失败时自动降级。
   预览仍调用 `props.onPreview()` 走服务端渲染管线，内容与前台一致；
   窄屏（≤900px）时两次预览折为标签页切换。

> **本次交付状态**：构建环境网络受限（jsDelivr 的 TLS 握手失败），
> `admin/vendor/toastui-editor-all.min.js` 与 `toastui-editor.min.css` **未能取回**，
> 因此当前实际运行在**第 2 条降级路径**（textarea + 实时预览）。
> 加载器已就位：把这两个文件放入 `admin/vendor/` 后**无需改代码**即自动升级为 Toast UI。

### Toast UI 来源 / 版本 / 许可证

- 包名：`@toast-ui/editor`
- 版本：**3.2.2**（固定版本，不随主程序浮动）
- 来源：jsDelivr 分发的官方 `dist/` 产物
  （`toastui-editor-all.min.js`、`toastui-editor.min.css`）
- 许可证：**MIT**（保留文件内的 license banner，不修改、不二次打包）
- 不以 npm 依赖引入：vendor 的是静态文件，`package.json` 的 `dependencies` 保持为空，
  因此**不新增宿主或插件的构建期依赖**。

## 行为细节

- **防抖 800ms 自动草稿**：写入 `localStorage`，键为
  `editor-enhance:draft:post` / `editor-enhance:draft:page`（含 `kind`，互不覆盖），
  底栏显示"草稿已自动保存 hh:mm"；
- **恢复条件（局限）**：仅在**挂载时 `props.value` 为空**（含纯空白）才恢复草稿 ——
  编辑既有内容时一律以宿主为准，避免把上次未保存的草稿贴进正式内容；
  草稿只保留一份、读取后不自动清除，定位是"崩溃兜底"而非版本历史；
- **底栏统计**：字数（不含空白）与总行数。光标行列不做展示 ——
  textarea 路径下没有可靠的跨浏览器行列来源，宁可不显示也不编造。

## 视觉约束

仅使用本插件自己的 `.ee-*` 类，涉及 Toast UI 的覆盖一律限定在 `.ee-editor` 作用域内，
**不改动宿主全局类名**；1px 细边框、无阴影、无毛玻璃、等宽编辑区、
两栏之间用 1px 分隔线表达层级。

## 启停

- 可独立启停，无数据迁移；
- 停用后六条贡献随之下线，文章与页面编辑体验**全部回退为提供方的默认实现**；
- `admin/vendor/` 缺失不影响启停，只是走 textarea 降级路径。
