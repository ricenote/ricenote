# 主题设置与多语言

主题设置**由 `theme.json` 声明、后台自动生成表单**，不需要写后台代码。
它与插件设置**共用同一份 JSON Schema**（`packages/shared/manifests/settings.schema.json`）与同一套校验实现。

---

## 1. 声明方式

字段名是 **`settings`**（不是 `settingsSchema`）：

```json
{
  "settings": {
    "appearance": {
      "label": { "zh-CN": "外观", "en": "Appearance" },
      "description": { "zh-CN": "配色与版式", "en": "Colors and layout" },
      "fields": {
        "accentColor": {
          "type": "color",
          "label": { "zh-CN": "强调色", "en": "Accent color" },
          "default": "#89A9C7"
        },
        "layoutWidth": {
          "type": "number",
          "label": { "zh-CN": "内容宽度（px）", "en": "Content width" },
          "default": 960, "min": 640, "max": 1440
        },
        "fontFamily": {
          "type": "select",
          "label": { "zh-CN": "字体", "en": "Font" },
          "default": "system",
          "options": [
            { "value": "system", "label": { "zh-CN": "系统默认", "en": "System" } },
            { "value": "serif",  "label": { "zh-CN": "衬线", "en": "Serif" } }
          ]
        },
        "showSidebar": { "type": "boolean", "label": { "zh-CN": "显示侧栏" }, "default": true }
      }
    }
  }
}
```

模板里通过 `theme.settings.<字段名>` 读取生效值。

> ⚠️ 写成 `settingsSchema` 会被 schema 的 `additionalProperties: false` **拒绝**。

---

## 2. 三层配置模型

```
生效值   effective = defaults + publishedOverrides
预览值   preview   = defaults + publishedOverrides + draftOverrides
```

| 层 | 来源 | 作用范围 |
| --- | --- | --- |
| `defaults` | `theme.json` 各字段的 `default` | 兜底 |
| `publishedOverrides` | 后台「发布」过的值 | 前台生效 |
| `draftOverrides` | 后台「预览」时的临时值 | **只影响预览，不影响前台** |

合成函数是 `composeSettings(defaults, published, draft?)`；入口是 `ThemeManager.resolveSettings(theme, draft?)`，
它会一并返回 `revision`。

**字段缺省默认值**（未写 `default` 时按类型兜底）：

| 类型 | 兜底值 |
| --- | --- |
| `boolean` | `false` |
| `number` | `min ?? 0` |
| `select` | 第一个 option 的 value |
| `color` | `#000000` |
| `stringList` | `[]` |
| 其它（`text` / `textarea` / `url` / …） | `''` |

---

## 3. revision 乐观锁

每次发布都会写入一个新的 `revision`（连同一份**历史**，存储在
`rn_theme_settings` + `rn_theme_setting_revisions`，同事务写入）。

提交时如果客户端带来的 `revision` 与当前不一致（说明有别人先改了），服务端返回：

```
HTTP 409   RN_REVISION_CONFLICT
details: { themeId, expectedRevision, currentRevision }
```

**不会静默覆盖**。前端据此提示用户刷新重试。

配套能力：

| 操作 | 说明 |
| --- | --- |
| 发布 | 写入 published 覆盖值 + 新 revision |
| 预览 | 生成带 `draftOverrides` 的预览（预览链接有 TTL，默认 900 秒） |
| 回滚 | 从历史 revision 恢复 |
| 重置 | 清空覆盖值，回到 `defaults` |

---

## 4. 九种字段类型与约束

| 类型 | 值形态 | 约束 | 后台控件 |
| --- | --- | --- | --- |
| `text` | string | `maxLength` | 单行输入 |
| `textarea` | string | `maxLength` | 多行输入 |
| `color` | string | 强制 CSS 颜色白名单（**输出时必须经 `css_color` 过滤器**） | 颜色选择 |
| `boolean` | boolean | 接受 `true` / `false` / `'true'` / `'false'` | 开关 |
| `number` | number | `min` / `max` | 数字输入 |
| `select` | 枚举值 | 必须命中 `options`（最多取前 64 项） | 下拉 |
| `image` | `null` / `''` / 媒体 ID / `/uploads…` `/media…` 开头 | `maxLength` | 媒体选择器 |
| `url` | string | 非空须 `^https?://` | 地址输入 |
| `stringList` | `string[]` | `maxItems`（默认 200）、单项 `maxLength` | 每行一项的多行输入 |

**未声明的字段一律拒绝**（写入时报 `THEME_SETTING_INVALID`）。

`stringList` 的细节：提交时也接受"按行分隔的字符串"，服务端统一按 `\r?\n` 拆分为数组，
**丢弃空行与首尾空白**，再套 `maxItems` / 单项 `maxLength`。

---

## 5. 多语言文案

`label` / `description` / `placeholder` / `options[].label` 支持两种写法：

```json
"label": "强调色"
"label": { "zh-CN": "强调色", "en": "Accent color" }
```

解析函数是 `resolveLocalizedText()`（`@ricenote/theme-sdk`），顺序为：

```
精确匹配（zh-CN）
  → 基础语言（zh-CN → zh）
  → en
  → 首个非空值
  → fallback
```

传入字符串时原样返回。后台 DTO（`buildSettingGroups()`）给出的已是**解析后的字符串**，
所以主题与插件都不需要处理语言分支。

---

## 6. 在模板里安全使用设置

`color` 类型的值**必须**经 `css_color` 过滤后再输出：

```njk
<style>
  :root {
    --accent: {{ theme.settings.accentColor | css_color('#89A9C7') }};
    --width: {{ theme.settings.layoutWidth | number(960) }}px;
  }
</style>
```

**为什么**：主题设置是后台可写入的值。若直接拼进 `style`，
就是一条"从后台往页面注入任意 CSS"的路径。`css_color` 提供白名单校验，
`number` 保证是数字 —— 两者一起把这条路径关掉。

```njk
{# 布尔开关：控制结构而不是拼样式 #}
<body class="{{ 'has-sidebar' if theme.settings.showSidebar else 'no-sidebar' }}">
```

---

## 7. 后台侧

| 入口 | 能力 |
| --- | --- |
| 外观中心 → 主题设置 | 声明式表单、字段级校验、预览、历史、回滚、重置 |
| 外观中心 → 页面模板 | 列出 `pageTemplates` 的键、文案、模板文件与说明 |
| 外观中心 → 内容字段 | 展示主题声明的 `contentFields` |

API：`GET/PUT /api/admin/themes/:themeId/settings`、
`POST /api/admin/themes/:themeId/settings/reset`、`.../rollback`、
`POST /api/admin/themes/:themeId/preview`。

保存后**立即影响渲染**（缓存键含主题 revision，旧缓存自然失效），**不需要重启**。

---

## 8. 主题 vs 插件的设置：怎么选

| 想配置的东西 | 放在 |
| --- | --- |
| 外观（配色、版式、页脚文案、备案） | **主题设置** |
| 某个插件的行为（分页、开关、阈值） | **插件设置** |
| 站点级信息（标题、描述、Logo） | Core「系统设置」（立即生效） |
| 部署级（数据库、端口、密钥） | `.env` |

两者表单长得一样（共用组件与校验），但**归属不同**：换主题时主题设置跟着换，
插件设置不变。

---

## 9. 检查清单

| 检查项 | 期望 |
| --- | --- |
| 字段名是否为 `settings` | ✅（不是 `settingsSchema`） |
| 是否给出 `default` | ✅ |
| `select` 是否提供 `options` | ✅ |
| `color` 输出是否经 `css_color` | ✅ |
| 数值输出是否经 `number` | ✅ |
| 文案是否支持多语言对象 | 建议 ✅ |
| `pnpm validate` | 通过（含 `contentFields` 保留字校验） |

---

## 相关页面

- [[主题包结构与契约|Development/Theme-API/Overview]]
- [[声明式设置表单|Development/Plugin-API/Settings]]（插件侧，同一份 schema）
- [[主题与外观|Themes]]（使用者视角）
