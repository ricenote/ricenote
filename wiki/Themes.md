# 主题与外观

主题决定站点的外观。RiceNote 的主题是**零构建**的：一个目录 + `theme.json` + Nunjucks 模板 + 可选静态资源，
不需要打包工具、不需要 Node 依赖。

> 想动手写主题？请看 [[主题包结构与契约|Development/Theme-API/Overview]]。

---

## 主题包结构

```
themes/my-theme/
├── theme.json          # 必需：清单
├── templates/          # 必需：templates 声明的模板文件必须都在
│   ├── index.njk       #   home
│   ├── post.njk        #   post
│   ├── page.njk        #   page
│   ├── archive.njk     #   archive
│   ├── search.njk      #   search
│   ├── 404.njk         #   404
│   ├── layout.njk      #   基布局（主题自由组织）
│   ├── page-plain.njk  #   可选：供内容选择的页面模板
│   └── page-narrow.njk
├── assets/             # 可选：css / js / 图片
│   ├── css/style.css
│   └── js/main.js
└── screenshot.png      # 可选：后台主题卡片预览图
```

**必需**的只有 `theme.json` 与 `templates/` 下被 `templates` 引用到的文件（缺失会导致主题校验不通过）。
`assets/` 与 `screenshot.png` 属于可选约定。

---

## `theme.json` 字段

以 `packages/shared/manifests/theme.schema.json` 为准（**`additionalProperties: false`：未列出的字段会导致校验失败**）。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | ✅ | 固定为字面量 `1` |
| `id` | 字符串，形如 `rice.default` | ✅ | 主题唯一 ID |
| `name` | 字符串（≤ 80） | ✅ | 显示名 |
| `version` | 语义化版本 | ✅ | 主题版本，**同时用作静态资源指纹** |
| `apiVersion` | 字符串 | ✅ | 主题 API 版本，官方主题写 `^1.0.0` |
| `engine` | `nunjucks` | ✅ | 固定值 |
| `templates` | 对象：kind → `*.njk` 文件名 | ✅ | 至少包含你支持的页面类型 |
| `description` | 字符串（≤ 500） | | 主题描述 |
| `author` / `license` | 字符串 | | 署名与许可 |
| `screenshot` | `./xxx.png` | | 预览图，需以 `./` 开头且文件存在 |
| `pageTemplates` | 对象：键 → `{ template, label, description? }` | | **可供内容选择的版式**（见下） |
| `requires` | 对象：能力契约 → 版本区间 | | 依赖的内容能力，如 `content.posts@1` |
| `settings` | 与插件设置**共用**的 `settingsSchema` 结构 | | 声明式设置表单（见下） |
| `contentFields` | 对象（≤ 20 项） | | 声明内容自定义字段（如特色图片） |

> ⚠️ **主题设置字段名是 `settings`，不是 `settingsSchema`**（后者是插件 manifest 的字段名）。
> 写成 `settingsSchema` 会被 schema 直接拒绝。

### 模板查找顺序

渲染时按以下顺序找模板（`ThemeRenderer.resolveTemplate`）：

1. 内容指定的 **`pageTemplates` 键**（如 `narrow`）→ 映射到主题内模板文件；
2. 内容指定的**模板文件名**（仅在文件名安全且文件存在时）；
3. `theme.json` 的 `templates[kind]`；
4. 主题自己的 `fallback.njk`；
5. Core 内置的 `fallback.njk`。

若内容保存的模板键在当前主题里不存在或文件缺失，**优雅回退到 kind 模板，不会报错**。

---

## 可供内容选择的页面模板（`pageTemplates`）

```json
"pageTemplates": {
  "default": { "template": "page.njk",        "label": { "zh-CN": "标准页面", "en": "Standard page" } },
  "plain":   { "template": "page-plain.njk",  "label": { "zh-CN": "落地页",   "en": "Landing page" } },
  "narrow":  { "template": "page-narrow.njk", "label": { "zh-CN": "窄栏阅读", "en": "Narrow reading" } }
}
```

- 页面与文章编辑时会出现版式下拉，选项即这里的键。
- 内容**只保存模板键**，不保存文件名 —— 主题重命名模板文件不会让已有内容失效。
- 保存时服务端会校验键必须命中**当前主题声明的清单**；渲染期对失效键优雅回退。

---

## 内容自定义字段（`contentFields`）

主题可以声明额外的内容字段，编辑页会出现对应输入项，模板里通过 `page.fields.<键>` 读取。

```json
"contentFields": {
  "featuredImage": {
    "type": "image",
    "label": { "zh-CN": "特色图片", "en": "Featured image" },
    "maxLength": 500
  }
}
```

官方主题 `rice.default` 就声明了 `featuredImage` 并在文章页 / 页面 / 首页卡片渲染它；`rice.minimal` 未声明。

> 字段名有保留字限制，且值在读写两侧都会过滤（fail-closed）：**值校验不通过时不写入，读取时也不返回**。

---

## 主题设置与三层配置模型

主题设置由 **manifest 声明**、后台**自动生成表单**，不需要写任何后台代码。

**合成公式：**

```
生效值   effective = defaults + publishedOverrides
预览值   preview   = defaults + publishedOverrides + draftOverrides
```

- `defaults` 来自 `theme.json` 中每个字段的 `default`；
- `publishedOverrides` 是"发布"过的覆盖值；
- `draftOverrides` 只在后台预览时叠加，不影响前台。

**乐观锁：** 每次发布写入一个 `revision`；提交时若 `revision` 不匹配（说明有别人先改了），
服务端返回 **409**（`REVISION_CONFLICT`）而不是静默覆盖。同时保存历史，支持**回滚**与**重置**。

### 字段类型

`text` / `textarea` / `color` / `boolean` / `number` / `select` / `image` / `url` / `stringList`

- `color` 输出时强制经过 `css_color` 白名单过滤器（阻断把任意字符串注入 `style`）；
- `stringList` 在后台表现为「每行一项」的多行输入，支持 `maxItems`（默认 200）与单项 `maxLength`；
- 提交时也接受"按行分隔的字符串"，服务端统一拆分并丢弃空行与首尾空白；
- **未声明的字段一律拒绝**。

### 多语言文案

`label` / `description` / `placeholder` / `options[].label` 支持两种写法：字符串，或
`{ "zh-CN": "...", "en": "..." }` 对象。运行时按站点语言解析：
**精确匹配 → 基础语言（`zh-CN` → `zh`）→ `en` → 首个非空值**。

后台拿到的是已解析好的字符串，主题不需要处理语言。

---

## 官方两套主题

| 主题 | ID | 特点 | 设置分组 |
| --- | --- | --- | --- |
| Minimal | `rice.minimal` | 极简阅读；带 `partials/` 拆分（分页与文章卡片） | `appearance`（强调色、栏宽、字体、侧栏、每页条数）、`header`（标语、搜索入口）、`footer`（页脚文案、备案链接） |
| Default | `rice.default` | 深色页眉 + 卡片网格首页 | `appearance`（强调色、列数、封面开关）、`footer`（页脚文案） |

两套主题都有 `page.njk` / `page-plain.njk` / `page-narrow.njk` 三个版式，`pageTemplates` 键相同（`default` / `plain` / `narrow`）。

**切换主题不影响任何插件** —— 这是主题 API 的核心承诺。

---

## 安装、激活与设置

| 操作 | 入口 |
| --- | --- |
| 安装主题 | 后台 **外观中心 → 安装主题**（上传 ZIP，走两阶段安全校验）；或把主题目录直接放进 `THEMES_DIR` |
| 激活主题 | 后台 **外观中心 → 激活**，或 `pnpm theme activate <themeId>` |
| 查看/修改设置 | 后台 **外观中心 → 设置**（声明式表单，支持预览、历史、回滚、重置） |
| 列出主题 | `pnpm theme`（`●` 表示当前激活），或后台外观中心 |
| 查看生效设置 | `pnpm theme settings <themeId>` |
| 删除主题 | 后台外观中心（当前激活的主题不可删除） |

> ⚠️ **没有 `theme install` 命令**。`pnpm theme` 只支持 `list` / `activate` / `settings`；
> 主题包安装请走后台（`POST /api/admin/themes/install`）。安装向导结束语里那句
> `pnpm theme install <主题包.zip>` 是过时提示，详见 [[常见问题|FAQ]]。

---

## 静态资源与缓存

- 模板里用 `theme_asset('css/style.css')` 生成资源地址，输出形如
  `/theme-assets/rice.default/css/style.css?v=1.1.0`。
- 该地址带**主题版本指纹**并返回 `immutable` 长缓存；**改了资源就要提升主题 `version`**，否则访客会拿到旧文件。
- 前台 HTML 缓存的键包含：主题 ID、主题设置 revision、站点信息 revision、已启用能力集合、canonical URL、**规范化后的查询串**、模板名。
- 内容变更会按标签失效缓存；对**出现在每个页面上的内容**（如导航栏），会整体清空缓存。
- 缓存开关与 TTL 由 `RENDER_CACHE_ENABLED` / `RENDER_CACHE_TTL_SECONDS` 控制。

---

## 相关页面

- [[主题包结构与契约|Development/Theme-API/Overview]]
- [[模板变量与过滤器|Development/Theme-API/Template-Reference]]
- [[挂载点清单|Development/Theme-API/Slots]]
- [[后台功能导览|Admin-Guide]]
