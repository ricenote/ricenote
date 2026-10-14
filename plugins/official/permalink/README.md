# rice.permalink —— 固定链接

为站点选择更友好的**访问地址形式**：文章、独立页面、分类三类内容各有一套「路径模板」，
在后台「固定链接」页里配置，保存后重启生效。第三方插件可以为自己内容类型接入同一套方案。

> 为什么单独做一个插件：地址形式是"站点整体风格"的选择，而不是内容本身；
> 它同时影响文章、页面、分类、导航、订阅源与站点地图。把它收进一个统一入口，
> 才能保证"改一次地址，全站一起改"，也才能在插件未启用时保持现状完全不变。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.permalink` |
| version | `1.0.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `permalink.routes@1` |
| requires | 无（内容插件是**可选**依赖：未启用时对应方案自动跳过） |
| capabilities | `database:own`、`routes:public`、`routes:admin`、`services:provide`、`services:consume`、`extensions:declare` |
| migrations | `./migrations`（`0001_permalink.sql`） |
| 数据表 | `rn_permalink_settings` |
| 权限点 | `permalink.view`（查看）、`permalink.manage`（修改） |

## 内置方案与参数

| 方案 id | 展示名 | 接管的前台路由 | 默认模板 | 可用参数 |
| --- | --- | --- | --- | --- |
| `post` | 文章路径 | `post.show` | `/post/{slug}` | `{cid}` 日志 ID、`{slug}` 日志缩略名、`{category}` 分类、`{year}` 年、`{month}` 月、`{day}` 日 |
| `page` | 独立页面路径 | `page.show` | `/page/{slug}` | `{cid}` 页面 ID、`{slug}` 页面缩略名 |
| `category` | 分类路径 | `term.category` | `/category/{slug}` | `{mid}` 分类 ID、`{slug}` 分类缩略名 |

默认模板刻意与"插件未启用时"的现状完全一致（`/post/{slug}`、`/page/{slug}`、`/category/{slug}`）：
**装了但没改设置，站点地址不会发生任何变化**。

后台为文章方案内置了可直接选用的预设风格（内核默认 / 默认风格 `/archives/{cid}/` /
WordPress 风格 `/archives/{slug}.html` / 按日期归档 `/{year}/{month}/{day}/{slug}.html` /
按分类归档 `/{category}/{slug}.html`）；页面与分类方案各有两个预设。任何方案都可以改为
「个性化定义」。

参数约束（保存时校验，非法写法一律拒绝并说明原因）：

- 必须以 `/` 开头；不能包含空格、查询串（`?`）与锚点（`#`）；不能出现连续的 `//`；
- 至少包含一个参数；不能重复使用同一个参数；同一段路径中最多出现一个参数；
- 只允许该方案声明的参数（含第三方通过扩展点追加的参数）。

关于 `{category}` 的兜底：文章**没有选择分类**时，该片段使用 `uncategorized` 占位，
这样地址形状在不同文章之间保持一致。含 `{category}` 的方案要求每篇文章至少属于一个分类
（否则未分类文章会集中到同一个占位段下）。

## 扩展点（Hook）

本插件声明两个 **server 作用域**扩展点，供第三方插件接入。两者的贡献入口都必须放在
`./dist/` 下并导出 `{ apply }`（清单式写法见 `docs/plugin-api/v1.md` 第 18 节）。

### `rice.permalink.schemes` —— 新增一整套路径方案

贡献方收到 `{ schemes }`（已含内置三类），追加自己的方案后原样返回。方案结构：

```ts
{
  id: 'product',                       // 全局唯一，小写字母开头
  label: '商品路径',                    // 后台展示名
  routeName: 'shop.product',           // 要接管的前台路由名（必须已注册且声明 overridable）
  tokens: [
    { name: 'sku', label: '商品编码', description: '例如 rn-0001' }
  ],
  defaultTemplate: '/product/{sku}',
  presets: [ { label: '按分类', template: '/product/{category}/{sku}' } ],  // 可省略
  sample: { sku: 'rn-0001' }           // 后台实时预览用的示例取值
}
```

接入后自动获得：后台「固定链接」页对应的一个区块、模板校验与实时预览、路径接管、
以及 `permalink.routes@1` 的地址生成与命中校验 —— 贡献方**不需要**自己实现任何一项。

前提是 `routeName` 指向的路由必须：

1. 由贡献方（或其它内容插件）通过 `ctx.routes.page()` 注册；
2. 声明 `overridable: true`（否则会被拒绝接管，并记录告警）。

### `rice.permalink.tokens` —— 为已有方案追加参数

贡献方收到 `{ tokens }`（已接受的第三方参数），追加自己的参数后原样返回：

```ts
{
  token: 'lang',                       // 参数名，不得与任何方案自带参数重名
  label: '语言',
  schemes: ['post', 'page'],           // 适用方案；省略表示全部
  source: 'rice.multilang',            // 可选，后台据此标注来源
  resolve({ scheme, values }) {         // 取值来源：必须同步、确定性
    return currentLanguage();
  },
  match({ value }) { return isKnownLanguage(value); }   // 命中校验，可省略
}
```

三条硬约束：

- **`resolve` 必须同步返回非空字符串**。地址生成也会在订阅源、站点地图等**没有请求上下文**
  的路径上被调用；需要异步或重查询的数据请由贡献方自行缓存；
- `resolve` 返回 `undefined` 或抛错时，提供方记一次告警并**回退到该方案的默认模板**生成地址
  （绝不产出坏链接），因此该方案的地址形状会在这种时刻变化；
- `match` 返回 `false` 时，该地址判 404 —— 用于避免同一内容出现多个可访问地址。

## 管理 API

| 方法 | 路径 | 权限点 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/permalink/settings` | `permalink.view` | 全部方案（含第三方贡献）：当前模板、默认模板、预设、参数、示例取值、是否已自定义 |
| PUT | `/api/admin/permalink/settings` | `permalink.manage` | 保存模板补丁 `{ templates: { <方案 id>: <模板> } }`；校验失败返回 400 与逐条原因；成功后标记「需重启生效」 |
| POST | `/api/admin/permalink/preview` | `permalink.view` | `{ schemeId, template }` → `{ valid, issues, path }`，纯计算、不落库 |

保存空串表示"回到该方案的默认模板"（删除该行），因此把某方案改回默认不会留下脏数据。

## 服务契约（提供）

`permalink.routes@1`（同步、无 IO，可被热路径直接调用）：

```ts
schemes()                                  // 全部生效方案（内置 + 第三方贡献）
template(schemeId)                         // 某方案生效的模板；未知方案返回 undefined
tokens(schemeId)                           // 某方案可用参数（含第三方追加），带中文标签
uses(schemeId, token)                      // 生效模板是否用到了该参数
extract(schemeId, params)                  // 路由参数 → 取值；字面量不符或命中校验失败返回 undefined（判 404）
build(schemeId, values, { request? })      // 取值 → 地址；缺参或第三方参数取不到值时返回 undefined
```

消费方一律用 `ctx.services.tryUse()` **可选**获取：插件未启用时返回 `undefined`，
内容插件回退到自己的内建默认路径，因此"装了才改变行为"。

`build()` 返回 `undefined` 时**不要**抛错给访客，按内建默认路径生成即可 —— 这是
"插件异常不打断前台"的约定。

## 数据流与生效方式

```
后台页 → PUT /api/admin/permalink/settings → 校验 → 写 rn_permalink_settings → 标记「需重启」
      → 站长重启 → 插件启动末段读取设置、收集扩展点贡献、编译模板
      → ctx.routes.overridePath() 替换三条路由的路径 → 前台按新地址注册
```

- **为什么必须重启**：前台路由在启动期装配，`overridePath` 在 `kernel.router.pages()`
  被 HTTP 装配读取之前（`core.runtime.started.v1` 之后）登记，因此只能在启动过程中完成；
- **为什么在"全部插件启动完成后"才做**：那时第三方贡献才收集得到，且它们要接管的路由
  也才都已注册（`overridePath` 要求目标路由存在且声明可接管，否则明确报错并跳过该方案）；
- **只接管路径**：三条路由的 handler 与内容解析仍在 `posts` / `pages` 中，
  本插件只把地址形式换成编译结果，因此"命中哪篇文章"这件事仍由内容插件负责。

## 后台界面（插件自带）

| 项 | 值 |
| --- | --- |
| 入口 | `admin/main.js`（`defineAdminPage` 导出页面组件） |
| 托管 URL | `/plugin-admin/rice.permalink/main.js`（需登录；插件启用时才可取） |
| 菜单声明 | `manifest.json` → `admin.pages[]`：id `permalink.settings`、路径 `/permalink`、图标 `Link`、权限 `permalink.view` |
| 依赖 | 仅 `/admin-sdk/v1/ricenote-admin.js` |

页面按接口返回的方案列表**动态渲染**：每个方案一个区块（预设单选 + 个性化输入 +
参数标签 + 实时预览），第三方贡献的方案自动出现，无需改前端代码。无 `permalink.manage`
权限时整页只读。

## 数据表

`rn_permalink_settings`（表所有权归本插件）：

| 列 | 说明 |
| --- | --- |
| `site_id` + `scheme_id` | 主键；**按方案存**，第三方方案与本插件内置方案共用同一张表，新增方案不需要迁移 |
| `template` | 人可读的路径模板原文（编译结果不入库，启动时统一编译） |
| `updated_by` / `updated_at` | 最后修改者与时间 |

## 依赖与启停

- 无插件级硬依赖。`posts` / `pages` / `taxonomy` 未启用时，对应方案在装配阶段被跳过并记录
  告警，其它方案照常生效；
- 禁用本插件后：路径替换、`permalink.routes@1`、管理 API 与后台菜单全部注销，
  前台地址立即恢复为各内容插件的内建默认（`/post/:slug` 等），数据保留在库中；
- 重新启用后按库中的模板恢复；
- 第三方方案依赖的插件被禁用时，其方案自动消失，本插件不受影响。

## 安全要点

- 模板只接受"字面量 + 允许的参数"，其余写法（查询串、锚点、空白、连续斜杠、未声明参数、
  重复参数）在保存与装配两处都会被拒绝；库里的失效模板回退到默认模板并告警；
- 路径冲突在装配期显式拦截：与其它页面路由同结构、或试图接管未声明 `overridable` 的路由，
  都会明确报错，绝不静默生效一半；
- 写入权限为 `permalink.manage`，读取为 `permalink.view`，所有写操作经 Core 守卫的
  认证 → CSRF → 权限 → 审计链路；
- 不被识别的第三方方案 / 参数只告警并跳过（`onError: 'skip'`），一个坏贡献不会拖垮整站。
