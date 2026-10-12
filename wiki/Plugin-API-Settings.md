# 声明式设置表单

插件只要在 `manifest.json` 里声明 `settingsSchema`，后台「扩展中心 → 插件 → 设置」就会**自动生成表单** ——
不需要写任何后台代码。

**主题设置与插件设置共用同一份 JSON Schema 定义、同一套校验与多语言实现**
（`packages/shared/manifests/settings.schema.json`）。

---

## 1. 结构

```
settingsSchema
└── <分组键>
    ├── label      : 分组标题（支持多语言）
    ├── description: 分组说明（可选）
    └── fields
        └── <字段键>
            ├── type    : 9 种类型之一
            ├── label   : 字段标题
            ├── default : 默认值
            └── ...约束项
```

示例：

```json
{
  "settingsSchema": {
    "general": {
      "label": { "zh-CN": "常规", "en": "General" },
      "description": "站点公告的基础设置",
      "fields": {
        "enabled": { "type": "boolean", "label": "启用公告", "default": true },
        "message": { "type": "text", "label": "公告文案", "default": "欢迎访问", "maxLength": 200 },
        "tone": {
          "type": "select", "label": "色调", "default": "info",
          "options": [
            { "value": "info", "label": { "zh-CN": "信息", "en": "Info" } },
            { "value": "warn", "label": { "zh-CN": "警示", "en": "Warning" } }
          ]
        }
      }
    },
    "advanced": {
      "label": "高级",
      "fields": {
        "blockedKeywords": {
          "type": "stringList", "label": "屏蔽词", "default": [],
          "maxItems": 100, "maxLength": 32,
          "description": "每行一项"
        }
      }
    }
  }
}
```

---

## 2. 九种字段类型

| 类型 | 值形态 | 支持的约束 | 后台控件 |
| --- | --- | --- | --- |
| `text` | string | `maxLength` | 单行输入 |
| `textarea` | string | `maxLength` | 多行输入 |
| `color` | string | ——（强制 CSS 颜色白名单） | 颜色选择 |
| `boolean` | boolean | —— | 开关 |
| `number` | number | `min` / `max` | 数字输入 |
| `select` | 枚举值 | `options[]`（最多取前 64 项） | 下拉 |
| `image` | `null` / `''` / 媒体 ID / `/uploads` 或 `/media` 开头 | `maxLength` | 媒体选择器 |
| `url` | string | `maxLength`；非空须以 `http://` 或 `https://` 开头 | 地址输入 |
| `stringList` | `string[]` | `maxItems`（默认 200）、单项 `maxLength` | 每行一项的多行输入 |

### 校验规则（服务端强制）

| 类型 | 校验 |
| --- | --- |
| `text` / `textarea` / `url` | 必须是字符串；`maxLength` 生效；`url` 非空时必须以 `http(s)://` 开头 |
| `number` | 必须是有限数；`min` / `max` 收敛 |
| `boolean` | 接受 `true` / `false` / `'true'` / `'false'` |
| `color` | 必须是合法 CSS 颜色（hex / rgb(a) / hsl(a) / 具名色） |
| `select` | 值必须命中 `options`（**最多取前 64 项**） |
| `image` | 接受 `null` / 空串 / 整数 ID / `/uploads…` 或 `/media…` 开头的字符串 |
| `stringList` | 接受 `string[]`，或**按行拆分的字符串**；丢弃空行与首尾空白；受 `maxItems` / `maxLength` 约束 |

**未在 schema 中声明的键一律拒绝**，返回 `RN_PLUGIN_SETTING_INVALID`。
（这一点和其他系统的"宽松写入"不同：写错键名不会静默成功。）

---

## 3. 多语言文案

`label` / `description` / `placeholder` / `options[].label` 都支持两种写法：

```json
"label": "公告文案"
```
```json
"label": { "zh-CN": "公告文案", "en": "Notice message" }
```

运行时按**站点语言**解析，顺序为：

```
精确匹配（zh-CN） → 基础语言（zh） → en → 首个非空值 → fallback
```

后台 DTO 直接给出**已解析的字符串**，前端不需要处理语言。

---

## 4. 默认值的三个来源与合并顺序

```
manifest.settings 的扁平默认值（旧写法，兼容用）
  → manifest.settingsSchema 各字段的 default
  → 数据库中的覆盖值
```

最终合并结果同时提供给两处，且**用的是同一个函数**：

1. 插件通过 `ctx.config.get(key, fallback)` 读取；
2. 后台设置表单显示当前值。

> 这正是修复过的历史缺陷：此前后台表单与插件上下文各自计算，导致
> "表单显示 20、插件实际按代码兜底 160 运行"的错位。

**默认值只声明一处**：请写在 `settingsSchema` 的字段 `default` 上。
同时写 `settings` 与 `settingsSchema.default` 必然导致漂移。

---

## 5. 保存语义

| 行为 | 说明 |
| --- | --- |
| **合并式写入** | 只覆盖提交的字段，**不会**清空未提交的字段 |
| 未声明键 | 拒绝（`RN_PLUGIN_SETTING_INVALID`） |
| 字段级错误 | 表单就地提示，不影响其它字段 |
| 生效时机 | **需要重启**（`ctx.config` 是启动期快照） |

保存成功后：

1. 标记"待生效"；
2. 后台顶栏出现「待重启」按钮；
3. 点击后确认 → 进程内软重启 → 轮询等待服务恢复。

> **为什么必须重启**：插件在 `start()` 里读配置并**缓存**到自己的运行时对象中（这是正常且高效的做法）。
> 让配置每次访问都走数据库会把"配置"变成"热查询"。因此 v1 的语义是"改完重启生效"，
> 并由后台把这件事变得无痛（一键）。

### 越界值收敛

`settingsSchema` 的 `min` / `max` 是**声明**；服务端会按声明校验写入值。
但历史脏值（如 `NaN`、旧版本写入的超界值）可能仍在数据库里 ——
因此官方插件在**读取时**再做一次收敛（例如把 `pageSize` 夹到 1–50），
避免"分页查询被脏值搞崩"。**建议第三方插件也照做**：

```ts
const pageSize = clampInt(ctx.config.get('pageSize', 10), 1, 50, 10);
function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
```

---

## 6. 导出与敏感值

`toExportableSettings()`（导出设置时使用）会**过滤掉**键名以
`secret` / `token` / `password` / `key` 结尾的字段 ——
避免把凭据写进可下载的设置导出里。

> 这不是"加密存储"，只是"不导出"。**真正的凭据请放在环境变量里**
> （例如私有 npm 源的令牌就走环境变量，不落库）。

---

## 7. 设置项写在哪一层？

| 你想让用户改的东西 | 应该放在 |
| --- | --- |
| 插件自身行为（分页大小、开关、文案） | 插件的 `settingsSchema` |
| 站点级信息（标题、描述、Logo、备案） | Core「系统设置」（**立即生效**，不是插件设置） |
| 主题外观（强调色、栏宽、页脚文案） | 主题的 `settings`（**同样走声明式表单**） |
| 部署级配置（数据库、端口、密钥） | `.env` |

---

## 8. 检查清单

| 检查项 | 期望 |
| --- | --- |
| 默认值是否只写在 `settingsSchema.default` | ✅（不要同时写 `settings`） |
| 字段键名是否与 `ctx.config.get()` 一致 | ✅ |
| `select` 是否提供了 `options` | ✅ |
| 长文本是否设了 `maxLength` | ✅ |
| 是否在读取时收敛越界值 | ✅（推荐） |
| 是否在 `pnpm validate` 后通过 | ✅ |

---

## 相关页面

- [[manifest 逐字段参考|Plugin-API-Manifest-Reference]]
- [[主题设置与多语言|Theme-API-Settings]]
- [[后台功能导览|Admin-Guide]]
