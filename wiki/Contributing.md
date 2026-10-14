# 维护与发布指南

本页说明**这套 wiki 怎么维护**（页面在哪、链接怎么写、怎么发布），以及一份开发者命令速查。

---

## 1. 内容源在哪

本 wiki 的**唯一事实来源是仓库的 `wiki/` 目录**：

```
wiki/                                    ← 内容源（Git 仓库的一部分，可 review）
├── Home.md                              ← 首页（固定名字，必须有）
├── _Sidebar.md                          ← 全局侧栏（特殊页面，不出现在页面列表）
├── _Footer.md                           ← 全局页脚（同上）
│
├── Getting-Started.md                   ← 开始使用
├── Installation.md
├── Configuration.md
├── Deployment.md                        ← 部署与运维
├── Upgrading.md
├── Admin-Guide.md
├── CLI-Reference.md
├── Themes.md
├── FAQ.md
├── Troubleshooting.md
│
├── Plugins-Overview.md                  ← 插件
├── Plugins-Install-and-Update.md
│
├── Development.md                       ← 开发者文档入口
├── Architecture-Overview.md             ← 内核机制（共 7 页）
├── Architecture-Core-Bootstrap.md
├── Architecture-Plugin-Lifecycle.md
├── Architecture-Render-Pipeline.md
├── Architecture-Data-and-Migrations.md
├── Architecture-Security.md
├── Architecture-Extension-Registry.md
├── Plugin-API-Getting-Started.md        ← 插件开发（共 8 页）
├── Plugin-API-Manifest-Reference.md
├── Plugin-API-Context-Reference.md
├── Plugin-API-Service-Contracts.md
├── Plugin-API-Admin-UI.md
├── Plugin-API-Permissions.md
├── Plugin-API-Settings.md
├── Plugin-API-Tutorial.md
├── Theme-API-Overview.md                ← 主题开发（共 4 页）
├── Theme-API-Template-Reference.md
├── Theme-API-Settings.md
├── Theme-API-Slots.md
│
├── Hooks-Inventory.md                   ← 清单与索引
├── ADR.md
└── Contributing.md
```

发布时把 `wiki/` 的内容**镜像**同步到 GitHub Wiki 仓库（`ricenote.wiki.git`）。
**不要在 GitHub 网页上直接编辑 wiki 页面** —— 那样改动会与 `wiki/` 冲突，
并且下次发布会被覆盖（镜像同步会把源目录里没有的文件删除）。

---

## 2. 页面命名与结构

**目录是平铺的，分组靠「文件名前缀 + 侧栏」表达** —— 这不是审美选择，而是平台的硬限制。

| 规则 | 说明 |
| --- | --- |
| 文件名即页面名 | `Getting-Started.md` → 页面 `Getting-Started`（URL `wiki/Getting-Started`） |
| **不要用目录** | GitHub Wiki **不支持目录分组**：文件放进子目录后，GitHub 会**丢掉目录、只取文件名当标题**。同名文件随即互相覆盖 —— 我们真实踩过：三个 `Overview.md`、两个 `Settings.md` 争同一个 `wiki/Overview` / `wiki/Settings` 地址，绝大多数页面因此打不开 |
| 分组编进文件名 | 用连字符代替 `/`：`Plugin-API-Tutorial.md`、`Architecture-Core-Bootstrap.md` |
| 标题全局唯一 | `Overview.md` 与 `Plugin-API-Overview.md` 是两个页面；但两个 `Overview.md` 只能活一个 |
| 连字符显示为空格 | 标题栏里 `Plugins-Install-and-Update` 会显示为 `Plugins Install and Update`（侧栏用自定义显示文本，不受影响） |
| 首页 | 必须是 `Home.md` |
| 侧栏 / 页脚 | `_Sidebar.md` / `_Footer.md`（带下划线，是特殊页面） |
| 语言 | 简体中文正文；技术名词保留英文 |

**新增页面时记得两件事**：

1. 创建 `.md` 文件；
2. 在 `_Sidebar.md` 的相应分组里加一行链接（否则读者找不到）。

---

## 3. 链接约定（重要）

### 3.1 页面之间：用 wiki 语法

```markdown
[[完整教程|Plugin-API-Tutorial]]
[[常见问题|FAQ]]
```

- 格式是 `[[显示文本|页面名]]` 或 `[[页面名]]`（**显示文本在前**）；
- **页面名就是文件名去掉 `.md`**（如 `Plugin-API-Tutorial`），不要带任何路径；
- 页面名写错会被 `pnpm wiki:check` 直接指出（指向不存在的页面即报错），不会静默变成红链；
- 在**表格里**写内部链接时，`|` 需要转义为 `\|`：

```markdown
| 页面 | 说明 |
| --- | --- |
| [[常见问题\|FAQ]] | 真实踩过的坑 |
```

### 3.2 指向仓库文件：必须用**绝对 URL**

Wiki 是**独立仓库**，`docs/xxx.md`、`../raw/main/x.png` 这类相对路径**一定失效**。

```markdown
❌  ../docs/architecture/overview.md          （上跳相对路径）
❌  docs/architecture/overview.md             （仓库内相对路径）

✅  https://github.com/ricenote/ricenote/blob/main/docs/architecture/overview.md
```

> 发布脚本会把**仓库相对链接**（`](../`、`](docs/`、`](./`）判为错误并拒绝发布，
> 因此这类写法不会溜进线上。

### 3.3 图片

不要往 wiki 仓库里拷二进制。引用仓库里的图片用 raw URL：

```markdown
![登录界面](https://raw.githubusercontent.com/ricenote/ricenote/main/01-login.png)
```

`pnpm wiki:check` 会把**仓库相对链接**（`](../`、`](docs/`、`](./`）判为**错误**并拒绝通过。

### 3.4 外部链接

普通的 `[文本](https://...)` 即可。指向 Issue、Release 等也用绝对地址。

---

## 4. 写作约定

| 约定 | 说明 |
| --- | --- |
| 标题层级 | 每页用 `# 一级标题` 开头；正文用 `##` / `###`，**不要**出现多个 `#` 标题 |
| 表格 | 优先用表格罗列"字段/参数/命令/权限"这类结构化信息 |
| 代码块 | 标注语言（`bash` / `json` / `ts` / `njk` / `sql` / `js`） |
| 注意事项 | 用 `> ⚠️` / `> 注意` 引用块标出坑与边界 |
| 页尾 | 统一加「相关页面」小节，链接 3–5 个相邻页 |
| 事实 | **只写代码里真实存在的行为**；不确定就写"未确认"，不要臆造 |
| 与 docs/ 的关系 | wiki 自成体系；深水区细节用绝对链接指回 `docs/`，**不复制正文** |

> 本项目有一条重要的文档原则：**已知的实现与文档不一致处，要在正文里如实标注**，
> 而不是照抄旧的说明。现有几处已记录在 [[常见问题|FAQ]]。

---

## 5. 发布到 GitHub Wiki

### 5.1 前置条件（只需做一次）

GitHub Wiki 需要**先在网页端启用**，否则推送会失败：

1. 打开 <https://github.com/ricenote/ricenote/settings>；
2. 在 **Features** 区域勾选 **Wikis**；
3. 打开 <https://github.com/ricenote/ricenote/wiki>，**创建第一个页面**（内容随意，发布时会被覆盖）。

完成这三步后，`ricenote.wiki.git` 仓库才存在并可推送。

> 推送使用你本机的 git 凭据（凭据助手 / SSH / token 化的远端地址）。
> 脚本本身**不接触也不打印令牌**；打印远端地址时会把凭据段掩码为 `***`。

### 5.2 命令

```bash
pnpm wiki:check        # 只校验，不联网：必须有 Home.md，且不得出现仓库相对链接
pnpm wiki:publish      # 同步 wiki/ 到 GitHub Wiki
```

发布脚本（`scripts/publish-wiki.mjs`）的行为：

```
读取 wiki/ 源目录
  → clone ricenote.wiki.git 到系统临时目录
  → 镜像同步：保留 .git，以 wiki/ 为准增删文件（因此「删页面」也生效）
  → 若无变化 → 打印「没有变化，跳过推送」并退出 0
  → git add -A + commit
  → push 到探测到的分支
```

参数：

| 参数 | 说明 |
| --- | --- |
| `--dry-run` | 只同步到临时目录并打印将新增 / 修改 / 删除的页面，不提交、不推送 |
| `--check` | 仅校验源目录（必须有 `Home.md`、文件名不得含目录、标题唯一、内部链接目标存在、不得有仓库相对链接），**不联网** |
| `--message=<文本>` | 自定义提交信息 |
| `--remote=<url>` | 覆盖远端地址（默认由 `origin` 派生为 `ricenote.wiki.git`） |

退出码：`0` 成功（含"无变化"）；非 0 表示校验失败或推送失败。

### 5.3 首次发布建议

```bash
pnpm wiki:check                 # 先本地自查
pnpm wiki:publish --dry-run     # 看会新增哪些页面（不推送）
pnpm wiki:publish               # 正式推送
```

### 5.4 常见失败

| 现象 | 原因与处理 |
| --- | --- |
| clone 失败 / 仓库不存在 | Wiki 未启用或未创建首个页面 → 见 [5.1](#51-前置条件只需做一次) |
| push 被拒（认证失败） | 本机 git 凭据问题。确认 `git push` 对该仓库可用，或配置凭据助手 |
| `--check` 报错：缺少 Home.md | 源目录必须有 `Home.md` |
| `--check` 报错：位于子目录 | GitHub Wiki 不支持目录分组，改用 `Plugin-API-Tutorial.md` 这类扁平文件名（见第 2 节） |
| `--check` 报错：标题冲突 | 两个文件的标题规范化后相同（如 `Foo-Bar.md` 与 `Foo Bar.md`），改名使其唯一 |
| `--check` 报错：内部链接指向不存在的页面 | 检查 `[[显示文本\|页面名]]` 里的页面名拼写与大小写 |
| `--check` 报错：仓库相对链接 | 改成绝对 URL（见第 3 节） |
| 推送成功但页面没更新 | GitHub 有短暂缓存，刷新即可；确认推的是探测到的分支 |
| 想要"某页面下线" | 从 `wiki/` 删除该文件，下次发布会同步删除 |

---

## 6. 版本号怎么维护

**唯一手写处是 `packages/shared/manifests/plugin-catalog.json`**：它的 `appVersion` 是应用版本，
`plugins[].version` 是各插件版本（插件保持**相互独立**的语义化版本）。其余 20 多处版本号都是**派生的**：

- 根 `package.json`、`packages/core/src/version.ts` 的 `APP_VERSION`（运行时版本，会写进 `rn_site_state`）；
- 四个 SDK 包与四个私有工作区包（`packages/core`、`apps/server`、`apps/admin`、`tests`）的 `package.json`；
- 13 个官方插件的 `manifest.json`、`package.json` 与 `README.md` 的版本行；
- 插件的**宿主区间**（跟随宿主的次版本：宿主为 `A.B.z` 时写 `^A.B.0`）；
- `wiki/Home.md`、`wiki/_Footer.md` 与「官方插件一览」的版本列。

规则集中在 `scripts/lib/version-plan.mjs`（全仓唯一实现，无构建、零依赖，被 CLI 与发布脚本共用）。

| 命令 | 用途 |
| --- | --- |
| `pnpm version:check` | 只读校验全部派生处；不一致时退出码 1，并点名「文件 + 期望值 + 实际值」 |
| `pnpm version:sync` | 按单一来源写回全部派生处（幂等，可反复跑） |
| `pnpm version:bump patch\|minor\|major` | 递增应用版本：改来源 → 写回派生处 → 收口 `CHANGELOG.md` → `install` / `build` / `validate` |

用法要点：

- **一次补丁升级**：先在 `CHANGELOG.md` 的 `[Unreleased]` 段写好条目 → `pnpm version:bump patch`
  → 在生成的 `## [x.y.z] - 日期` 段下补齐说明（脚本不代写变更正文）。
  `--plugin=<id>:<level>` 可同时单独递增某个插件，`--all-plugins=<level>` 递增全部插件，`--dry-run` 只预览。
- **不要手改派生处**：`version:check` 已串进 `pnpm build`、`pnpm validate`、`pnpm wiki:check` / `wiki:publish`
  与 `pnpm release:plugins`，漏改会在这些入口直接失败（并有单测兜底）。
- **主题版本不在此列**：`themes/*/theme.json` 的 `version` 是静态资源指纹，改资源时要手动提升（见 [[主题与外观|Themes]]）。
- 第三方示例插件（`plugins/third-party/*`）不参与官方发布，`version:check` 只在它与自身 manifest 不一致时给出提示。

---

## 7. 开发者命令速查

| 命令 | 用途 |
| --- | --- |
| `pnpm install` | 安装依赖（可复现） |
| `pnpm build` | 编译 Core / SDK / 官方插件 / 服务端 / 管理后台 |
| `pnpm build:all` | 全量构建（含全部工作区包） |
| `pnpm typecheck` | 全量类型检查 |
| `pnpm test` | 单元与集成测试 |
| `pnpm validate` | 校验版本号一致性 + 插件 / 主题清单（**无需数据库**，适合 CI） |
| `pnpm version:check` / `version:sync` / `version:bump` | 版本号校验 / 写回 / 递增（见上一节） |
| `pnpm migrate` | 执行 Core 与插件迁移 |
| `pnpm dev` / `pnpm dev:admin` | 服务端开发模式 / 后台前端热更新 |
| `pnpm start` | 启动服务端 |
| `pnpm run setup` | 安装向导（注意必须是 `run setup`） |
| `pnpm plugin <...>` | 插件列表 / 安装 / 更新 / 卸载 / 任务日志 / 启停 |
| `pnpm theme <...>` | 主题列表 / 激活 / 查看设置 |
| `pnpm release:plugins` | 先校验后发布官方插件与 SDK 包 |
| `pnpm repos:plugins` | 把单调仓库中的插件拆分为独立仓库 |
| `pnpm wiki:check` / `pnpm wiki:publish` | 校验 / 发布本文档 |

更完整的参数说明见 [[命令行参考|CLI-Reference]]。

### 提交前的推荐动作

```bash
pnpm typecheck && pnpm validate && pnpm test
pnpm wiki:check          # 如果改动了 wiki/
```

---

## 8. 文档与代码的同步

改了代码就要检查这些文档：

| 你改了什么 | 需要同步 |
| --- | --- |
| manifest schema | [[manifest 参考\|Plugin-API-Manifest-Reference]] + `pnpm validate` |
| 插件 API / SDK | [[Context 参考\|Plugin-API-Context-Reference]]、[[后台界面\|Plugin-API-Admin-UI]] |
| 主题 API / helper | [[模板参考\|Theme-API-Template-Reference]] |
| 扩展点 / 权限点 / 事件 | [[扩展点清单\|Hooks-Inventory]] |
| CLI 或环境变量 | [[命令行参考\|CLI-Reference]]、[[环境变量参考\|Configuration]] |
| 架构决策 | 新增 ADR + [[ADR 索引\|ADR]] |
| 可见行为变更 | 根目录 `CHANGELOG.md`（遵循 Keep a Changelog 1.1.0） |

**运行时自省接口**可以帮你判断清单是否过期：`GET /api/admin/capabilities`
会列出实际注册的路由、服务契约、插槽与事件订阅。

---

## 相关页面

- [[入门路线与导航|Development]]
- [[扩展点全量清单|Hooks-Inventory]]
- [[命令行参考|CLI-Reference]]
- [文档平台使用说明（GitHub 官方）](https://docs.github.com/zh/communities/documenting-your-project-with-wikis)
