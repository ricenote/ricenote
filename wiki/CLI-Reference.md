# 命令行参考

CLI 入口是 `apps/server` 的可执行文件 `ricenote`，根 `package.json` 把它映射为一组 pnpm 脚本。

```bash
pnpm ricenote <命令> [子命令] [参数]      # 显式形式
pnpm <脚本名> [参数]                     # 便捷形式（见下表）
```

| pnpm 便捷脚本 | 等价于 |
| --- | --- |
| `pnpm validate` | `ricenote validate` |
| `pnpm migrate` | `ricenote migrate` |
| `pnpm run setup`  | `ricenote setup` |
| `pnpm plugin <...>` | `ricenote plugin <...>` |
| `pnpm theme <...>` | `ricenote theme <...>` |
| `pnpm build` / `pnpm build:all` / `pnpm typecheck` / `pnpm test` | 工作区构建与检查 |
| `pnpm dev` / `pnpm dev:admin` / `pnpm start` | 开发与启动 |
| `pnpm release:plugins` / `pnpm repos:plugins` | 插件发布与拆分仓库（见 [[维护与发布指南\|Contributing]]） |

顶层全局参数只有 `--root-dir=<路径>`（让命令在指定目录下工作，用于 CI 隔离与演练）。

无参数或 `help` / `--help` / `-h` 会打印帮助并返回 0；未知命令打印帮助并返回 **1**。

---

## `ricenote validate`

无需数据库即可校验插件与主题清单，**适合接入 CI**。

它会检查清单字段、能力声明、扩展点全局唯一性、贡献入口作用域与文件存在性、`replace` 同 `order` 冲突、
主题的 `contentFields` 保留字，以及「官方插件目录」与实际仓库形态的一致性等。
校验通过返回 0，否则返回 1。

---

## `ricenote migrate`

执行 Core 迁移与**已启用插件**的迁移，串行加锁、幂等，按 scope 打印「新增 N 项，跳过 M 项」。

启动时也会自动执行迁移；显式执行的价值是让失败更早暴露。

---

## `ricenote setup`

安装向导，见 [[安装向导|Installation]]。参数会被原样转发给向导，因此需要时要写：

```bash
pnpm run setup -- --yes
pnpm ricenote setup --yes      # 这种形式不需要 --
```

---

## `ricenote plugin`

需要数据库连接（命令启动时会先探活，失败提示 `无法连接数据库` 并返回 1）。

| 子命令 | 用法 | 说明 |
| --- | --- | --- |
| `list` | `ricenote plugin` 或 `ricenote plugin list` | 列出插件（id、版本、启用状态、状态机、来源），并提示「启停后需重启进程」 |
| `install` | `install <npm包>` | 从 npm 安装（可带版本区间，自动解析依赖） |
| | `install --git <仓库> [--ref <tag/分支/提交>]` | 从 Git 安装（取源码后按 `scripts.build` 构建） |
| | `install --dir <本地目录>` | 从本地目录安装（离线兜底） |
| | `install --zip <压缩包路径>` | 从压缩包安装 |
| | 追加 `--no-scripts` | 禁用依赖安装脚本与构建脚本 |
| `update` | `update <pluginId>` | 按**已记录的来源**更新。无来源记录或本地来源会被拒绝（提示卸载重装 / 直接改源目录） |
| `remove` | `remove <pluginId>` | 卸载；内置插件、或存在依赖它的插件时拒绝 |
| `updates` | `updates` | 检查可用更新，输出「可更新 / 已是最新 / 不可检查」 |
| `jobs` | `jobs` | 列出最近 20 条安装任务 |
| | `jobs <jobId>` | 打印该任务的完整日志 |
| `enable` | `enable <pluginId>` | 启用（写状态 + 标记待重启） |
| `disable` | `disable <pluginId>` | 停用；若存在**已启用的反向依赖**则拒绝并返回 1 |

安装类命令会提交任务并**实时轮询打印日志**（全局串行队列，同一时刻只有一个任务改磁盘）。
安装、更新、卸载完成后都需要**重启进程**才生效。

来源解析优先级：`--git` > `--dir` > `--zip` > 位置参数（当作 npm 包名）；缺来源会直接报错。

---

## `ricenote theme`

| 子命令 | 用法 | 说明 |
| --- | --- | --- |
| `list` | `ricenote theme` 或 `ricenote theme list` | 列出主题（`●` 为当前激活项），并列出校验未通过的目录 |
| `activate` | `activate <themeId>` | 激活指定主题 |
| `settings` | `settings <themeId>` | 打印该主题的生效设置（含 revision） |

> ⚠️ **没有 `theme install` 子命令**。
> 安装向导的结束语里曾提示 `pnpm theme install <主题包.zip>`，但该命令并不存在（`theme` 只支持 list/activate/settings）。
> **主题包安装的实际入口是管理后台**：`外观中心 → 安装主题`（对应 `POST /api/admin/themes/install`），或把主题目录直接放进 `THEMES_DIR`。

---

## 输出与退出码约定

- **退出码**：成功 `0`；校验失败、未知命令、子命令失败一律 `1`。
- **输出**：纯文本 + ANSI 着色（列表类命令输出对齐表格，安装任务输出带 `✔/✘` 的实时日志）。
- **没有 JSON 输出模式**：需要机器可读结果时请解析 `GET /api/health` 或审计接口。

---

## 常用组合

```bash
# 部署前把关
pnpm typecheck && pnpm validate

# 检查并更新插件
pnpm plugin updates
pnpm plugin update @ricenote/plugin-posts

# 排查一次失败的安装
pnpm plugin jobs
pnpm plugin jobs <jobId>

# 停用一个插件（会先检查反向依赖）
pnpm plugin disable comments
```

---

## 相关页面

- [[插件安装与更新|Plugins-Install-and-Update]]
- [[安装向导|Installation]]
- [[故障排查|Troubleshooting]]
