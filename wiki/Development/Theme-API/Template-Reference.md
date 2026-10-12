# 模板变量与过滤器

主题模板是 Nunjucks。本页列出**渲染时实际能拿到的全部变量**与**全部 helper / 过滤器**。

> ⚠️ 一个常见的误解：`url()`、`slot()`、`has_feature()`、`theme_asset()` 的**实现不在 `@ricenote/theme-sdk` 里**，
> 而在 **Core 的渲染器**（`buildHelpers()`）中。`theme-sdk` 导出的是**类型契约**、**过滤器实现**与**设置校验器**。
> 模板里也没有名为 `absoluteUrl()` 的 helper —— 那是内部函数，模板用 `site_url()`。

---

## 1. 顶层上下文

渲染时传给模板的对象（`buildTemplateContext()` + 渲染器补充）：

| 变量 | 来源 | 说明 |
| --- | --- | --- |
| `site` | Core | 站点信息（见下） |
| `page` | Core | `{ ...data, kind, title, canonicalUrl }` —— 当前页的元信息 |
| `theme` | Core | `{ id, name, version, settings }` |
| `current_kind` | Core | 当前页面类型（调试用） |
| `viewer` | Core | 仅登录时存在：`{ user }` |
| `pagination` | Core / 插件 | 列表页存在：`{ page, pageSize, total, totalPages, ... }` |
| `request` | Core | 请求上下文（存在时注入） |
| **`...data`** | 插件 | 插件的 ViewModel `data` **会被铺开到顶层**（所以 `post`、`posts` 等直接在顶层可见） |

也就是：**`page.data` 里的键同时也是模板顶层变量**。

### `site`

```ts
{
  id, title, description, url, language,        // 必有
  logoUrl?, faviconUrl?, icpText?, icpUrl?      // 未设置时「键不存在」
}
```

> ⚠️ 可选字段在未设置时是 **`undefined`（键不存在）**，**不是空字符串**。
> 模板里请写 `{% if site.logoUrl %}`，不要写 `{% if site.logoUrl == '' %}`。

另外 `site` 是**动态**的：后台改了站点信息，前台下次渲染就是新值（无需重启）。

### `theme.settings`

主题设置的**生效值**（三层合成结果），键名即 `theme.json` 里 `settings` 的字段名。

```njk
<link rel="stylesheet" href="{{ theme_asset('css/style.css') }}">
<style>
  :root { --accent: {{ theme.settings.accentColor | css_color('#89A9C7') }}; }
</style>
```

---

## 2. 各页面类型下的可用变量

由插件的数据决定，随页面类型不同：

| kind | 额外变量 | 提供者 |
| --- | --- | --- |
| `home` | `siteDescription`、`posts`（`{ items, total, page, pageSize, totalPages }`）、`pagination` | `rice.posts` |
| `post` | `post`、`seoDescription` | `rice.posts` |
| `archive` | `term`、`posts`、`pagination`（taxonomy 缺失时附加 `unavailable: true`） | `rice.posts` |
| `page` | `content`（**注意变量名是 `content` 不是 `page`**）、`fields`、`seoDescription` | `rice.pages` |
| `search` | 关键词与结果（由 `rice.search` 提供） | `rice.search` |
| `404` | `message` | Core / 插件 |

### `post` 视图模型

```ts
{
  id, title, slug, html, excerpt,
  coverUrl?, authorName?, publishedAt?, updatedAt,
  terms, url
}
```

> `html` 可能是**受信句柄对象**（有 `value` 字段）而不是字符串 ——
> 在 Nunjucks 里直接输出即可（渲染器会转成安全值）；在**插件代码**里要兼容两种形态
> （参见 `reading-time` 的 `extractText()`）。

### `content`（页面）

```ts
{
  id, title, slug, html, url, fields,
  template?, publishedAt?, updatedAt?
}
```

---

## 3. Helper（全局函数）

| Helper | 签名 | 行为 |
| --- | --- | --- |
| `theme_asset` | `(relativePath) => string` | 输出 `/theme-assets/<themeId>/<path>?v=<主题version>`；去掉前导 `/` |
| `url` | `(routeName, params = {}) => string` | 按路由名生成地址；**未注册路由不抛错，返回 `#` 并告警一次**；缺参同样降级为 `#` |
| `has_feature` | `(capability) => boolean` | 能力是否启用，支持完整契约 / 全名 / 短名三种写法 |
| `site_url` | `(pathname = '/') => string` | 拼成绝对地址（基于 `site.url`） |
| `slot` | `(slotName, data = {}) => SafeString` | 渲染插槽；未注册 → 空串；已注册 → 返回占位符（渲染后替换） |

### 用法

```njk
{# 站内链接：靠路由名，插件换实现也不怕 #}
<a href="{{ url('post.show', { slug: post.slug }) }}">{{ post.title }}</a>

{# 绝对地址（canonical、sitemap 等） #}
<link rel="canonical" href="{{ site_url(page.canonicalUrl) }}">

{# 按能力判断入口是否渲染 #}
{% if has_feature('search') %}
  <a href="{{ url('search') }}">搜索</a>
{% endif %}

{# 挂载点 #}
{{ slot('post.comments', { postId: post.id }) }}
```

**`url()` 的降级语义很重要**：它让"禁用 search 插件"不会导致整页白屏 ——
模板引用了未注册路由只会得到 `#` 加一条告警。

---

## 4. 过滤器

| 过滤器 | 签名 | 行为 |
| --- | --- | --- |
| `css_color` | `(value, fallback = 'transparent') => string` | CSS 颜色白名单（hex / rgb(a) / hsl(a) / 具名色）；非法或超 64 字符 → `fallback`；具名色小写化 |
| `date` | `(value, pattern = 'YYYY-MM-DD') => string` | 支持 `YYYY` `MM` `DD` `HH` `mm` `ss`；非法日期 → 空串 |
| `excerpt` | `(value, length = 120, suffix = '…') => string` | 去 HTML 标签、合并空白、按字符截断加后缀 |
| `number` | `(value, fallback = 0) => number` | 非有限数 → `fallback` |
| `json` | `(value) => string` | `JSON.stringify(value ?? null)`；由 Core 注册（**不在** `THEME_FILTERS` 里） |

```njk
<span>{{ post.publishedAt | date('YYYY年MM月DD日') }}</span>
<p>{{ post.excerpt | excerpt(120) }}</p>
<span>{{ posts.total | number }}</span>
<div class="card" style="border-color: {{ theme.settings.accentColor | css_color('#89A9C7') }}"></div>
```

> `css_color` 存在的意义：**阻断通过主题设置把任意字符串注入 `style`**。
> 任何来自设置的颜色都必须过这个过滤器。

`json` 的输出是普通字符串（**不是** SafeString），因此会被自动转义 ——
用于内联脚本时要配合 Core 的安全序列化（见第 6 节）。

---

## 5. 输出安全

| 机制 | 说明 |
| --- | --- |
| Nunjucks `autoescape: true` | **默认全部转义** |
| `TrustedHtml` → `SafeString` | 只有被显式标记为受信的 HTML 才不转义 |
| `slot()` 返回 `SafeString` | 插槽内容（已由插件生成）不会被二次转义 |
| `sanitizeRichText()` | 富文本消毒（白名单标签） |
| `safeJsonForInlineScript()` | 内联 JSON 转义 `<` `>` `&` 与 U+2028/U+2029，防 `</script>` 提前闭合 |

**主题作者的原则**：能不能输出，由"数据是否被标记为受信"决定，而不是由模板决定。
所以模板里正常写 `{{ post.html }}` 就是安全的 —— 受信则原样输出，否则被转义。

---

## 6. 静态资源与缓存

```njk
<link rel="stylesheet" href="{{ theme_asset('css/style.css') }}">
<script src="{{ theme_asset('js/main.js') }}" defer></script>
```

- 输出形如 `/theme-assets/rice.default/css/style.css?v=1.1.0`；
- 响应头是 `immutable` 长缓存（一年）→ **改了资源必须提升 `theme.json` 的 `version`**；
- 该路由限定在主题 `assets/` 目录内（防目录穿越）。

前台 HTML 缓存键包含：主题 ID、主题设置 revision、站点信息 revision、已启用能力集合、
canonical URL、**规范化查询串**、模板名。因此换主题、改设置、改站点信息都会自动分区。

---

## 7. 完整模板骨架示例

```njk
<!doctype html>
<html lang="{{ site.language }}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{% if page.title %}{{ page.title }} · {% endif %}{{ site.title }}</title>
  <meta name="description" content="{{ site.description }}">
  <link rel="canonical" href="{{ site_url(page.canonicalUrl) }}">
  <link rel="stylesheet" href="{{ theme_asset('css/style.css') }}">
  {{ slot('head.end') }}
</head>
<body class="kind-{{ current_kind }}">
  {{ slot('body.start') }}

  <header class="site-header">
    <a class="brand" href="{{ url('home') }}">{{ site.title }}</a>
    {% if site.logoUrl %}<img class="brand-logo" src="{{ site.logoUrl }}" alt="">{% endif %}
    {{ slot('header.navigation') }}
  </header>

  <main class="site-main">
    {% block content %}{% endblock %}
    {{ slot('body.end') }}
  </main>

  <footer class="site-footer">
    {{ theme.settings.footerText }}
    {% if site.icpText %}<a href="{{ site.icpUrl }}">{{ site.icpText }}</a>{% endif %}
    {{ slot('footer.widgets') }}
  </footer>

  <script src="{{ theme_asset('js/main.js') }}" defer></script>
</body>
</html>
```

`post.njk` 中的标准挂载点：

```njk
<article class="post">
  <h1>{{ post.title }}</h1>
  <p class="meta">{{ post.authorName }} · {{ post.publishedAt | date('YYYY-MM-DD') }}</p>

  {{ slot('post.beforeContent', { postId: post.id }) }}
  <div class="post-body">{{ post.html }}</div>
  {{ slot('post.afterContent', { postId: post.id }) }}

  {% if has_feature('comments') %}
    <section class="comments">{{ slot('post.comments', { postId: post.id }) }}</section>
  {% endif %}
</article>
```

---

## 相关页面

- [[主题包结构与契约|Development/Theme-API/Overview]]
- [[挂载点清单|Development/Theme-API/Slots]]
- [[主题设置与多语言|Development/Theme-API/Settings]]
- [[渲染与缓存|Development/Architecture/Render-Pipeline]]
