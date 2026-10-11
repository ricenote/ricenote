# acme.reading-time —— 阅读时长（第三方示例）

一个**非官方**插件，用来验证"第三方可以独立开发、发布、启用与升级"这一退出标准。

它只做一件事：向 `post.beforeContent` 插槽注入一行"阅读时长约 N 分钟 · 约 N 字"。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `acme.reading-time` |
| name | 阅读时长 |
| version | `1.0.0` |
| apiVersion | `^1.0.0` |
| author | `Acme Studio`（第三方） |
| entry | `./dist/index.js` |
| provides | 无 |
| requires | 无 |
| capabilities | **`slots:register`**（只请求它需要的那一个能力） |
| migrations | 无 |
| 数据表 | 无 |

## 扩展点（Hook）

| 插槽 | 组件名 | 优先级 | 输出 |
| --- | --- | --- | --- |
| `post.beforeContent` | `acme.reading-time` | 0（默认） | `<p class="acme-reading-time" data-acme-reading-time>阅读时长 约 3 分钟 · 约 850 字</p>` |

它从插槽上下文读取文章正文（`context.data.post`），按字数与 `wordsPerMinute` 估算时长。
除此之外不注册任何路由、服务、事件或菜单。

## 设置项（旧写法 `settings`）

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `wordsPerMinute` | `300` | 阅读速度（运行时钳制到 50–2000） |
| `showWordCount` | `true` | 是否附带字数 |
| `label` | `"阅读时长"` | 前缀文案（截断到 20 字） |

> 本插件使用**扁平键值的 `settings` 旧写法**（向后兼容路径）。
> 它演示了两件事：
> 1. 旧写法的插件无需改动即可继续工作，`ctx.config.get(key, fallback)` 语义与 v1 完全一致；
> 2. 未声明 `settingsSchema` 时，后台设置面板会退化为只读的键值预览，
>    并提示"如需在此编辑，请声明 settingsSchema"。
>
> 对比 `plugins/official/pages/manifest.json` 可以看到新写法（分组 + 字段 + 多语言 label）
> 如何直接生成可编辑表单。

## 安装与启用

三种方式任选：

1. **目录即插件**（开发期）：把本目录放在 `plugins/third-party/` 下，
   `pnpm build` 后由 Core 发现；
2. **ZIP 上传安装**（管理期）：把 `manifest.json`、`dist/` 与 `README.md` 打包为 ZIP，
   在后台「扩展中心 → 上传安装插件包」上传 —— 包体会先做完整安全校验；
3. 启用后在「扩展中心」中打开开关，然后**重启服务**使路由/插槽生效。

## 依赖说明

- 只依赖 `@ricenote/plugin-sdk` 的类型与 `definePlugin`，**不依赖** `@ricenote/core`；
- SDK 由宿主提供（不要打进包里），详见 `docs/plugin-api/v1.md` 第 11 节。
