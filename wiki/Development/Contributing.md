# 维护与发布指南

本页说明**这套 wiki 怎么维护**（页面在哪、链接怎么写、怎么发布），以及一份开发者命令速查。

---

## 1. 内容源在哪

本 wiki 的**唯一事实来源是仓库的 `wiki/` 目录**：

```
wiki/                        ← 内容源（Git 仓库的一部分，可 review）
├── Home.md                  ← 首页（固定名字，必须有）
├── _Sidebar.md              ← 全局侧栏（特殊页面，不出现在页面列表）
├── _Footer.md               ← 全局页脚（同上）
├── Getting-Started.md
├── Installation.md
├── ...
├── Plugins/
│   ├── Overview.md
│   └── Install-and-Update.md
└── Development/
    ├── Index.md
    ├── Architecture/*.md
    ├── Plugin-API/*.md
    └── Theme-API/*.md
```

发布时把 `wiki/` 的内容**镜像**同步到 GitHub Wiki 仓库（`ricenote.wiki.git`）。
**不要在 GitHub 网页上直接编辑 wiki 页面** —— 那样改动会与 `wiki/` 冲突，
并且下次发布会被覆盖（镜像同步会把源目录里没有的文件删除）。

---

## 2. 页面命名与结构

| 规则 | 说明 |
| --- | --- |
| 文件名即页面名 | `Getting-Started.md` → 页面 `Getting-Started` |
| 子页面用目录表达 | `Development/Plugin-API/Tutorial.md` → 页面 `Development/Plugin-API/Tutorial` |
| 首页 | 必须是 `Home.md` |
| 侧栏 / 页脚 | `_Sidebar.md` / `_Footer.md`（带下划线，是特殊页面） |
| 命名风格 | 大写单词 + 连字符（`Getting-Started`）、目录名首字母大写（`Plugin-API`） |
| 语言 | 简体中文正文；技术名词保留英文 |

**新增页面时记得两件事**：

1. 创建 `.md` 文件；
2. 在 `_Sidebar.md` 的相应分组里加一行链接（否则读者找不到）。

---

## 3. 链接约定（重要）

### 3.1 页面之间：用 wiki 语法 + **完整页面名**

```markdown
[[完整教程|Development/Plugin-API/Tutorial]]
[[常见问题|FAQ]]
```

- 格式是 `[[页面名|显示文本]]` 或 `[[页面名]]`；
- **页面名一律写完整路径**（从 wiki 根算起），不要依赖相对链接 ——
  相对链接在不同层级的页面上会解析到不同目标，很难排查；
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
| `--check` | 仅校验源目录（必须有 `Home.md`、不得有仓库相对链接），**不联网** |
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
| `--check` 报错：仓库相对链接 | 改成绝对 URL（见第 3 节） |
| 推送成功但页面没更新 | GitHub 有短暂缓存，刷新即可；确认推的是探测到的分支 |
| 想要"某页面下线" | 从 `wiki/` 删除该文件，下次发布会同步删除 |

---

## 6. 开发者命令速查

| 命令 | 用途 |
| --- | --- |
| `pnpm install` | 安装依赖（可复现） |
| `pnpm build` | 编译 Core / SDK / 官方插件 / 服务端 / 管理后台 |
| `pnpm build:all` | 全量构建（含全部工作区包） |
| `pnpm typecheck` | 全量类型检查 |
| `pnpm test` | 单元与集成测试 |
| `pnpm validate` | 校验插件 / 主题清单（**无需数据库**，适合 CI） |
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

## 7. 文档与代码的同步

改了代码就要检查这些文档：

| 你改了什么 | 需要同步 |
| --- | --- |
| manifest schema | [[manifest 参考\|Development/Plugin-API/Manifest-Reference]] + `pnpm validate` |
| 插件 API / SDK | [[Context 参考\|Development/Plugin-API/Context-Reference]]、[[后台界面\|Development/Plugin-API/Admin-UI]] |
| 主题 API / helper | [[模板参考\|Development/Theme-API/Template-Reference]] |
| 扩展点 / 权限点 / 事件 | [[扩展点清单\|Development/Hooks-Inventory]] |
| CLI 或环境变量 | [[命令行参考\|CLI-Reference]]、[[环境变量参考\|Configuration]] |
| 架构决策 | 新增 ADR + [[ADR 索引\|Development/ADR]] |
| 可见行为变更 | 根目录 `CHANGELOG.md`（遵循 Keep a Changelog 1.1.0） |

**运行时自省接口**可以帮你判断清单是否过期：`GET /api/admin/capabilities`
会列出实际注册的路由、服务契约、插槽与事件订阅。

---

## 相关页面

- [[入门路线与导航|Development/Index]]
- [[扩展点全量清单|Development/Hooks-Inventory]]
- [[命令行参考|CLI-Reference]]
- [文档平台使用说明（GitHub 官方）](https://docs.github.com/zh/communities/documenting-your-project-with-wikis)
