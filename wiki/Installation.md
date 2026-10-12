# 安装向导

`pnpm run setup` 是推荐的安装方式：它把「环境检查 → 数据库 → 生成 `.env` → 迁移 → 安装官方插件 → 首次启动」串成一条可重入的流程。

> **第一注意点**：必须写 `pnpm run setup`。裸 `pnpm setup` 是 pnpm 自带命令（配置 `PNPM_HOME` 与 `PATH`），会抢在同名脚本之前执行。
> 用 `pnpm ricenote setup` 这种形式也可以。

---

## 向导做了什么

| 阶段 | 行为 | 失败后果 |
| --- | --- | --- |
| 环境检查 | 校验 Node / pnpm 版本与数据库可达性 | 终止，退出码 1 |
| 数据库 | 收集连接信息，**库不存在时自动创建**（库名走标识符白名单） | 终止，退出码 1 |
| 站点与管理员 | 收集站点标题/语言/对外地址、管理员账号 | 使用默认值或自动生成 |
| 生成 `.env` | 写入配置；`SESSION_SECRET` 随机生成；非交互模式自动生成管理员密码 | —— |
| Core 迁移 | 创建 `rn_` 元数据表 | 终止，退出码 1 |
| 插件安装 | 勾选官方插件并从 npm 安装 | 必需插件失败 → 退出码 1 |
| 首次启动 | 初始化内核并创建管理员（授予 `administrator`） | 终止，退出码 1 |
| 摘要 | 打印监听地址、后台地址与管理员凭据 | —— |

**可重入**：任何一步失败，修好后重跑即可。向导会把已有 `.env` 的值当作默认值，并跳过已安装的插件。

---

## 插件选择规则

- **必须安装**（向导中不可取消）：
  - `身份与认证`（`rice.identity`）—— 没有它就没有登录与会话端点。
  - `角色与权限`（`rice.authorization`）—— 没有它权限校验会全部拒绝。
- **默认勾选、可取消**：其余官方插件。
- **不预装**：分类为 `example` 的示例插件。

官方插件清单与用途见 [[官方插件一览|Plugins-Overview]]。

---

## 全部参数

| 参数 | 说明 |
| --- | --- |
| `--yes` / `-y` | 采用默认/推荐档，全程不提问（容器与 CI 用；内部把提示器切为非交互） |
| `--plugins=<列表>` | 指定要安装的插件，逗号分隔（接受插件 ID、npm 包名或短名） |
| `--from-manifest` | 按 `.env` 中已达成的 `RICENOTE_PLUGINS` 清单补齐缺失插件 |
| `--skip-install` | 只准备环境与数据库，**不装插件、不做首次启动** |
| `--force-env` | 覆盖已有 `.env` 的值（默认是沿用为默认值） |
| `--no-scripts` | 安装插件时禁用依赖安装脚本与构建脚本 |
| `--db-url=<连接串>` | `mysql://user:password@host:port/dbname`；缺项留空由其它参数或默认值补 |
| `--db-host` `--db-port` `--db-user` `--db-password` `--db-name` | 分字段数据库配置（**`--db-port` 是数据库端口**） |
| `--host` | 本进程**监听**地址（默认 `0.0.0.0`） |
| `--port` | 本进程**监听**端口（默认 `3000`，必须是 1–65535 的整数，非法值在解析阶段就拒绝） |
| `--site-title` `--site-url` `--site-language` | 站点名称 / 对外地址 / 语言 |
| `--admin-username` `--admin-password` `--admin-email` | 初始管理员 |
| `--help` / `-h` | 打印用法 |

### 默认值（非交互路径）

| 项 | 默认 |
| --- | --- |
| 数据库 | host `127.0.0.1`、port `3306`、user `root`、password 空、库名 `ricenote` |
| 监听 | host `0.0.0.0`、port `3000` |
| 站点 | 标题 `RiceNote`、语言 `zh-CN`、对外地址 `http://localhost:<监听端口>`（**按监听端口推导，不再写死 3000**） |
| 管理员 | 用户名 `admin`、邮箱 `admin@example.com`；密码未提供时随机生成（8 位以上、非纯数字） |

> 非交互模式下自动生成的初始管理员密码**只显示一次**，请立刻保存。

### 监听端口 vs 对外地址

- `--host` / `--port` 写入 `HOST` / `PORT`，是本进程真正绑定的地址。
- `--site-url` 写入 `SITE_URL`，是访客最终访问的地址（用于 canonical URL 与主题的 `url()` helper）。
- 有 nginx / caddy 反向代理时，两者不一致是**正常形态**：本进程只需保证监听端口可达，TLS 与域名由代理决定。

---

## 示例

```bash
# 完全交互式
pnpm run setup

# 一键推荐档（非交互）
pnpm run setup -- --yes

# 指定监听端口与数据库，只装两个必需插件
pnpm run setup -- --port=8080 --db-name=blog --plugins=identity,authorization

# 已有 .env，按清单补齐缺失的插件
pnpm run setup -- --from-manifest

# 只把数据库和环境准备好，插件稍后再装
pnpm run setup -- --skip-install
```

---

## 向导会写入哪些配置

向导会生成/更新 `.env`，涉及的键：

```
NODE_ENV / LOG_LEVEL
HOST / PORT / SITE_URL
DATABASE_URL / DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
SESSION_SECRET / BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD / BOOTSTRAP_ADMIN_EMAIL
SITE_TITLE / SITE_LANGUAGE
PLUGINS_DIR / THEMES_DIR
RICENOTE_PLUGINS           # 声明式插件清单（包名@区间）
RICENOTE_SEED_PLUGINS      # 兼容键，保留用于"首次启动启用哪些插件"
```

各键的完整含义见 [[环境变量参考|Configuration]]。

---

## 手工安装（不使用向导）

```bash
cp .env.example .env   # 修改数据库连接与 SESSION_SECRET（务必改成随机值）
pnpm migrate           # 创建 Core 元数据表并执行插件迁移
pnpm plugin install @ricenote/plugin-identity @ricenote/plugin-authorization
pnpm start
```

首次启动时依据 `RICENOTE_SEED_PLUGINS` 启用插件，并按 `BOOTSTRAP_ADMIN_*` 创建初始管理员。
`RICENOTE_PLUGINS` 在启动期**只核对不安装**，缺件时日志会给出可执行的安装命令。

---

## 相关页面

- [[快速开始|Getting-Started]]
- [[环境变量参考|Configuration]]
- [[插件安装与更新|Plugins-Install-and-Update]]
- [[故障排查|Troubleshooting]]
