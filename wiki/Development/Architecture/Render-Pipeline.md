# 渲染与缓存

本页讲清"一次前台请求如何变成 HTML"，以及两个容易踩坑的机制：**插槽的占位符替换**与 **HTML 缓存键**。

相关源码：`packages/core/src/render/`（`renderer.ts`、`context.ts`、`cache.ts`、`slots.ts`、`safe-html.ts`）、
`packages/core/src/themes/manager.ts`。

---

## 1. 渲染总览

```
请求 → 路由匹配到 page 路由（插件提供） 
     → 插件产出 ViewModel { kind, data, title, canonicalUrl }
     → buildTemplateContext() 组装上下文
     → resolveTemplate() 决定用哪个模板
     → Nunjucks 渲染（同步，产出含插槽占位符的 HTML）
     → replaceSlotPlaceholders() 异步替换插槽
     → 写缓存 → 返回 HTML
```

关键设计：**Nunjucks 是同步的，而插件组件可能是异步的**。解决办法是把插槽渲染推迟到模板渲染之后 —— 见第 3 节。

---

## 2. 模板查找

`resolveTemplate()` 的查找顺序（**5 步**）：

1. 内容指定的 **`pageTemplates` 键** → 经 `ThemeManager.resolvePageTemplate()` 映射到模板文件；
2. 内容指定的**模板文件名**（需通过 `isSafeTemplateName()` 且文件存在）；
3. `theme.json` 的 `templates[kind]`；
4. 主题自己的 `fallback.njk`；
5. 返回 `'fallback.njk'`，由加载器解析（先主题目录，再 Core 内置模板目录）。

> 文档里常说的"三级回退"是简化说法：实际实现里第 1、2 步是两种**显式模板**来源。
> 但语义一致：**越具体越优先，最后一定落到可渲染的兜底模板**。

### 模板名的安全性

`isSafeTemplateName()` 的实现只有一行判据：

```
必须匹配 ^[^/\\]+\.njk$  且  不包含 '..'
```

即"不含路径分隔符的 `.njk` 文件名"。该检查只用在"显式文件名"这一分支上，
杜绝借模板名读取任意文件（目录穿越）。

### 版式键失效时的行为

内容（文章/页面）只保存**版式键**（如 `narrow`）。取值时经 `resolveContentTemplateKey(raw, available)` 校验：

| 输入 | 结果 |
| --- | --- |
| 空值 | 返回 `null`（使用 kind 默认模板） |
| 超过 120 字符 | 抛 `RN_CONTENT_TEMPLATE_INVALID` |
| 主题未声明任何可选版式 | 抛 `RN_CONTENT_TEMPLATE_INVALID` |
| 键不在清单中 | 抛 `RN_CONTENT_TEMPLATE_INVALID` |

渲染期则**宽松**：若键在当前主题里不存在或文件缺失，`resolvePageTemplate()` 返回 `undefined`，
流程回退到 kind 模板，**不会报错**。这个"写入严、读取宽"的组合让换主题不会让已有内容失效。

---

## 3. 插槽：占位符 + 渲染后替换

### 为什么需要这个机制

模板引擎是同步的，而插槽组件（插件提供的 Vue/HTML 片段生成逻辑）可能是异步的。
如果在模板里同步调用异步逻辑，就只能阻塞或放弃。

### 实现

1. 模板调用 `slot('post.comments', data)`；
2. helper **不立即渲染**，而是把这次调用压入 `pendingSlots`，并返回一个**占位符** `SafeString`；
3. 占位符格式：`<!--rn-slot:s1-->`（`s1`、`s2`… 递增）；
4. 模板渲染完成后，`replaceSlotPlaceholders()` **逐个 await** 渲染真实内容并替换占位符；
5. 最终 HTML 返回给请求。

好处：模板逻辑保持同步、简单；插槽可以是任意异步逻辑；**每个占位符独立**，上下文互不干扰。

### 每次调用的数据

每个占位符的渲染上下文是：

```
{ kind, data: { ...页面data, ...该次调用传入的data }, request? }
```

也就是"页面数据打底 + 本次调用数据覆盖"。因此同一个插槽在不同位置可以用不同参数调用两次。

### 错误隔离

- **单个组件抛错** → 记 `error` 日志并**降级为空片段**，其它组件照常渲染；
- **多组件拼接** → 按优先级降序、以换行连接。

### 未注册插槽

- 插槽名**从未被声明**：`slot()` 直接返回空 `SafeString`；
- 插槽已注册但**没有组件**（插件被禁用）：返回空字符串。

两种情况下模板都不需要判断 —— 但主题通常会再用 `has_feature('comments')` 包一层容器，
避免留下空的边距与标题。

> 排序与优先级：插槽是**扩展点注册表在 `render` 作用域的视图**。
> 组件按 `order`（注册时的 priority）**降序**排列，同序按注册顺序。

---

## 4. HTML 缓存

### 缓存键

```
themeId | r<主题设置revision> | s<站点信息revision> | p<已启用能力集合> | path
```

其中 `path` 由渲染器传入，构成为：

```
<canonicalUrl> | <规范化查询串> | <模板名>
```

**四个关键设计点**：

1. **查询串参与缓存键，且做了规范化**（参数按键名排序）——
   修复了历史上"`?commentPage=2` 命中第 1 页缓存"的缺陷；
2. **站点信息 revision 参与键** —— 站点信息可在线修改，改完自动让旧缓存失效；
3. **主题设置 revision 与 themeId 参与键** —— 换主题或改设置不会读到旧页面；
4. **已启用能力集合参与键** —— 启用/停用插件后缓存自然分区。

### 失效方式

| 方式 | 用途 |
| --- | --- |
| 按标签失效（`invalidateTags`） | 内容变更（如某篇文章）时精确失效相关页面 |
| 整体清空（`clearCache()`） | 变更影响**全局插槽**时（如导航栏出现在每个页面） |

**为什么需要整体清空**：导航栏通过 `header.navigation` 出现在每个页面上，
而"按标签失效"只能覆盖注册了对应标签的页面 —— 当某条导航项变化时，
其它已缓存页面上的导航也会过期，却不在标签覆盖范围内。因此这类变更直接清空。
内核把它作为 `core.theme@1.clearCache()` 暴露给插件。

### 容量与统计

- 有 **TTL**（`RENDER_CACHE_TTL_SECONDS`，默认 120 秒）；
- 有**条目上限**（默认 500），超限时按**最早过期**淘汰约 10%；
- 统计经 `cache.stats()` 暴露到 `/api/health`。

可通过 `RENDER_CACHE_ENABLED=false` 整体关闭缓存（排查"是不是缓存问题"时最快的验证手段）。

---

## 5. 输出安全

| 机制 | 说明 |
| --- | --- |
| Nunjucks `autoescape: true` | 默认**所有输出都转义** |
| `TrustedHtml` | 只有被显式标记的受信 HTML 会转成 `SafeString`（不转义） |
| `sanitizeRichText()` | 富文本统一消毒后再标记为受信 |
| `slot()` 返回值 | 是 `SafeString`（空串或占位符），因此插槽内容不会被二次转义 |
| 颜色类设置 | 输出必须经 `css_color` 过滤器白名单校验 |

**插件作者要注意**：把用户输入直接标记为 `TrustedHtml` 等于放弃转义保护。
标准做法是"先 `sanitizeRichText()` 消毒，再 `markTrusted()`"。

---

## 6. 主题静态资源

- 模板中用 `theme_asset('css/style.css')` 生成地址，输出形如
  `/theme-assets/<themeId>/<path>?v=<主题version>`；
- 该路径由服务端托管（限定在主题 `assets/` 目录内，防目录穿越），
  响应头为 `immutable` 长缓存（一年）；
- **指纹就是主题版本号**：改了资源必须提升 `theme.json` 的 `version`，否则访客会一直用旧文件。

---

## 7. 自查入口

| 现象 | 先看什么 |
| --- | --- |
| 页面内容不是最新 | `RENDER_CACHE_ENABLED=false` 复现 → 确认是缓存问题 |
| 插槽内容没出现 | 插件是否启用？插槽名是否与主题里写的一致？组件是否抛错（看日志） |
| 换主题后版式不对 | 版式键在新主题是否存在（应回退不报错） |
| 资源改了没变 | 主题 `version` 是否提升 |
| 模板报错定位 | 日志中的模板路径与行号 |

---

## 相关页面

- [[模板变量与过滤器|Development/Theme-API/Template-Reference]]
- [[挂载点清单|Development/Theme-API/Slots]]
- [[命名扩展点注册表|Development/Architecture/Extension-Registry]]
- [[主题与外观|Themes]]
