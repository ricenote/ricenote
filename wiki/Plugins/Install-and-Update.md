# 插件安装与更新

后台「扩展中心」与 CLI 共用**同一套安装编排、同一个任务队列、同一份任务记录**，行为一致。

---

## 三路来源

| 来源 | 形式 | 适用场景 |
| --- | --- | --- |
| `registry` | npm 包名（可带版本区间） | **主路径**：自动解析普通依赖、按语义化版本检查更新 |
| `git` | 仓库地址 + `--ref`（tag / 分支 / 提交） | 从源码安装；取源码后按 `scripts.build` 构建 |
| `local` | 本地目录，或**压缩包上传**（`via: 'zip'`） | 离线兜底；不参与版本管理 |

```bash
# npm Registry
pnpm plugin install ricenote-plugin-nav@^1.2.0

# Git 仓库
pnpm plugin install --git https://github.com/acme/ricenote-nav.git --ref v1.2.0

# 本地目录 / 压缩包
pnpm plugin install --dir /srv/plugins/my-plugin
pnpm plugin install --zip ./my-plugin.zip
```

后台路径：**扩展中心 → 安装插件**，三种来源分段切换（npm / Git / 本地，本地含压缩包与路径两种方式）。

> ⚠️ 安装第三方插件等同于**授予其在服务器上执行代码的权限**（可执行依赖安装与构建脚本）。
> 后台安装时会显示高风险确认框，需勾选确认后方可提交，并写入审计。用 `--no-scripts` 可关闭脚本执行。

---

## 安装编排：resolve → prepare → commit

```
resolve   解析来源到工作区（npm 下载 / git 拉取 / 本地复制）
   ↓
prepare   校验清单与入口 → 安装依赖 → 执行构建
   ↓
commit    换名落盘 + 写来源元数据 + 审计 + 标记待重启
```

**任一步失败即回滚**：升级失败**不会**让现有版本消失，也不会留下半成品目录。

`prepare` 阶段的两条判据（避免常见故障）：

1. **拒绝**把宿主提供的包（`@ricenote/plugin-sdk` 等）写成普通依赖的插件 —— 那会导致两份实例。
2. 对“没有 `src/` 也没有 `tsconfig.json`”的包，**跳过依赖安装与构建** —— 从 npm 安装的官方插件正是这种形态（直接分发产物）。

还包括：复制插件目录时**排除 `node_modules`**（工作区软链换位置即失效，依赖应由安装阶段重新生成）；
对单调仓库内使用 `workspace:` 协议的插件跳过独立安装并使用其构建产物。

---

## 安装任务队列

安装在**全局串行队列**中执行（同一时刻只有一个任务改磁盘），任务记录在表 `rn_plugin_jobs` 中：

| 字段 | 内容 |
| --- | --- |
| 进度 | 步骤与进度、**末尾 64KB 日志** |
| 结果 | 错误原因（失败时） |
| 归属 | 操作者、起止时间 |
| 状态 | 同类任务**去重**（重复提交返回 409） |

后台与 CLI 共用同一个执行器与同一份任务记录，因此：

- 后台上传安装后可以用 `pnpm plugin jobs <jobId>` 查看同一份日志；
- `POST /api/admin/plugins/install`（压缩包）返回 **202 + 任务**，由队列异步执行。

---

## 来源元数据

`rn_plugins` 记录了每个插件的“从哪来、装的哪个版本”：

`source_type` / `source_spec` / `source_ref` / `resolved_version` / `integrity` / `installed_via`

- 扩展中心与 `pnpm plugin list` 都会展示这些信息；
- **内置插件**每次启动以仓库路径为准刷新；
- **非内置插件**保留安装器写下的权威记录；
- 历史记录会被回填为 `local`；
- 安装完成但内核尚未重启（`rn_plugins` 里还没有该插件）时会**补写一条最小记录**，避免“装完显示来源未知”。

---

## 检查更新与更新

```bash
pnpm plugin updates              # 检查可用更新
pnpm plugin update <pluginId>    # 按已记录的来源更新
```

| 来源 | 更新检查方式 |
| --- | --- |
| `registry` | 对比 semver（已装版本 vs 最新版本） |
| `git` | 对比远端提交 |
| `local` | **明确标注不可检查**（本地来源不参与版本管理） |

后台扩展中心会显示“可更新 vX”徽章与行内更新按钮；也可用 `GET /api/admin/plugins/updates`。

### 关于宿主版本区间

插件清单里声明的是**宿主区间**，例如 `^0.5.0`（= `>=0.5.0 <0.6.0`）。

> 宿主处于 `0.x` 阶段时，**只有次版本号跃迁**才会跨出区间。补丁升级（`0.5.0 → 0.5.1`）**不需要**改动插件声明。
> 请通过插件更新流程处理区间变化，**不要手改插件的 `package.json`**。

---

## 官方插件目录

随主程序发布的推荐清单（`packages/shared/manifests/plugin-catalog.json`）记录了每个官方插件的：

npm 包名、推荐版本、分类（必需 / 推荐 / 可选 / 示例）、显示名与描述、能力与依赖。

它被这些地方共同读取：安装向导、后台扩展中心、`pnpm validate`、发布脚本。

后台 **扩展中心 → 官方插件目录**（`GET /api/admin/plugins/catalog`）支持：

- 未安装的官方插件**一键安装**；
- 已装版本低于推荐版本时提示“可更新”并支持更新；
- 复用同一个安装任务面板（步骤条 + 等宽日志 + 失败原因）。

> 注意区分两个徽章：**「官方」**表示该插件属于官方目录（从 npm 安装，**可更新、可卸载**）；
> **「内置」**表示随仓库分发、**不可卸载**。

---

## 卸载

```bash
pnpm plugin remove <pluginId>
```

拒绝的两种情况：

- 该插件是**内置**插件；
- 存在**依赖它的插件**（反向依赖），或（CLI 的 `disable` 路径）存在已启用的反向依赖。

停用与卸载后**数据表不会删除** —— 插件停用不 drop 表，重新启用后数据仍在。

---

## 开发期：本地插件目录

把插件目录登记到 `RICENOTE_LOCAL_PLUGINS`（逗号分隔）即可：

- 这些目录**参与插件发现**，因此**不需要“安装”这个动作**；
- 开发环境会监视其变化并**自动重启内核**（900ms 抖动合并），实现“改动即生效”；
- 由 `RICENOTE_WATCH_LOCAL_PLUGINS`（默认 `true`）控制是否监视。

> 注意：进程内软重启**不会重载模块代码**（Node ESM 缓存按 URL 生效）。
> 因此“改了插件/内核代码”必须重启**进程**；后台的重启按钮只解决配置与启停生效。

---

## 权限与审计

| 权限点 | 覆盖范围 | 默认持有者 |
| --- | --- | --- |
| `plugin.view` | 查看插件列表、能力、日志 | administrator、editor |
| `plugin.manage` | 插件**启停**与设置 | administrator |
| `plugin.install` | 安装 / 更新 / 卸载 / 构建 | 仅 administrator |

`plugin.install` 与 `plugin.manage` **刻意分开** —— 安装会在服务器上执行插件代码。
所有安装类操作写入审计日志。

---

## 相关命令速查

```bash
pnpm plugin                     # 列出插件（含来源与状态）
pnpm plugin install <npm包>     # 三路来源见上文
pnpm plugin updates             # 检查更新
pnpm plugin update <id>         # 更新
pnpm plugin remove <id>         # 卸载
pnpm plugin jobs                # 最近 20 条任务
pnpm plugin jobs <jobId>        # 某条任务的完整日志
pnpm plugin enable <id>         # 启用
pnpm plugin disable <id>        # 停用（有反向依赖会拒绝）
```

---

## 相关页面

- [[官方插件一览|Plugins/Overview]]
- [[命令行参考|CLI-Reference]]
- [[升级已部署实例|Upgrading]]
- [[插件生命周期与依赖解析|Development/Architecture/Plugin-Lifecycle]]
