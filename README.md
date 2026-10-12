# RiceNote

插件优先的轻量级博客与内容管理系统（CMS）。

- **小内核**：Core 只提供引导、安全边界、插件/主题注册、路由、服务、事件、数据库访问与渲染基础设施。
- **业务皆插件**：文章、独立页面、导航栏、分类标签、媒体、用户与权限、评论、搜索、SEO 全部以独立插件实现，可独立开发、启停与升级。
- **插件自带后台界面**：插件在 `admin/` 下写零构建的前端模块即可获得完整管理页面（后台提供通用宿主与 [`@ricenote/admin-sdk`](packages/admin-sdk) 组件库），Core 里不再有插件专属页面。
- **三路来源安装插件**：npm Registry（含依赖解析与版本更新检查）、Git 仓库（tag / 提交 / 分支）、本地目录（含压缩包），后台与 CLI 共用同一套编排、任务队列与实时日志，升级失败自动回滚。
- **零构建主题**：主题 = `theme.json` + `templates/*.njk` + `assets/*`，只需 HTML/CSS 与可选 JavaScript。
- **易部署**：面向个人 VPS，提供 Docker Compose（MySQL 8.4 + server + Nginx）。

## 技术栈

| 层次 | 技术 |
| --- | --- |
| 语言 / 运行时 | TypeScript + Node.js LTS（>= 20.11） |
| HTTP 框架 | Fastify |
| 数据库 | MySQL 8.x + Drizzle ORM |
| 校验 | JSON Schema + Ajv |
| 管理后台 | Vue 3 + Vite + Vue Router + **shadcn-vue** |
| 前台主题 | Nunjucks + 原生 CSS/JS（默认服务端渲染） |
| 包组织 | pnpm workspace |
| 部署 | Docker Compose + Nginx |

## 目录结构

```
ricenote/
├── apps/
│   ├── server/          # HTTP/CLI 入口与 bootstrap
│   └── admin/           # Vue 3 管理后台（shadcn-vue）
├── packages/
│   ├── core/            # 内核：插件/主题/服务/事件/路由/渲染/数据库/安全
│   ├── plugin-sdk/      # 插件稳定公共接口
│   ├── theme-sdk/       # 主题 helper / filter / 校验器
│   └── shared/          # DTO、错误码、capability 工具、Manifest Schema
├── plugins/official/    # 官方插件（目录即插件）
├── themes/              # 主题（minimal / default）
├── storage/             # 上传、缓存、日志
├── docs/                # 架构、Plugin API、Theme API、ADR
└── tests/               # 集成与端到端测试
```

## 快速开始

### 1. 环境要求

- Node.js >= 20.11
- pnpm >= 9
- MySQL 8.x（本机或容器，**库可以不存在** —— 向导会自动创建）

### 2. 安装依赖并构建

```bash
pnpm install
pnpm build            # 编译 Core / SDK / 官方插件 / 服务端
```

### 3. 运行安装向导（推荐）

```bash
pnpm run setup
```

一条命令走完：检查环境 → 收集数据库与站点信息 → **自动建库** → 生成 `.env`
（含随机 `SESSION_SECRET` 与管理员凭据）→ 执行内核迁移 → **勾选要安装的官方插件**
并从 npm 安装 → 首次启动完成初始化（创建管理员）。

- **必须安装**两项：`身份与认证`（缺它没有登录端点）与 `角色与权限`（缺它权限校验全拒），
  向导中不可取消；其余官方插件默认勾选、可取消。
- 非交互（容器与 CI）：参数需用 `--` 分隔后原样传给向导 ——
  `pnpm run setup -- --yes`（推荐档一键装完）、`-- --plugins=posts,pages`（指定清单）、
  `-- --from-manifest`（按 `.env` 已有清单补齐）。用 `pnpm ricenote setup --yes` 这种形式则不需要 `--`。
- 可重入：任何一步失败都可以修好后重跑，已完成的步骤会被跳过。

```bash
pnpm start            # 启动服务端（默认 http://localhost:3000）
```

<details>
<summary>手工安装（高级路径，不使用向导）</summary>

```bash
cp .env.example .env   # 按需修改数据库连接与 SESSION_SECRET（务必改成随机值）
pnpm migrate           # 创建 Core 元数据表并执行插件迁移
pnpm plugin install @ricenote/plugin-identity @ricenote/plugin-authorization
pnpm start
```

首次启动时，服务端会依据 `RICENOTE_SEED_PLUGINS` 启用插件
（短名，如 `identity,authorization,posts`），并按
`BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` 创建初始管理员
（该用户会被自动授予 `administrator` 角色）。

> 内核在启动时**只核对不安装**：若 `.env` 里的 `RICENOTE_PLUGINS` 声明了未安装的插件，
> 日志会给出对应的安装命令。
</details>

### 5.1 安装与更新插件（命令行）

后台「扩展中心」与 CLI 共用同一套编排与任务队列，行为一致：

```bash
# npm Registry（主路径：自动解析依赖、按语义化版本检查更新）
pnpm plugin install ricenote-plugin-nav@^1.2.0

# Git 仓库（tag / 提交 / 分支；取源码后按 scripts.build 构建）
pnpm plugin install --git https://github.com/acme/ricenote-nav.git --ref v1.2.0

# 本地目录 / 压缩包（离线兜底，不参与版本管理）
pnpm plugin install --dir /srv/plugins/my-plugin
pnpm plugin install --zip ./my-plugin.zip

pnpm plugin updates            # 检查可用更新
pnpm plugin update <pluginId>  # 按已记录的来源更新
pnpm plugin remove <pluginId>  # 卸载（内置插件与存在依赖时拒绝）
pnpm plugin jobs               # 安装任务历史与日志
```

开发期想「改动即生效」，把插件目录登记到 `RICENOTE_LOCAL_PLUGINS`
（逗号分隔）即可：它们参与插件发现、不需要"安装"，且开发环境会监视变化并自动重启内核。

> 安装第三方插件等同授予其在服务器上执行代码的权限（可执行依赖安装与构建脚本）。
> 私有源用 `RICENOTE_NPM_REGISTRY` / `RICENOTE_NPM_TOKEN` 配置（只读环境变量，不落库）。

### 6. 访问

| 地址 | 说明 |
| --- | --- |
| `http://localhost:3000/` | 公开站点（Nunjucks 服务端渲染） |
| `http://localhost:3000/admin/` | 管理后台（构建产物由服务端托管） |
| `http://localhost:3000/api/health` | 健康检查 |

管理后台开发模式（热更新 + API 代理到 3000 端口）：

```bash
pnpm dev:admin        # 另开终端，默认 http://localhost:5173/admin/
```

> 提示：`pnpm build` 会一并构建管理后台；若只改动了前端，可用
> `pnpm --filter @ricenote/admin build` 单独构建（无需重启服务端）。

### 6. 使用 Docker Compose

```bash
docker compose up -d
# 需要 Nginx 反向代理时
docker compose --profile with-nginx up -d
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm build` | 编译全部可构建工作区包 |
| `pnpm typecheck` | 全量类型检查 |
| `pnpm migrate` | 执行 Core 与插件迁移 |
| `pnpm validate` | 校验插件/主题 Manifest |
| `pnpm plugin <list\|enable\|disable>` | 插件启停管理 |
| `pnpm theme <list\|activate\|settings>` | 主题管理 |
| `pnpm test` | 运行单元与集成测试 |
| `pnpm build:all` | 全量构建（含管理后台） |

## 核心概念

- **Capability 契约**：插件依赖声明优先指向能力契约（如 `content.posts@1`），实现者按 capability 解析，避免硬编码插件 ID。
- **生命周期**：`DISCOVERED → VALIDATED → INSTALLED → ENABLED → STARTED → STOPPED/DISABLED`，`FAILED` 独立记录；v1 采用受控重启生效。
- **主题三层配置**：`effective = defaults + publishedOverrides`，后台预览时额外叠加 `draftOverrides`，保存使用 revision 乐观锁。
- **Slot 插槽**：插件可向 `head.end`、`post.comments` 等标准挂载点注入安全 HTML 片段，组件级错误隔离。

## 文档

- [架构总览](docs/architecture/overview.md)
- [Plugin API v1](docs/plugin-api/v1.md)
- [Theme API v1](docs/theme-api/v1.md)
- [架构决策记录（ADR）](docs/adr/)

## 变更日志

见 [CHANGELOG.md](CHANGELOG.md)，遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## 许可

MIT
