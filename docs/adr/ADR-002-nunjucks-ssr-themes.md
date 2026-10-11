# ADR-002：主题仅使用 Nunjucks + CSS/JS，前台默认 SSR

- 状态：已接受
- 日期：2026-10-11

## 背景

目标用户之一是"主题作者"，其画像为会 HTML/CSS、但不掌握现代前端工程链路的写作者。
若要求主题作者掌握 npm、打包器与服务端框架，将把绝大多数潜在贡献者排除在外。

## 决策

- 前台默认**服务端渲染（SSR）**，由 Core 的 Renderer 使用 Nunjucks 渲染 HTML；
- 主题包**零构建**：仅包含 `theme.json` + `templates/*.njk` + `assets/*` + 可选 `screenshot.png`；
- 主题**不执行任何服务端 JavaScript**，不能访问数据库、不能注册路由；
- 主题可选携带浏览器端 JavaScript，但仅作为 `assets/` 下的静态文件由浏览器执行。

## 理由

- Nunjucks 语法接近 HTML，学习曲线平缓，且支持模板继承、宏与自定义过滤器；
- 零构建主题可以直接用 ZIP 分发与安装，符合"管理员上传 ZIP 即完成安装"的验收标准；
- SSR 对 SEO 与首屏性能友好，符合博客的内容型定位；
- 禁止主题执行服务端 JS，从根本上消除一类安全风险（不可信模板代码执行）。

## 后果

**正面**

- 主题作者门槛极低，生态更容易成长；
- 服务端 HTML 缓存可直接作用于渲染结果，性能可控；
- 渲染安全面收敛到 Renderer 单点，便于集中加固。

**负面 / 约束**

- Nunjucks **不是安全沙箱**：仍只允许管理员安装受信任主题；
- 主题的能力被限制在"展示"，任何数据获取必须由插件提供，需要 Slot / ViewModel 契约配合；
- 复杂交互（如即时搜索）需要通过插件提供 API + 主题自带 JS 组合实现。

## 相关实现

- `packages/core/src/render/renderer.ts`：Nunjucks 环境与模板回退
- `packages/theme-sdk/src/filters.ts`：`css_color` / `date` / `excerpt` 等过滤器
- `themes/minimal/`：零构建默认主题示例
