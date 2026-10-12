# 环境变量参考

RiceNote 的全部配置来自环境变量，配置在项目根目录的 `.env` 中（`.env.example` 是模板）。
加载与校验在 `packages/core/src/config/loader.ts`，并会再经过一次 JSON Schema（Ajv）校验 ——
**类型或取值非法会在启动阶段直接报错**，而不是运行到一半才炸。

> `.env` **禁止提交到版本库**。生产环境的 `SESSION_SECRET` 必须是高熵随机值。

---

## 运行环境与日志

| 环境变量 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` \| `production` \| `test` | `development` | 影响日志与错误细节、以及本地插件监视 |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `info` | 日志级别 |

> 终端的**可读格式**（时间对齐、级别着色、`key=value`）是默认行为，日志**文件**始终是 JSON Lines。
> 非 TTY（被重定向 / CI）时终端输出自动降级为 JSON。

---

## HTTP 服务

| 环境变量 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `HOST` | 字符串 | `0.0.0.0` | 本进程**监听**地址 |
| `PORT` | `0`–`65535` 整数 | `3000` | 本进程**监听**端口 |
| `SITE_URL` | `http(s)://...` | `http://localhost:3000` | 站点**对外**地址（canonical URL、主题 `url()` helper 使用） |

有反向代理时 `SITE_URL` 与 `HOST:PORT` 不一致是**正常形态**。详见 [[容器化部署与反向代理|Deployment]]。

---

## 数据库

| 环境变量 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | `mysql://user:pass@host:port/db` | 无 | 统一连接串。**若同时提供下方分字段配置，以分字段为准** |
| `DB_HOST` | 字符串 | `127.0.0.1` | 数据库主机 |
| `DB_PORT` | `1`–`65535` 整数 | `3306` | 数据库端口 |
| `DB_USER` | 字符串 | `root` | 数据库用户 |
| `DB_PASSWORD` | 字符串 | 空 | 数据库密码（**可以留空**） |
| `DB_NAME` | 字符串 | `ricenote` | 数据库名 |
| `DB_CONNECTION_LIMIT` | `1`–`100` 整数 | `10` | 连接池上限 |
| `DB_READONLY` | 布尔 | `false` | 禁用数据库写入（用于只读诊断） |

布尔值的真值写法：`1` / `true` / `yes` / `on`。

---

## 安全与会话

| 环境变量 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `SESSION_SECRET` | 长度 ≥ 8 的字符串 | `change-me-in-production` | 会话 Cookie 的 HMAC 签名密钥。**生产必须替换为高熵随机值** |
| `SESSION_TTL_SECONDS` | `300`–`2592000` 整数 | `7200` | 会话有效期（秒），默认 2 小时 |
| `CSRF_ENABLED` | 布尔 | `true` | 是否启用 CSRF 双重提交校验（**不建议关闭**） |
| `BOOTSTRAP_ADMIN_USERNAME` | 3–64 字符 | `admin` | 首次启动创建的管理员用户名 |
| `BOOTSTRAP_ADMIN_PASSWORD` | 长度 ≥ 8 | `admin12345` | 初始管理员密码（**生产必须改**） |
| `BOOTSTRAP_ADMIN_EMAIL` | 邮箱格式 | `admin@example.com` | 初始管理员邮箱 |

> 初始管理员只在**首次启动**时创建，且会被自动授予 `administrator` 角色。已初始化过的实例不会重复创建。
> `rice.identity` 插件还提供两项会话设置（会话有效期与单用户并发会话上限），可在后台「扩展中心 → 插件 → 设置」中调整，与这里的 `SESSION_TTL_SECONDS` 是不同层次（插件设置为准）。

---

## 目录

| 环境变量 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `STORAGE_DIR` | 路径 | `./storage` | 存储根目录 |
| `PLUGINS_DIR` | 路径 | `./plugins/official` | 官方插件根目录 |
| `PLUGINS_INSTALL_DIR` | 路径 | `./plugins/third-party` | 第三方插件安装目录（与官方目录物理隔离） |
| `RICENOTE_LOCAL_PLUGINS` | 逗号分隔路径列表 | 空 | 额外的本地插件根目录（开发调试用） |
| `THEMES_DIR` | 路径 | `./themes` | 主题根目录 |

派生目录（无需配置，跟随 `STORAGE_DIR`）：

| 配置字段 | 实际路径 |
| --- | --- |
| `paths.uploadsDir` | `<storage>/uploads` |
| `paths.cacheDir` | `<storage>/cache` |
| `paths.logsDir` | `<storage>/logs` |
| `paths.backupsDir` | `<storage>/backups` |

项目根目录 `paths.rootDir` **无需配置**：它从工作目录向上查找 `pnpm-workspace.yaml` 自动解析。
（这条解决了"`pnpm dev` 经 pnpm 运行时工作目录是包目录，导致 `.env`、`plugins/`、`themes/` 全部解析错位置"的历史缺陷。）

---

## 站点

| 环境变量 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `SITE_ID` | 字符串 | `default` | 站点标识（v1 单站点） |
| `SITE_TITLE` | 字符串 | `RiceNote` | 站点标题 |
| `SITE_DESCRIPTION` | 字符串 | `插件优先的轻量级博客与内容管理系统` | 站点描述 |
| `SITE_LANGUAGE` | 字符串（≥ 2 字符） | `zh-CN` | 站点语言（影响后台多语言文案解析） |
| `DEFAULT_THEME` | 主题 ID 或短名 | `minimal` | 默认激活主题，首次启动时写入数据库 |

> **站点信息可以不改 `.env`**：后台「系统设置」里可在线修改标题、描述、语言、站点地址、Logo、图标、备案信息，
> 立即生效（无需重启）。后台的改动是**稀疏覆盖**（只存改过的字段），清空即回落到 `.env` 默认值。

---

## 插件发现与安装

| 环境变量 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `RICENOTE_SEED_PLUGINS` | 逗号分隔列表 | 空 | **首次启动**要自动启用并迁移的插件（短名或完整 ID） |
| `RICENOTE_PLUGINS` | 逗号分隔的 `包名@区间` | 空 | 声明式插件清单。由向导写出，用于「重建环境可复现」；**启动期只核对不安装** |
| `RICENOTE_ALLOW_INSTALL_SCRIPTS` | 布尔 | `true` | 是否允许插件安装过程中的依赖安装脚本与构建脚本 |
| `RICENOTE_INSTALL_TIMEOUT_SECONDS` | `30`–`3600` 整数 | `600` | 单条安装命令超时（秒） |
| `RICENOTE_WATCH_LOCAL_PLUGINS` | 布尔 | `true` | 开发环境是否监视本地插件目录变化并自动重启内核 |
| `RICENOTE_NPM_REGISTRY` | `http(s)://...` | `https://registry.npmjs.org` | 私有 npm 源 |
| `RICENOTE_NPM_TOKEN` | 字符串 | 无 | 私有源令牌。**只从环境变量读取，不落库、不进日志** |

关于 `RICENOTE_PLUGINS` 的区间语义：

> 区间写的是插件的**宿主区间**，例如 `^0.6.0`（等价于 `>=0.6.0 <0.7.0`）。
> 宿主处于 `0.x` 阶段时，**只有次版本号跃迁**才会跨出区间 —— 补丁升级（如 `0.6.0 → 0.6.1`）**不需要**改动插件声明。

---

## 预览与渲染缓存

| 环境变量 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `PREVIEW_TTL_SECONDS` | `30`–`86400` 整数 | `900` | 后台预览链接的有效期（秒） |
| `RENDER_CACHE_ENABLED` | 布尔 | `true` | 是否启用前台 HTML 缓存 |
| `RENDER_CACHE_TTL_SECONDS` | `0`–`86400` 整数 | `120` | HTML 缓存有效期（秒）；`0` 表示不按时间过期 |

---

## 备份工具

| 环境变量 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `MYSQLDUMP_BIN` | 路径或命令名 | `mysqldump` | MySQL 导出工具。**未加入 PATH 时写绝对路径**（Windows 官方安装包默认不在 PATH 中） |
| `MYSQL_BIN` | 路径或命令名 | `mysql` | MySQL 客户端。同上 |

工具缺失时备份接口会返回结构化的 `RN_BACKUP_TOOL_MISSING`（HTTP 503），而不是 500。

---

## 改完要不要重启？

| 变更 | 是否需重启 |
| --- | --- |
| 站点信息（标题/描述/语言/地址/Logo/备案） | **不需要**，后台改完立即生效 |
| 环境变量（`.env`） | 需要重启进程 |
| 插件启用 / 停用 | 需要重启进程（受控重启） |
| 插件安装 / 更新 / 卸载 | 需要重启进程 |
| 插件设置（声明式表单） | 需要重启进程 —— 保存后后台顶栏会出现「待重启」按钮，可一键重启 |
| 主题激活 / 主题设置 | 见 [[主题与外观\|Themes]] |
| `RICENOTE_LOCAL_PLUGINS` 目录内容 | 开发环境**自动重启内核**（`RICENOTE_WATCH_LOCAL_PLUGINS=true`） |

---

## 两个不走配置模式（schema）的日志键

配置加载器（`packages/core/src/config/loader.ts`）的 schema 只收录上面表格里的键，因此下列两项
**不会出现在本页的表格中** —— 它们由日志模块（`packages/core/src/logger.ts`）**直接读取环境变量**，
写法与效果都正常，只是不参与"配置模式校验"：

| 键 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `LOG_FORMAT` | `pretty` / `json` | 跟随 TTY | 强制终端输出格式；非 TTY（CI、输出被重定向到文件）自动降级为 JSON，避免控制字符污染流水线 |
| `NO_COLOR` | 任意非空值 | 无 | 设置后关闭终端着色（`NO_COLOR` 约定） |

日志**文件**始终是 JSON Lines，与这两项无关。

唯一**确实不生效**的是 `DB_ROOT_PASSWORD`：应用代码未读取它，该键只在 `docker-compose.yml` 里供
MySQL 容器自身使用。这一处偏差已记录在 [[常见问题|FAQ]] 中。

---

## 相关页面

- [[安装向导|Installation]]（向导会写入哪些键）
- [[容器化部署与反向代理|Deployment]]
- [[常见问题|FAQ]]
