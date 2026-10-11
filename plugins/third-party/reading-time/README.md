# acme.reading-time —— 阅读时长（第三方示例）

一个**非官方**插件，用来验证"第三方可以独立开发、发布、启用与升级"这一退出标准。

它只做一件事：向 `post.beforeContent` 插槽注入一行"阅读时长约 N 分钟 · 约 N 字"。

同时演示第三方插件同样能用声明式设置（`settingsSchema`）获得后台表单，
以及"不声明路由/服务/事件/菜单也能正常工作"的最小依赖路径。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `acme.reading-time` |
| name | 阅读时长 |
| version | `1.1.0` |
| apiVersion | `^1.0.0` |
| author | `Acme Studio`（第三方） |
| entry | `./dist/index.js` |
| provides | 无 |
| requires | 无 |
| capabilities | **`slots:register`**（只请求它需要的那一个能力） |
| migrations | 无 |
| 数据表 | 无 |
| settingsSchema | 「展示」分组：`wordsPerMinute` / `showWordCount` / `label` |

## 扩展点（Hook）

| 插槽 | 组件名 | 优先级 | 输出 |
| --- | --- | --- | --- |
| `post.beforeContent` | `acme.reading-time` | 0（默认） | `<p class="acme-reading-time" data-acme-reading-time>阅读时长 约 3 分钟 · 约 850 字</p>` |

它从插槽上下文读取文章正文（`context.data.post`），按字数与 `wordsPerMinute` 估算时长。
除此之外不注册任何路由、服务、事件或菜单。

## 设置项（`settingsSchema`，后台自动生成表单）

后台「扩展中心 → 阅读时长 → 设置」。保存后需**重启服务**生效。

### 分组「展示」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `wordsPerMinute` | number（50–2000） | `300` | 阅读速度（运行时再钳制一次） |
| `showWordCount` | boolean | `true` | 是否附带字数 |
| `label` | text（≤20 字） | `"阅读时长"` | 前缀文案 |

> 声明式设置对第三方插件与官方插件**完全等价**：只要在 `manifest.json` 里写
> `settingsSchema`，后台就会自动生成表单、自动校验、自动持久化（保存后提示重启）。
> 无需写任何后台界面代码，也不需要额外能力声明。

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
