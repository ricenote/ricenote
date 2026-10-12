# `manifest.json` 逐字段参考

`manifest.json` 是插件的身份证与能力声明，由 `packages/shared/manifests/plugin.schema.json`（JSON Schema draft-07）校验。

**两条硬规则：**

1. **`required` 六个字段缺一不可**：`schemaVersion`、`id`、`name`、`version`、`apiVersion`、`entry`；
2. **`additionalProperties: false`** —— **任何未在 schema 中定义的字段都会导致校验失败**。
   写错字段名（例如把 `entry` 写成 `main`、把 `settingsSchema` 写到主题里）会立刻报错，不会静默忽略。

---

## 1. 顶层字段总表

| 字段 | 类型 / 约束 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | 字面量 `1` | ✅ | 清单格式版本 |
| `id` | 字符串，`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$`，≤ 80 | ✅ | 插件唯一 ID，形如 `rice.posts`（**至少两段**） |
| `name` | 字符串，1–80 | ✅ | 显示名 |
| `description` | 字符串，≤ 500 | | 描述 |
| `version` | 字符串，语义化版本 | ✅ | 插件版本（与 `package.json.version`、官方目录推荐版本三者一致） |
| `apiVersion` | 字符串，≥ 1 | ✅ | **Plugin API 版本区间**，官方插件写 `^1.0.0` |
| `author` | 字符串，≤ 160 | | 作者 |
| `license` | 字符串，≤ 64 | | 许可 |
| `homepage` | 字符串，≤ 300 | | 主页 |
| `entry` | 字符串，`^\./` | ✅ | 入口文件，如 `./dist/index.js` |
| `requires` | 对象：契约/插件 ID → semver 区间 | | **依赖声明** |
| `provides` | 字符串数组，`^...@\d+$`，唯一 | | **对外提供的契约**，如 `["content.posts@1"]` |
| `capabilities` | 字符串数组（枚举，见第 2 节），唯一 | | **能力白名单** |
| `migrations` | 字符串，`^\./` | | 迁移目录，如 `./migrations` |
| `settings` | 对象（任意键值） | | **旧写法**：键 → 默认值（仍支持，但默认值应迁到 `settingsSchema.default`） |
| `settingsSchema` | 引用共享的 `settingsSchema` 定义 | | **声明式设置表单**（推荐，见 [[设置\|Development/Plugin-API/Settings]]） |
| `extensionPoints` | 数组，≤ 30 项 | | 声明自己提供的命名扩展点 |
| `contributions` | 数组，≤ 40 项 | | 向扩展点贡献 |
| `admin` | 对象，`required: ["pages"]` | | 后台页面声明 |

> **不存在的字段**（常见误解）：`main`（用 `entry`）、`dependsOn`（用 `requires`）、`scripts`、
> `hostRange` / `engines`、`keywords`、顶层 `icon`。
> 插件的构建脚本写在 **`package.json` 的 `scripts.build`**，不在 manifest 里。

---

## 2. `capabilities` 枚举（12 项）

```
routes:public        routes:admin         database:own
events:publish       events:subscribe     services:provide
services:consume     slots:register       admin:menu
media:store          extensions:declare   extensions:contribute
```

每一项解锁的 API 见 [[起步|Development/Plugin-API/Getting-Started]] 第 3 节。
未声明的能力被调用时抛 `RN_FORBIDDEN`（403）。

---

## 3. `requires` 与 `provides`

```json
{
  "requires": { "identity.users@1": "^1.0.0", "content.taxonomy@1": "^1.0.0" },
  "provides": ["content.posts@1"]
}
```

| 项 | 规则 |
| --- | --- |
| 键（`requires`） | 能力契约名（含 `@`）**或**插件 ID；属性名需匹配 `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*(?:@\d+)?$` |
| 值（`requires`） | semver 区间字符串，非空 |
| `provides` 项 | 必须形如 `name@major`，且不可重复 |

**解析规则**（`dependency-resolver.ts`）：

1. 含 `@` 的键按 **capability** 解析 —— 先精确匹配完整契约，再按 `name + major` 匹配（避免前缀误匹配）；
2. 找到提供者后校验版本区间是否满足；
3. 不含 `@` 的键按**插件 ID** 依赖处理。

解析结果不是抛异常，而是结构化的 `problems[]`（`kind` 为 `missing` / `version` / `cycle` / `apiVersion`），
由内核决定剔除与标记。

### 可选依赖怎么写

对"**别人可能不存在**"的契约，**不要**写进 `requires`（写了就是硬依赖，缺了就启动失败），
而应只声明 `services:consume` 能力，然后在**请求期**用 `tryUse()` 解析：

```ts
const media = ctx.services.tryUse<MediaService>('media.library@1');
if (!media) { /* 降级路径 */ }
```

> 官方 `rice.posts` 对 `content.taxonomy@1`、`media.library@1`、`identity.users@1` 就是这样处理的。
> 而"被动接收别人注册"的契约（如 `content.search@1`）更应该只用 `tryUse()`，且**不得写进 `requires`**。

---

## 4. `admin.pages[]`

```json
{
  "admin": {
    "pages": [
      {
        "id": "notice.editor",
        "label": "公告设置",
        "path": "/notice",
        "icon": "Megaphone",
        "order": 60,
        "permission": "post.view",
        "entry": "./admin/main.js",
        "style": "./admin/style.css",
        "hidden": false
      }
    ]
  }
}
```

| 字段 | 类型 / 约束 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `^[a-z][a-z0-9._-]{1,80}$` | ✅ | 页面 ID（全局唯一） |
| `label` | 1–80 | ✅ | 侧栏显示名 |
| `path` | 以 `/` 开头，≤ 180 | ✅ | 前端路由路径（URL 与声明一致，书签稳定） |
| `entry` | `^\./admin/[\w./-]+\.js$` | ✅ | 前端入口模块（**必须位于 `admin/` 下**） |
| `style` | `^\./admin/[\w./-]+\.css$` | | 页面样式 |
| `icon` | ≤ 60 | | 图标名（见 `ICONS`） |
| `order` | number | | 侧栏排序，**降序**，同分按 ID |
| `permission` | ≤ 80 | | 所需权限点；缺省表示仅需登录 |
| `hidden` | boolean | | `true` 表示**不进侧栏**（靠深链或列表跳转进入，如编辑器页） |

`pages` 数组长度 1–20。

**入口 URL 换算**：`./admin/main.js` → `/plugin-admin/<pluginId>/main.js`。
该路径由宿主托管，且要求"已登录 + 插件已启用 + 路径限定在插件 `admin/` 目录内"。

---

## 5. `extensionPoints[]`（声明扩展点）

```json
{
  "extensionPoints": [
    {
      "name": "acme.notice.banner",
      "scope": "render",
      "replaceable": true,
      "description": "站点公告条",
      "props": [{ "name": "context", "description": "渲染上下文" }]
    }
  ]
}
```

| 字段 | 类型 / 约束 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | `^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)+$`，≤ 160 | ✅ | 扩展点名（**全局唯一**） |
| `scope` | `admin` \| `render` \| `server` | ✅ | 作用域 |
| `replaceable` | boolean | | 是否允许**第三方**整体替换（缺省 true） |
| `description` | ≤ 300 | | 说明 |
| `props` | 数组，≤ 20 项，每项 `{ name, description }` | | **声明会传给贡献组件的 props** |

> `replaceable: false` **只约束第三方**：提供方自己用 `replace` 提供默认实现不受限制。

---

## 6. `contributions[]`（向扩展点贡献）

```json
{
  "contributions": [
    {
      "point": "acme.notice.banner",
      "scope": "render",
      "mode": "append",
      "order": 10,
      "entry": "./dist/banner.js",
      "label": "公告条",
      "permission": "post.view"
    }
  ]
}
```

| 字段 | 类型 / 约束 | 必填 | 说明 |
| --- | --- | --- | --- |
| `point` | 同上命名规则 | ✅ | 目标扩展点 |
| `scope` | `admin` \| `render` \| `server` | ✅ | 必须与提供方声明一致 |
| `mode` | `append` \| `replace` | | 缺省 `append` |
| `order` | number | | 越大越优先（`replace` 取最大者） |
| `entry` | **admin**：`^\./admin/*.js`；**render/server**：`^\./dist/*.js` | ✅ | 贡献入口 |
| `style` | `^\./admin/*.css` | | 仅 `admin` 作用域 |
| `permission` | ≤ 80 | | 仅 `admin`；权限不足时前端不下发该贡献 |
| `label` | ≤ 80 | | 显示名 |

> 注意 `entry` 的路径前缀受**作用域**约束：后台界面必须是 `./admin/xxx.js`，
> 渲染/服务端贡献必须是 `./dist/xxx.js`。写错会在 `pnpm validate` 与启动期被拦住。

### `append` 与 `replace` 的裁决

- 存在 `replace` → **只有胜出者呈现**（`order` 最大；同分取 `consumerId` 字典序在前，并记警告）；
  默认内容与所有 `append` 都不呈现；
- 无 `replace` → 全部 `append`，按 `order` 降序。

详见 [[命名扩展点注册表|Development/Architecture/Extension-Registry]]。

---

## 7. `settingsSchema`

结构完全复用 `packages/shared/manifests/settings.schema.json`（与主题设置**共用同一份定义**）：

```json
{
  "settingsSchema": {
    "general": {
      "label": { "zh-CN": "常规", "en": "General" },
      "fields": {
        "enabled":   { "type": "boolean", "label": "启用公告", "default": true },
        "message":   { "type": "text",    "label": "公告文案", "default": "欢迎", "maxLength": 200 },
        "linkUrl":   { "type": "url",     "label": "跳转地址" },
        "tone":      { "type": "select",  "label": "色调", "default": "info",
                       "options": [{ "value": "info", "label": "信息" }, { "value": "warn", "label": "警示" }] }
      }
    }
  }
}
```

字段类型共 9 种：`text` / `textarea` / `color` / `boolean` / `number` / `select` / `image` / `url` / `stringList`。
逐类型约束、合并顺序与校验规则见 [[声明式设置表单|Development/Plugin-API/Settings]]。

---

## 8. 两个完整示例

### 最小合法

```json
{
  "schemaVersion": 1,
  "id": "acme.example",
  "name": "示例插件",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",
  "entry": "./dist/index.js"
}
```

### 完整功能（对照官方 `rice.posts` 的真实结构）

```json
{
  "schemaVersion": 1,
  "id": "rice.posts",
  "name": "文章",
  "version": "1.6.0",
  "apiVersion": "^1.0.0",
  "author": "RiceNote",
  "license": "MIT",
  "entry": "./dist/index.js",
  "requires": { "identity.users@1": "^1.0.0" },
  "provides": ["content.posts@1"],
  "capabilities": [
    "database:own", "services:provide", "services:consume",
    "routes:public", "routes:admin", "events:publish", "events:subscribe",
    "slots:register", "extensions:declare"
  ],
  "migrations": "./migrations",
  "admin": {
    "pages": [
      { "id": "posts.list", "label": "文章", "path": "/posts", "icon": "FileText",
        "order": 50, "permission": "post.view", "entry": "./admin/main.js" },
      { "id": "posts.editor", "label": "编辑文章", "path": "/posts/editor",
        "permission": "post.write", "entry": "./admin/editor.js", "hidden": true }
    ]
  },
  "extensionPoints": [
    { "name": "rice.posts.listActions", "scope": "admin", "replaceable": true,
      "description": "文章列表页的操作按钮区",
      "props": [{ "name": "postId", "description": "当前文章 ID" }] },
    { "name": "rice.posts.editorToolbar", "scope": "admin", "replaceable": true, "description": "编辑器工具栏" },
    { "name": "rice.posts.editorBody", "scope": "admin", "replaceable": true, "description": "编辑器正文区" }
  ],
  "settingsSchema": {
    "general": {
      "label": { "zh-CN": "常规", "en": "General" },
      "fields": {
        "pageSize":      { "type": "number", "label": "列表每页条数", "default": 10, "min": 1, "max": 50 },
        "excerptLength": { "type": "number", "label": "自动摘要长度", "default": 160, "min": 20, "max": 1000 }
      }
    }
  }
}
```

---

## 9. 校验与常见错误

```bash
pnpm validate      # 无需数据库，适合接入 CI
```

| 报错 | 原因 |
| --- | --- |
| `additionalProperties` | 写了 schema 未定义的字段（如 `main`、`dependsOn`、`scripts`） |
| `id` 不匹配 pattern | 只写了一段（`posts` 不合法，需要 `rice.posts` 这样的两段以上） |
| `entry` 不匹配 `^\./` | 写成了 `dist/index.js`（必须以 `./` 开头） |
| `contributions[].entry` 前缀不对 | `admin` 作用域用了 `./dist/...`，或反之 |
| 版本三者不一致 | `manifest.version`、`package.json.version`、官方目录推荐版本 必须一致（仅对进入官方目录的插件校验） |
| 扩展点名重复 | 扩展点名全局唯一，他人已声明则失败 |
| `replace` 同 `order` 冲突 | 运行时是警告，`pnpm validate` 判为错误 |

---

## 相关页面

- [[PluginContext 逐方法参考|Development/Plugin-API/Context-Reference]]
- [[声明式设置表单|Development/Plugin-API/Settings]]
- [[插件自带后台界面|Development/Plugin-API/Admin-UI]]
- [[插件生命周期与依赖解析|Development/Architecture/Plugin-Lifecycle]]
