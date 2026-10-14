# @ricenote/theme-sdk —— 主题 SDK

主题作者与 Core 渲染器共享的稳定契约：模板上下文类型、helper / 过滤器契约、`theme.json` 校验器，
以及**短代码引擎**（浏览器端）。

- 面向主题作者的完整说明：`docs/theme-api/v1.md`（短代码见第 15 节）
- 模板变量与 helper 全表：`docs/theme-api/v1.md` 第 3、4、13 节
- 能力边界（主题不执行服务端代码）：`docs/theme-api/v1.md` 第 13 节末尾

## 两种使用形态

| 形态 | 入口 | 使用方 |
| --- | --- | --- |
| 浏览器脚本（零构建，IIFE） | `/theme-sdk/v1/ricenote-shortcodes.js`（由 Core 托管） | 主题的 `assets/js/*.js`，经模板 helper `{{ shortcode_runtime() }}` 引入 |
| 源码导出（TS） | `@ricenote/theme-sdk` | 类型检查、过滤器实现、设置校验器（Core 使用） |
| 分词器（纯函数，可在 Node 下测） | `@ricenote/theme-sdk/shortcodes/tokenizer` | 单测与需要复用解析规则的服务端场景 |

> 短代码的**机制**在内核、**语义**在主题：内核不内置任何短代码，主题用
> `RiceNoteShortcodes.define({ name, render })` 声明自己支持的标记与展示结构。

## 构建产物

```bash
pnpm --filter @ricenote/theme-sdk build
```

产出：

| 产物 | 说明 |
| --- | --- |
| `dist/**` | `tsc` 输出的契约与纯函数（Node 侧与测试消费） |
| `dist/browser/ricenote-shortcodes.js` | 短代码引擎，IIFE 全局名 `RiceNoteShortcodes`；由 Core 托管、主题引入 |

浏览器产物由 `vite.config.ts` 构建（镜像 `@ricenote/admin-sdk` 的做法）。
改完记得重新构建并重启服务，否则页面仍会加载旧引擎。
