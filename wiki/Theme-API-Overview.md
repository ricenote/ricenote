# 主题包结构与契约

主题是**零构建**的：一个目录 + `theme.json` + Nunjucks 模板 + 可选资源。不需要打包器、不需要 Node 依赖。

相关源码：`packages/shared/manifests/theme.schema.json`、`packages/theme-sdk/src/`、`packages/core/src/themes/manager.ts`。
权威文档：[docs/theme-api/v1.md](https://github.com/ricenote/ricenote/blob/main/docs/theme-api/v1.md)。

---

## 1. 目录结构

```
themes/my-theme/
├── theme.json           # 必需
├── templates/           # 必需：templates 引用的文件必须存在
│   ├── layout.njk
│   ├── index.njk        #   home
│   ├── post.njk         #   post
│   ├── page.njk         #   page
│   ├── page-plain.njk   #   pageTemplates: plain
│   ├── page-narrow.njk  #   pageTemplates: narrow
│   ├── archive.njk      #   archive
│   ├── search.njk       #   search
│   ├── 404.njk          #   404
│   └── partials/        #   自由组织（可选）
├── assets/              # 可选：css / js / 图片
└── screenshot.png       # 可选：后台预览图
```

**硬性要求只有两条**：

1. 目录里有 `theme.json`；
2. `templates.<kind>` 与 `pageTemplates[*].template` 引用的每个文件都存在。

`assets/`、`screenshot.png`、`partials/` 都是自由约定（`assets/` 目录存在与否**不校验**，
只是资源 URL 会按 `<theme>/assets/<path>` 拼）。

---

## 2. `theme.json` 字段全表

Schema：`packages/shared/manifests/theme.schema.json`（draft-07）。
`required` 为：`schemaVersion`、`id`、`name`、`version`、`apiVersion`、`engine`、`templates`；
且 **`additionalProperties: false`** —— 未定义的字段会导致校验失败。

| 字段 | 类型 / 约束 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | 字面量 `1` | ✅ | 清单格式版本 |
| `id` | `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$`，≤ 80 | ✅ | 主题 ID，如 `rice.default`（**至少两段**） |
| `name` | 1–80 | ✅ | 显示名 |
| `version` | 语义化版本 | ✅ | 版本（**同时是静态资源指纹**：改了资源就要提升它） |
| `apiVersion` | 字符串，≥ 1 | ✅ | 主题 API 版本，官方主题写 `^1.0.0` |
| `engine` | 字面量 `nunjucks` | ✅ | 固定值 |
| `templates` | 对象：kind → `^[^/\\]+\.njk$` | ✅ | 各页面类型的模板文件 |
| `description` | ≤ 500 | | 描述 |
| `author` | ≤ 160 | | 作者 |
| `license` | ≤ 64 | | 许可 |
| `screenshot` | `^\./` | | 预览图（须以 `./` 开头且文件存在） |
| `pageTemplates` | 对象，≥ 1 项 | | **可供内容选择的版式** |
| `requires` | 对象：能力契约 → semver 区间 | | 依赖的内容能力 |
| `settings` | 引用共享的 `settingsSchema` 定义 | | **声明式设置表单** |
| `contentFields` | 对象，≤ 20 项 | | **内容自定义字段** |

> ⚠️ **两个最容易踩的坑**：
> 1. 主题设置字段是 **`settings`**，**不是** `settingsSchema`（后者是插件 manifest 的字段名）。
>    写成 `settingsSchema` 会被 `additionalProperties: false` 拒绝。
> 2. 没有 `homepage`、`assets`、`pageTypes` 这些字段。

TS 类型对应 `packages/shared/src/manifests.ts` 的 `ThemeManifest` / `ThemeSettingField` / `PageTemplateDeclaration`。

---

## 3. 模板查找链

`ThemeRenderer.resolveTemplate()` 的实际顺序：

```
① 内容指定的 pageTemplates 键  →  resolvePageTemplate(key) 映射到文件
② 内容指定的模板文件名          →  需 isSafeTemplateName() 且文件存在
③ theme.json 的 templates[kind]
④ 主题自己的 fallback.njk
⑤ 返回 'fallback.njk'  →  由加载器决定：先主题 templates/，再 Core 内置模板目录
```

文档里说的"三级回退"是这个链路的简化说法；实际有**两种"显式模板"来源**（① 和 ②）。

**模板名安全校验**（只作用于 ②）：

```ts
/^[^/\\]+\.njk$/.test(name) && !name.includes('..')
```

即"不含路径分隔符的 `.njk` 文件名"。杜绝借模板名读取任意文件。

### 版式键失效时

- **写入时严**：`resolveContentTemplateKey(raw, available)` 会拒绝空以外的非法值：
  超长（> 120）→ 抛 `RN_CONTENT_TEMPLATE_INVALID`；主题未声明任何版式 → 抛；
  键不在清单 → 抛。
- **读取时宽**：渲染时键不存在或文件缺失 → 返回 `undefined`，**回退到 kind 模板，不报错**。

这个组合保证了"换主题不会让已有内容失效"。

---

## 4. `pageTemplates`（可供内容选择的版式）

```json
"pageTemplates": {
  "default": {
    "template": "page.njk",
    "label": { "zh-CN": "标准页面", "en": "Standard page" },
    "description": { "zh-CN": "含标题与正文", "en": "With title" }
  },
  "plain":  { "template": "page-plain.njk",  "label": { "zh-CN": "落地页" } },
  "narrow": { "template": "page-narrow.njk", "label": { "zh-CN": "窄栏阅读" } }
}
```

- 键即"版式键"，**内容只保存这个键**；
- `label` / `description` 支持多语言对象；
- 后台下拉选项由 `ThemeManager.pageTemplateDescriptors()` 生成，经 `core.theme@1.pageTemplates()` 暴露；
- 当前主题可用版式经 `activePageTemplates()` 查询。

---

## 5. `contentFields`（内容自定义字段）

```json
"contentFields": {
  "featuredImage": {
    "type": "image",
    "label": { "zh-CN": "特色图片", "en": "Featured image" },
    "description": { "zh-CN": "列表与文章页的封面", "en": "Cover" },
    "placeholder": { "zh-CN": "选择图片" },
    "maxLength": 500
  }
}
```

- 字段名匹配 `^[a-z][A-Za-z0-9]{0,39}$`，最多 20 项，且有**保留字**限制（`pnpm validate` 会校验）；
- 字段定义复用 `settings.schema.json` 的 `settingField`（因此支持 `type` / `label` / 多语言等）；
- 值在**读写两侧都过滤**（fail-closed）：校验不通过不写入、读取时不返回；
- 模板里通过 `page.fields.<键>` 读取；后台由 SDK 的 `ContentFields` 组件自动渲染
  （它自己按当前主题声明取数，无声明时什么都不渲染）。

官方主题对照：`rice.default` 声明了 `featuredImage`，`rice.minimal` 未声明。

---

## 6. `requires`

```json
"requires": { "content.posts@1": "^1.0.0" }
```

声明主题依赖的内容能力。模板里用 `has_feature('posts')` / `has_feature('content.posts@1')` 判断，
未满足时相应入口不渲染（例如搜索框在 `rice.search` 禁用后整体消失）。

---

## 7. 两套官方主题对照

| 项 | `rice.minimal` | `rice.default` |
| --- | --- | --- |
| 名称 / 版本 | Minimal / 1.1.0 | Default / 1.1.1 |
| 风格 | 极简阅读 | 深色页眉 + 卡片网格 |
| 模板 | 9 个 + `partials/pagination.njk`、`partials/post-card.njk` | 同 9 个（无 partials 目录） |
| `pageTemplates` | `default` / `plain` / `narrow` | 同（键一致） |
| `settings` 分组 | `appearance`（强调色、栏宽、字体、侧栏、每页条数）、`header`（标语、搜索入口）、`footer`（页脚文案、备案链接） | `appearance`（强调色、列数、封面开关）、`footer`（页脚文案） |
| `contentFields` | 无 | `featuredImage` |
| `requires` | `content.posts@1` | `content.posts@1` |

两套主题的 `templates` 都是 6 个 kind：`home` / `post` / `page` / `archive` / `search` / `404`。

---

## 8. 一份真实的精简 `theme.json`

取自 `themes/default/theme.json`（省略部分字段）：

```json
{
  "schemaVersion": 1,
  "id": "rice.default",
  "name": "Default",
  "description": "默认主题：深色页眉 + 卡片网格首页。",
  "version": "1.1.1",
  "apiVersion": "^1.0.0",
  "engine": "nunjucks",
  "author": "RiceNote",
  "license": "MIT",
  "templates": {
    "home": "index.njk",
    "post": "post.njk",
    "page": "page.njk",
    "archive": "archive.njk",
    "search": "search.njk",
    "404": "404.njk"
  },
  "pageTemplates": {
    "default": { "template": "page.njk", "label": { "zh-CN": "标准页面", "en": "Standard page" } }
  },
  "contentFields": {
    "featuredImage": {
      "type": "image",
      "label": { "zh-CN": "特色图片", "en": "Featured image" },
      "maxLength": 500
    }
  },
  "requires": { "content.posts@1": "^1.0.0" },
  "settings": {
    "appearance": {
      "label": { "zh-CN": "外观", "en": "Appearance" },
      "fields": {
        "accentColor": { "type": "color", "label": { "zh-CN": "强调色" }, "default": "#E8B04B" }
      }
    }
  }
}
```

---

## 9. 主题的生命周期

| 阶段 | 行为 |
| --- | --- |
| 发现 | 扫描 `THEMES_DIR` 下含 `theme.json` 的目录 |
| 校验 | 校验清单、模板文件存在性、`pageTemplates` 文件存在性、`contentFields` 保留字 |
| 同步 | 启动时 `themeManager.sync()` 把磁盘上的主题登记到库 |
| 激活 | 后台「外观中心」或 `pnpm theme activate <id>`，写入 `rn_site_state` |
| 设置 | 声明式表单 → 保存为 revision，支持预览 / 历史 / 回滚 / 重置 |
| 安装 | **后台**上传 ZIP（两阶段安全校验：先全量校验再落盘） |
| 卸载 | 当前激活的主题不可删除 |

---

## 相关页面

- [[模板变量与过滤器|Theme-API-Template-Reference]]
- [[主题设置与多语言|Theme-API-Settings]]
- [[挂载点清单|Theme-API-Slots]]
- [[主题与外观|Themes]]（使用者视角）
