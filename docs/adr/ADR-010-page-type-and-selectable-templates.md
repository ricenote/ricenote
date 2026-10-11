# ADR-010：新增 `page` 页面类型，并由主题声明「可供内容选择的页面模板」

- 状态：已接受
- 日期：2026-10-11

## 背景

v0.2.0 之前，内容只有"文章"一种形态：文章的 kind 固定为 `post`，模板由
`theme.json` 的 `templates.post` 唯一决定。这带来两个缺口：

1. **没有"独立页面"**：`/about`、`/contact`、隐私政策这类固定内容无处安放，
   硬塞进文章会污染分类/标签与首页列表；
2. **内容无法选择版式**：同一主题下，"标准文章页"和"落地页/窄栏阅读页"只能靠
   复制主题或写死判断实现。用户的需求正是"自定义页面可作为模板应用于独立的页面或者文章"。

同时，代码里其实**已经存在**一条未被使用的机制：
`PageRouteSpec.template` 与 `PageViewModel.template` 已经是渲染器的"显式模板优先"入参
（`packages/core/src/render/renderer.ts`），但没有生产者，也没有可选项清单。

## 决策

1. **新增页面类型 `page`**，由新插件 `rice.pages` 提供，地址为 `/page/:slug`；
   主题用 `templates.page` 提供默认模板，缺省时回退 `fallback.njk`。
2. **模板选择走渲染层，不改内容**：主题在 `theme.json` 新增 `pageTemplates`
   声明可选清单（键 → 模板文件 + 多语言 label / description）；
   页面与文章只保存**模板键**，渲染器按"显式模板 → kind 模板 → fallback"解析。
3. **服务端在保存时校验模板键必须在当前主题声明内**（`resolveContentTemplateKey()`），
   渲染期仍对失效键做**优雅回退**（换主题后旧键不报 500）。
4. **`template` 存键不存文件名**：主题可以自由重命名 `.njk` 文件而不让已有内容失效。
5. **不作为内容级复用**：明确不做"把某个页面的内容当作模板套用到其他内容"。
   内容级复用会引入区块解析、变量替换与内容继承，属于另一套模型（且与本仓
   "插件提供数据、主题决定展示"的边界冲突）。

## 理由

- 复用既有机制：`PageViewModel.template` 与回退链早已实现并经过测试，
  本次只是补齐"生产者"与"可选项来源"，没有引入新的渲染概念；
- 模板是**渲染关注点**，因此归属主题；内容只声明"我想要哪种版式"，
  这样同一个页面在不同主题下都能找到合理对应物（找不到就回退）；
- 保存时校验 + 渲染时回退的组合，既避免了"选了模板却没生效"的静默降级，
  又避免了"换主题导致内容全部报错"的脆弱性；
- 键而非文件名，使主题升级/重构文件结构不会破坏站点数据。

## 后果

**正面**

- 页面与文章共用一套版式清单，编辑者心智一致；
- 主题作者新增版式只需改 `theme.json` 与新增一个 `.njk` 文件，零构建、零插件改动；
- 两套官方主题均已提供"标准 / 落地页 / 窄栏阅读"三种版式与 `templates.page`。

**负面 / 约束**

- 主题必须为 `pageTemplates[*].template` 提供真实存在的文件，否则**主题校验不通过**
  （与 `templates` 同样的严格度，避免"声明了却渲染失败"）；
- 文章新增 `template` 列需要一次迁移（`posts/0003_post_template.sql`，可空列，历史数据行为不变）；
- 主题切换后旧模板键失效，此时表现为回退到 kind 模板（而不是报错），
  管理员需要在后台重新选择 —— 这是刻意选择的失败方向。

## 相关实现

- `packages/shared/manifests/theme.schema.json`：`pageTemplates` 声明
- `packages/shared/src/content-template.ts`：`resolveContentTemplateKey()`
- `packages/core/src/themes/manager.ts`：`pageTemplateDescriptors()` / `resolvePageTemplate()`
- `packages/core/src/render/renderer.ts`：`resolveTemplate()` 回退链
- `plugins/official/pages/`：`rice.pages`（含 `rn_pages`、`/page/:slug`、导航插槽）
- `plugins/official/posts/migrations/0003_post_template.sql`：文章模板列
- `docs/plugin-api/v1.md` §14、`docs/theme-api/v1.md` §12
