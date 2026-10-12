# 挂载点清单

**主题提供容器，插件提供内容。** 主题在合适的位置调用 `slot('名字')` 留出挂载点，
插件向该名字注册组件 —— 双方互不相识。

9 个标准插槽由 Core 在扩展点注册表构造时**预声明**（`providerId` 为 Core），
主题直接用即可，不需要自己声明。

---

## 1. 九个标准插槽

| 插槽名 | 约定位置 | 典型内容 |
| --- | --- | --- |
| `head.end` | `</head>` 之前 | SEO 元数据（Open Graph / JSON-LD）、额外样式 |
| `body.start` | `<body>` 开始处 | 公告条、跳转提示 |
| `body.end` | `</body>` 之前 | 统计脚本、悬浮组件 |
| `header.navigation` | 页眉导航区 | **顶部导航栏**（由 `rice.navigation` 输出） |
| `sidebar.widgets` | 侧栏 | 标签云、热门文章 |
| `post.beforeContent` | 正文之前 | 阅读时长、作者信息 |
| `post.afterContent` | 正文之后 | 分享按钮、版权声明 |
| `post.comments` | 文章底部评论区 | 评论列表与表单 |
| `footer.widgets` | 页脚 | 友链、站点统计 |

> 注意：**没有页脚导航插槽**。顶部导航整体由 `rice.navigation` 拥有
> （[ADR-013](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-013-navigation-ownership.md)），
> 且它只做一级导航。

---

## 2. 用法

```njk
{# 基础用法 #}
{{ slot('post.comments', { postId: post.id }) }}

{# 用能力判断要不要留容器 #}
{% if has_feature('comments') %}
  <section class="comments">{{ slot('post.comments', { postId: post.id }) }}</section>
{% endif %}
```

### 渲染语义

| 情况 | 结果 |
| --- | --- |
| 插槽名**从未被声明** | 返回空串（渲染为空） |
| 插槽已声明但**没有组件**（插件被禁用） | 返回空串 |
| 有组件 | 按优先级**降序**拼接（换行连接） |
| 某个组件抛错 | **该组件降级为空片段**并记日志，其它组件照常 |

因此**主题不需要为"插件不存在"写特殊逻辑** —— 空就空着。

> 但仍建议用 `has_feature()` 包一层容器：否则会留下一个有边距、有标题的空区块。
> 这也是官方主题的做法（`post.comments` 之外包了 `has_feature('comments')` 判断）。

### 关于 `data`

传给 `slot()` 的第二个参数会与该页面的数据合并：

```
组件拿到的 context.data = { ...页面 data, ...本次调用传入的 data }
```

所以同一个插槽在不同页面类型下可以拿到不同数据，同一个页面里也可以**用不同参数调用两次**。

组件里的 `context.kind` 是当前页面类型。

---

## 3. 内部机制（为什么支持异步）

Nunjucks 是**同步**的，而插件组件可以是异步的。流程是：

```
① 模板调用 slot('x', data)
     → 不立即渲染，压入待渲染队列，返回占位符 HTML 注释 <!--rn-slot:s1-->
② 模板渲染完成（HTML 里带着占位符）
③ 渲染器逐个 await 组件、生成真实 HTML，替换占位符
④ 返回最终 HTML
```

好处：模板逻辑保持同步简单；组件可以是任意异步逻辑；每个占位符的上下文互相隔离。

细节见 [[渲染与缓存|Development/Architecture/Render-Pipeline]]。

---

## 4. 两套官方主题的实际挂载位置

| 插槽 | `themes/default` | `themes/minimal` |
| --- | --- | --- |
| `head.end` | `layout.njk` | `layout.njk` |
| `body.start` | `layout.njk` | `layout.njk` |
| `body.end` | `layout.njk` | `layout.njk` |
| `header.navigation` | `layout.njk`（页眉） | `layout.njk`（页眉） |
| `sidebar.widgets` | `layout.njk`（`page.kind != 'post'` 时） | `layout.njk`（侧栏） |
| `footer.widgets` | `layout.njk`（页脚） | `layout.njk`（页脚） |
| `post.beforeContent` | `post.njk` | `post.njk` |
| `post.afterContent` | `post.njk` | `post.njk` |
| `post.comments` | `post.njk`（`has_feature('comments')` 包裹） | `post.njk` |

**新主题应当把 9 个挂载点都留出来** —— 否则插件功能会在你的主题上消失
（例如没有 `post.comments` 就没有评论区，且不会有任何报错）。

---

## 5. 插槽 vs 命名扩展点

插槽是**命名扩展点在 `render` 作用域的视图**：

```
ctx.slots.register(name, component, { priority })    // 等价于
ctx.extensions.contribute(name, component, { scope: 'render', mode: 'append', order: priority })
```

因此：

- 插槽的排序、按插件清理、零残留断言与扩展点**共用同一套实现**（不存在第二套逻辑）；
- 主题侧只需要会 `slot()`，不需要了解扩展点模型；
- 但如果你要**替换**某个插槽（而不是追加），就要用 `mode: 'replace'` 走扩展点 API。

`replace` 存在的价值：让"默认实现"可以被整体替换。例如媒体选择器
（`rice.media.picker`，`replaceable: false`）—— 媒体库自己用 `replace` 提供默认面板，
其它插件可以复用这个扩展点。

---

## 6. 检查清单（写主题时）

| 检查项 | 期望 |
| --- | --- |
| 9 个标准插槽是否都留了位置 | 建议全部 ✅ |
| `post.comments` 是否用 `has_feature('comments')` 包容器 | 建议 ✅ |
| `header.navigation` 是否留了导航容器 | ✅（否则导航栏无处渲染） |
| 是否在 `head.end` 之前保留 `</head>` 结构完整 | ✅（SEO 靠这个插槽注入） |
| 模板里是否硬编码了插件特有的 DOM 结构 | 不应（那是插件的事） |

---

## 相关页面

- [[模板变量与过滤器|Development/Theme-API/Template-Reference]]
- [[命名扩展点注册表|Development/Architecture/Extension-Registry]]
- [[扩展点全量清单|Development/Hooks-Inventory]]
