# RiceNote

插件优先的轻量级博客与内容管理系统（CMS）。

- **小内核**：Core 只提供引导、安全边界、插件/主题注册、路由、服务、事件、数据库访问与渲染基础设施。
- **业务皆插件**：文章、分类标签、媒体、用户与权限、评论、搜索、SEO 全部以独立插件实现，可独立开发、启停与升级。
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
- MySQL 8.x（本机或容器）

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 按需修改数据库连接与 SESSION_SECRET
```

### 4. 构建并初始化

```bash
pnpm build            # 编译 Core / SDK / 官方插件 / 服务端
pnpm migrate          # 创建 Core 元数据表并执行插件迁移
```

### 5. 启动

```bash
pnpm start            # 启动服务端（默认 http://localhost:3000）
```

首次启动时，服务端会依据 `RICENOTE_SEED_PLUGINS` 自动安装并启用官方插件，
并按 `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` 创建初始管理员
（该用户会被自动授予 `administrator` 角色）。

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
| `pnpm test` | 运行单元与集成测试（60 项） |
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
