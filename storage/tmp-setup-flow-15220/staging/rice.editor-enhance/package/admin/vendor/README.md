# vendor 目录说明

这里放的是 **Toast UI Editor** 的预构建产物，只属于本插件：宿主不新增依赖，插件侧也没有构建步骤
（后台界面是零构建 ESM，见 ADR-014）。两个文件在运行期由宿主以同源静态资源托管
（`/plugin-admin/rice.editor-enhance/vendor/**`，见 `apps/server/src/http/plugin-admin-assets.ts`）。

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `toastui-editor-all.min.js` | ≈569 KB | 自包含 IIFE，顶层 `var toastui = …`（即 `window.toastui`），`toastui.Editor` 即编辑器类；**中文语言包已打进同一产物**，故初始化时传 `language: 'zh-CN'` 即可 |
| `toastui-editor.min.css` | ≈164 KB | 编辑器与预览区样式；图标全部是 `data:` 内联资源，无需再托管任何图片或字体 |

- 上游：`@toast-ui/editor@3.2.2`，作者 NHN Cloud FE Development Lab，许可证 **MIT**（banner 保留在两个产物内）。
- 这两个文件是**构建产物**，请勿手工编辑；升级时按下面的步骤重新生成。

## 为什么不是直接下载现成文件

npm 包 `@toast-ui/editor@3.2.2` 里只有两种形态：

1. `dist/toastui-editor.js`：UMD，但把 `prosemirror-*` 当作**外部依赖** —— 浏览器里需要 8 个 prosemirror 全局才能跑，
   而 prosemirror 各包只提供 ESM/CJS，没有 UMD，直接引会在运行期报缺依赖；
2. `dist/esm/**`：标准 ESM，依赖走裸模块名。

官方 CDN 上那份 `toastui-editor-all.min.js`（依赖全内联）在本机网络下取不到
（`cdn.jsdelivr.net` / `unpkg.com` / `registry.npmjs.org` 均 SSL 不通，只有 `registry.npmmirror.com` 可达），
因此改为**从可达镜像装源码、用 esbuild 自己打成自包含 IIFE**。产物仍然是上游代码，只是打包方式不同。

## 复现步骤（升级版本时照做）

```powershell
cd c:/dev/ricenote
# 1) 装上游源码与打包器（临时目录，任意可删）
npm install @toast-ui/editor@3.2.2 --registry=https://registry.npmmirror.com --prefix .vendor-build --no-audit --no-fund
npm install esbuild@0.21.5          --registry=https://registry.npmmirror.com --prefix .vendor-build --no-audit --no-fund
# 2) 打包入口 .vendor-build/entry.js：
#    import * as TUI from '@toast-ui/editor';
#    import '@toast-ui/editor/dist/i18n/zh-cn';   // 注意：走 exports 映射，不带 esm/ 与 .js
#    export const Editor = TUI.Editor ?? TUI.default;
# 3) 用 esbuild 的 JS API 打包（format=iife、globalName=toastui、minify、
#    legalComments=inline、define: process.env.NODE_ENV="production" 与 global=window）
#    node .vendor-build/build.mjs
# 4) 样式（只做压缩，不做打包：其 url() 全是 data: 内联资源）
#    esbuild .vendor-build/node_modules/@toast-ui/editor/dist/toastui-editor.css --minify --outfile=…/toastui-editor.min.css
```

打完后确认三件事：产物里含 `@license MIT`（banner 未被压掉）、含 `setLanguage`（语言包进包）、
顶层是 `var toastui=`（浏览器里即 `window.toastui`）。

## 缺失时会怎样

`admin/editor.js` 的 `loadToastUi()` 注入这两个文件；**任一缺失或注入失败时只告警一次并降级为
「文本域 + 右栏服务端预览」**，编辑功能不缺失。所以即使有人把 vendor 目录清空，后台也不会白屏。
