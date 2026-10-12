# 快速开始

目标：在本地把 RiceNote 跑起来，登录后台，写第一篇文章。

全程只有三条命令（前置条件满足的话）。

---

## 1. 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | `>= 20.11.0`（仓库 `engines` 声明） | 开发机实测 22.x |
| pnpm | `>= 9`（仓库 `packageManager` 为 `pnpm@9.15.9`） | 项目是 pnpm workspace |
| MySQL | `8.x` | 本机安装或用 Docker 起一个都行；**库可以不存在**，安装向导会自动建库 |

> 数据库账号需要具备 `CREATE DATABASE` 权限 —— 向导会用它自动建库。
> 库名会做标识符白名单校验，避免拼接注入。

---

## 2. 安装依赖并构建

```bash
pnpm install
pnpm build
```

`pnpm build` 会编译 Core、SDK、全部官方插件、服务端与管理后台。
若只改了前端，可用 `pnpm --filter @ricenote/admin build` 单独构建，无需重启服务端。

---

## 3. 运行安装向导（推荐路径）

```bash
pnpm run setup
```

> **注意**：请务必写 `pnpm run setup`（或 `pnpm ricenote setup`）。
> 裸 `pnpm setup` 是 **pnpm 自带的命令**，它会去配置 `PNPM_HOME` 与 `PATH` 并抢在同名脚本前执行 —— 你不会看到安装向导，而是改了自己的 shell 环境。

向导会依次完成：

1. **环境检查** —— Node / pnpm / 数据库可达性。
2. **数据库** —— 收集连接信息，**库不存在时自动创建**（库名白名单校验）。
3. **站点与管理员信息** —— 站点标题、语言、对外地址、初始管理员账号。
4. **生成 `.env`** —— 含随机 `SESSION_SECRET`；非交互模式下自动生成初始管理员密码，**仅显示一次**。
5. **执行 Core 迁移** —— 建立 `rn_` 元数据表。
6. **勾选要安装的官方插件** —— 从 npm 安装（见下）。
7. **首次启动完成初始化** —— 创建管理员账号并授予 `administrator` 角色。
8. **打印结果摘要** —— 监听地址、后台地址、管理员凭据。

### 插件选择

- **必须安装**两项：`身份与认证`（缺它没有任何登录端点）与 `角色与权限`（缺它权限校验会全部拒绝）。
  向导中这两项**不可取消**。
- 其余官方插件默认勾选、可取消。
- 示例类插件（分类为 `example`）**不会**被向导预装。

### 向导完成后

```bash
pnpm start
```

服务端监听 `.env` 中的 `HOST:PORT`（默认 `http://localhost:3000`）。

> 向导是**可重入**的：任何一步失败，修好后直接重跑即可 —— 它会把已有 `.env` 当作默认值，并跳过已安装的插件。

### 非交互（容器 / CI）

参数需要用 `--` 分隔后原样传给向导：

```bash
pnpm run setup -- --yes                       # 推荐档，一键装完
pnpm run setup -- --plugins=posts,pages       # 指定要装的插件
pnpm run setup -- --from-manifest             # 按 .env 中已有清单补齐缺失插件
pnpm run setup -- --skip-install              # 只准备环境与数据库，不装插件、不首次启动
```

若用 `pnpm ricenote setup --yes` 这种形式，则不需要 `--`。无 TTY 环境下向导会自动降级为非交互模式。

全部参数见 [[安装向导|Installation]]。

---

## 4. 访问

| 地址 | 说明 |
| --- | --- |
| `http://localhost:3000/` | 公开站点（Nunjucks 服务端渲染） |
| `http://localhost:3000/admin/` | 管理后台 |
| `http://localhost:3000/api/health` | 健康检查（返回版本、插件计数、数据库延迟等） |

> 上表按默认 `HOST=0.0.0.0` / `PORT=3000` 列出。改了监听端口请按新端口访问；
> 若前面有反向代理，请以 `SITE_URL`（对外地址）为准 —— **它与监听地址不一致是正常形态**，详见 [[容器化部署与反向代理|Deployment]]。

用向导给出的管理员账号登录后台，即可开始写作。后台各页面见 [[后台功能导览|Admin-Guide]]。

### 后台前端开发模式

```bash
pnpm dev:admin        # 另开终端，默认 http://localhost:5173/admin/（热更新 + API 代理到 3000）
```

---

## 手工安装（高级路径，不使用向导）

```bash
cp .env.example .env   # 按需修改数据库连接与 SESSION_SECRET（务必改成随机值）
pnpm migrate           # 创建 Core 元数据表并执行插件迁移
pnpm plugin install @ricenote/plugin-identity @ricenote/plugin-authorization
pnpm start
```

首次启动时，服务端会依据 `RICENOTE_SEED_PLUGINS` 启用插件（短名，如 `identity,authorization,posts`），
并按 `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` 创建初始管理员（自动授予 `administrator` 角色）。

> 内核在启动时对 `RICENOTE_PLUGINS` 声明的插件**只核对不安装**：缺件或版本不符时，日志里会给出可直接执行的安装命令。

---

## 下一步

- 需要调整配置？→ [[环境变量参考|Configuration]]
- 要部署到服务器？→ [[容器化部署与反向代理|Deployment]]
- 要用命令行管理插件与主题？→ [[命令行参考|CLI-Reference]]
- 想自己写一个插件？→ [[从零写一个插件|Plugin-API-Tutorial]]
