# ADR-016：官方插件 npm 分发、推荐清单与安装向导

- 状态：已接受
- 日期：2026-10-12
- 修订：[ADR-007](ADR-007-plugin-package-install.md)（插件包来源与白名单）、
  [ADR-014](ADR-014-plugin-owned-admin-ui.md)（扩展中心的目录区块）

## 背景

在此之前，"装一套 RiceNote"是这样的：

```bash
git clone … && pnpm install
cp .env.example .env      # 手改数据库连接与 SESSION_SECRET
pnpm build && pnpm migrate
pnpm start                # 靠 RICENOTE_SEED_PLUGINS 启用 11 个官方插件
```

它把三件事绑死了，而每件都站不住：

1. **官方插件随仓库分发**：`plugins/official` 下的 11 个插件是"内置"的 ——
   不可卸载、没有版本概念、升级只能 `git pull`；而 ADR-015 已经让安装器
   支持 npm / Git / 本地三路来源，官方插件却用不到自己修的这条高速路。
2. **装什么由仓库决定**：想只跑一个纯博客（不要评论、不要搜索）也得把整仓拉下来；
   `RICENOTE_SEED_PLUGINS` 只能"启用"，不能"选择安装"。
3. **初始化是一串易错的手工步骤**：必须手工 `CREATE DATABASE`、手工生成
   `SESSION_SECRET`、手工确认迁移顺序 —— 每一步都能让人卡住，且没有一处给出"下一步该做什么"。

## 决策

### 1. 官方插件作为独立 npm 包发布（`@ricenote/plugin-*`）

11 个插件各自一个包，仓库内仍以 workspace 开发（零构建热调试不变），
发布由 `pnpm publish` 完成 —— 它会负责把 `workspace:` 协议改写成实际版本区间。

发布形态的四项硬要求（`pnpm validate` 与 `scripts/release-plugins.mjs` 都会拦）：

| 要求 | 原因 |
| --- | --- |
| 去掉 `private` + `publishConfig.access = public` | 作用域包必须显式声明公开，否则根本发不出去 |
| `files` 含 `dist` 与 `manifest.json` | 前者是入口，后者是安装器识别插件的依据 —— 少任何一个都会装出一个坏包 |
| `manifest.version === package.json.version === 目录推荐版本` | 三处不一致 = 装出来的东西与清单对不上，而 npm 上的版本**收不回** |
| `@ricenote/plugin-sdk` / `@ricenote/shared` 只写 `peerDependencies`（+ `optional`） | 见决策 3 |

### 2. 推荐插件清单是"装哪个版本"的唯一事实来源

新增 `packages/shared/manifests/plugin-catalog.json`（+ Schema + `getPluginCatalog()`），
随 `@ricenote/shared` 一起进发布产物。每条记录：`id / npm / version / category /
label / description / capabilities / requires / repository / license`。

- `category`：`required`（不可取消勾选）/ `recommended`（默认勾选）/ `optional` / `example`；
- **`required` 只有两项，且是代码事实而非偏好**：缺 `rice.identity` 没有 `/api/admin/session`
  （进不去后台），缺 `rice.authorization` 安全网关的鉴权全部拒绝（进去了也没权限）。
  因此向导里这两项**锁定勾选**，`--plugins=posts` 也会被强制并入（见关键决策 4）。

**推荐版本 vs 最新版本**是两层语义，界面与文档都要显式区分：
清单里的版本是"随主程序测试通过的组合"，registry 的 dist-tags 是"最新"。
后台的"可更新"以**推荐版本**为基线，避免"提示可更新到 2.0 却装不上兼容版本"。

### 3. 宿主提供的包不能进插件目录

`@ricenote/plugin-sdk` 与 `@ricenote/shared` 由宿主从项目根 `node_modules` 解析
（plugin-api §11）。若发布包把它们写成普通 `dependencies`，安装时会在插件目录内
生成**第二份实例** —— 与 ADR-014 记录的"两份 Vue → 页面空白且控制台干净"同类事故。

三道防线：

1. 插件声明为 `peerDependencies` + `peerDependenciesMeta.optional = true`
   （语义正确：宿主必须提供，插件不该自带；标记 optional 还能阻止包管理器自动安装）；
2. 安装编排在 `prepare` 阶段**拒绝**把宿主包写成普通依赖的包，并说明怎么改；
3. `pnpm validate` 与发布脚本在提交/发布前就拦住。

另外 `prepare` 新增一条判据：**没有 `src/` 也没有 `tsconfig.json` 的包视为"只含产物"**，
跳过依赖安装与构建 —— 从 npm 装的官方插件正是这种形态（源码在独立仓库里），
不加这条会去联网装一堆用不上的 devDependencies，再因为缺 `src/` 而失败。

### 4. `ricenote setup`：一条命令完成初始化

```
环境检查 → 数据库（自动建库）→ 站点与管理员 → 写 .env → Core 迁移
   → 勾选插件 → 从 npm 串行安装 → 写 RICENOTE_PLUGINS → 首次 bootstrap → 结果摘要
```

几个刻意的取舍：

- **先写 `.env` 再 `loadConfig`**：省掉"把内存值注入配置"的一套机制，
  顺带保证用户接下来直接 `pnpm start` 就能跑；
- **自动建库**：用不带 database 的连接执行 `CREATE DATABASE IF NOT EXISTS`
  （库名先做标识符白名单校验再反引号包裹，DDL 不支持参数占位）；
- **交互用 `node:readline/promises`（零新依赖）**，无 TTY 自动降级：
  `--yes` 取推荐档、显式参数优先、缺失必需输入时抛出"请传 --xxx"的可操作提示；
- **可重入**：已有 `.env` 作为默认值沿用、已装插件跳过、`--from-manifest` 补齐缺件；
- **不做半成品**：Core 迁移在安装之前（否则 `rn_plugins` 还不存在）；必需插件安装失败即非零退出。

**安装后必须显式 `enabled = 1`**（这是一次真实事故换来的）：`RICENOTE_SEED_PLUGINS`
只在插件**首次被发现**（数据库无记录）时生效，而安装器已经先写了 `enabled = 0` 的记录，
于是种子永远不命中 —— 表现为"装好了、零个插件生效"。

**只报事实**：首次启动后把"期望安装"与"真正启动"对照，
未启动的插件逐个列出原因（`lastError`）；身份插件没起来就**不**打印"管理员已就绪"。
在此之前，向导会在插件全都没启用的情况下打印成功摘要 —— 这种"谎报成功"比失败更糟。

### 5. 声明式清单 `RICENOTE_PLUGINS`（启动期只核对不安装）

`.env` 中的 `RICENOTE_PLUGINS=@ricenote/plugin-posts@1.5.0,…` 由向导写出，
用于"重建环境可复现"。内核启动时逐条核对并把三类问题说清楚：
声明了但没装（给 `pnpm plugin install <spec>`）、已装版本不满足区间（给 `pnpm plugin update <id>`）、
声明了未经目录收录的包（无法映射到插件 ID，只能提示）。

**刻意不自动安装**：启动路径联网装东西会让启动时间不可预测、失败也难定位；
清单是意图声明，动作留给显式命令。`RICENOTE_SEED_PLUGINS` 保留兼容（既启用名单）。

### 6. `builtin` 与 `official` 分离

| 概念 | 判据 | 语义 |
| --- | --- | --- |
| `builtin` | 目录位于 `plugins/official` | 随仓库分发（开发期形态）：**不可卸载**，来源每次启动以仓库路径为准 |
| `official`（新增） | 包名或插件 ID 命中推荐清单 | 显示"官方"徽章、参与推荐版本比较，**可更新、可卸载** |

卸载守卫只认 `builtin`，因此"从 npm 装的官方插件"和第三方插件一样可以卸载。
扩展中心的目录区块按这两个标志分别渲染"随仓库分发 / 已安装 / 可更新 / 未安装"。

### 7. 未初始化引导

启动时若 `.env` 不存在，或错误信息指向"表不存在/库不存在"，直接输出
`pnpm setup` 的指引。判据用**可观察事实**而不是新加状态标记 ——
状态标记在"装到一半"时会撒谎。

## 后果

- 全新部署：`pnpm install && pnpm build && pnpm setup`（自动建库、随机密钥、
  勾选插件、从 npm 装、建管理员）→ `pnpm start`；
- 官方插件终于吃上自己修的高速路：可选安装、按推荐版本、可检查更新、
  后台一键更新/卸载；`plugins/official` 保留为开发期形态（仍不可卸载）；
- 代价：
  - 发布成为发布流程的一部分（`pnpm release:plugins` 先校验后发布），
    版本漂移会在提交前被拦住，而不是发出去才发现；
  - npm 上的版本不可撤回，因此"三处版本一致"是可发布性的硬条件；
  - 向导引入了"安装期"这一条新的代码路径（含建库与网络），
    因此它的验证靠**离线端到端测试**（本地静态 registry + 真实 CLI）而不是手工演练。

## 被否决的方案

| 方案 | 否决原因 |
| --- | --- |
| 只做声明式清单 + 一条 install 命令（不做交互） | 首次安装的人最需要的是"下一步该做什么"；纯清单把选择成本推给用户 |
| 首次启动时自动安装缺失插件 | 启动路径联网不可预测、失败难定位；且与"受控重启"心智冲突 |
| 保留所有插件为内置，只加"可选启用" | 解决不了版本管理：升级仍靠 `git pull`，且禁用≠不安装 |
| 用 changesets 管理多包版本 | 对 11 个插件的当前节奏过重；推荐清单已经把"发哪个版本"收敛到一处，需要时再引入 |
| 沙箱化安装脚本 | 会破坏大量正常包；"安装即授予服务器代码执行权限"已是明确口径，用高风险确认 + 审计承担责任 |
