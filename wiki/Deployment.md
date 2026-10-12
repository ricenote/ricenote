# 容器化部署与反向代理

仓库提供 `docker-compose.yml`，面向个人 VPS：MySQL 8.4 + RiceNote 服务端 + 可选 Nginx。

> **前置条件（请先读）**：`docker-compose.yml` 引用了两个 **Docker 构建上下文文件**：
> - `docker/server.Dockerfile`（`server` 服务的 `build.dockerfile`）
> - `docker/nginx.conf`（`nginx` 服务挂载的配置）
>
> **当前仓库中并没有 `docker/` 目录**。也就是说 `docker compose up -d` 在补齐这两个文件之前无法完成构建/启动。
> 本页如实说明该拓扑与用法；你需要在部署前自备这两个文件（见下文「需要自备的文件」）。

---

## 服务拓扑

```
                      ┌───────────────────────────┐
   访客 ── :8080 ───► │ nginx (profile: with-nginx)│
                      └────────────┬──────────────┘
                                   │ 反向代理
                                   ▼
                      ┌───────────────────────────┐
                      │ server  (Host 端口 3000)   │
                      │ 挂载 storage / plugins /  │
                      │      themes               │
                      └────────────┬──────────────┘
                                   │ mysql 协议
                                   ▼
                      ┌───────────────────────────┐
                      │ mysql:8.4                  │
                      │ utf8mb4 / volume:          │
                      │ mysql-data                 │
                      └───────────────────────────┘
```

| 服务 | 镜像 / 构建 | 端口 | 关键点 |
| --- | --- | --- | --- |
| `mysql` | `mysql:8.4` | `${DB_PORT:-3306}:3306` | `utf8mb4` / `utf8mb4_unicode_ci`；`caching_sha2_password`；带 healthcheck；数据落在卷 `mysql-data` |
| `server` | 构建自 `docker/server.Dockerfile` | 不对外暴露 | `NODE_ENV=production`、`HOST=0.0.0.0`、`PORT=3000`；`depends_on` 等待 MySQL 健康；挂载 `./storage` `./plugins` `./themes` |
| `nginx` | `nginx:1.27-alpine` | `${HTTP_PORT:-8080}:80` | 只在 `with-nginx` profile 下启动；挂载 `./docker/nginx.conf:ro` |

---

## 启动

```bash
# 只起 MySQL + 应用（自己在外层做代理，或在服务器上直接暴露 3000）
docker compose up -d

# 带上 Nginx 反向代理
docker compose --profile with-nginx up -d
```

MySQL 容器使用以下环境变量（其它服务通过 Docker 网络内的 `mysql:3306` 访问它）：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DB_ROOT_PASSWORD` | `cc80212562` | MySQL root 密码（**仅容器内使用**，请务必改掉） |
| `DB_NAME` | `ricenote` | 初始库名 |
| `DB_USER` | `ricenote` | 应用账号 |
| `DB_PASSWORD` | `ricenote` | 应用账号密码 |

服务端容器使用：

| 变量 | 默认值 |
| --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `3000` |
| `DB_HOST` | `mysql` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | 同 MySQL 服务 |
| `SESSION_SECRET` | `change-me-in-production`（**必须替换**） |
| `SITE_URL` | `http://localhost:8080`（**按实际对外地址修改**） |

---

## 需要自备的文件

部署前请补齐 `docker-compose.yml` 引用的两项（本仓库当前缺）：

1. **`docker/server.Dockerfile`** —— 多阶段构建：安装依赖 → `pnpm build` → 只拷贝产物与生产依赖 → 以非 root 用户启动 `pnpm start`（`apps/server`）。
   建议体积与安全取向：基于 `node:20-alpine` 或 `node:22-slim`，明确 `ENV NODE_ENV=production`，暴露 `3000`。
2. **`docker/nginx.conf`** —— 位于容器的 `/etc/nginx/conf.d/default.conf`，需包含：
   - `proxy_pass http://server:3000;`
   - 转发 `Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`
   - 静态资源长缓存与上传体积上限（`client_max_body_size`，至少覆盖备份恢复的 128MB 上限）
   - 保留 WebSocket/SSE 相关头（若后续使用）

> 若你不想用容器，也可以直接 `pnpm build && pnpm start` 配合宿主机的 systemd 与 nginx —— 反向代理部分的要点相同。

---

## 监听端口 vs 对外地址（最容易踩的一点）

RiceNote 把"进程绑定在哪"和"访客看到什么地址"明确分成两个配置：

| 配置 | 含义 | 谁决定 |
| --- | --- | --- |
| `HOST` / `PORT` | 本进程**监听**的地址与端口 | 本进程；只需保证该端口可达 |
| `SITE_URL` | 站点**对外**地址，写入 canonical URL 与主题 `url()` | 反向代理后的真实地址 |

因此：

- 容器里 `PORT=3000` + Nginx 监听 `80` → 访客访问 `http://<域名>/`，`SITE_URL` 应填 `http://<域名>`（有 TLS 就填 `https://...`）。
- **两者不一致是正常形态**，不是配置错误。反之，如果 `SITE_URL` 填成了 `http://localhost:3000`，前台生成的绝对链接（sitemap、canonical、RSS 之类）就会指向 localhost。

安装向导也会按监听端口推导 `SITE_URL` 的默认值 —— 上生产时记得改成真实对外地址（可在后台「系统设置」在线修改，立即生效）。

---

## 数据与持久化

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| 数据库 | Docker 卷 `mysql-data` | 备份请用后台「备份与恢复」或 `mysqldump` |
| 上传文件 / 缓存 / 日志 / 备份 | 宿主 `./storage` → 容器 `/app/storage` | 建议纳入宿主备份策略 |
| 插件 | 宿主 `./plugins` → 容器 `/app/plugins` | 从后台/CLI 安装的插件会写在这里（`./plugins/third-party`） |
| 主题 | 宿主 `./themes` → 容器 `/app/themes` | 主题包在线安装也会写在这里 |

> 因为 `plugins/` 与 `themes/` 是宿主挂载，**在线安装的插件与主题不会随容器重建而丢失**，这点很重要。

---

## 反向代理要点（自建 nginx / caddy）

若不用 Compose 自带的 nginx 服务，请确保代理：

1. 把 `Host` 与 `X-Forwarded-Proto` 透传给后端；
2. 上传体积上限覆盖媒体（默认 8MB）与备份恢复（128MB）；
3. 静态资源路径 `/admin/assets/*`、`/admin-sdk/v1/*`、`/plugin-admin/*`、`/theme-assets/*` 一并代理（直接整体代理 `/` 即可）；
4. TLS 终止在代理层，后端保持明文 HTTP。

---

## 上线自检

| 检查 | 期望 |
| --- | --- |
| `GET /api/health` | `status: ok`、`database.reachable: true`、`plugins.failed: 0` |
| 启动日志 | `RiceNote 启动完成 started=N failed=0` |
| 前台首页 | 正常渲染，静态资源无 404 |
| 后台 `/admin/` | 可登录，扩展中心里必需插件齐全 |
| `robots.txt` / `sitemap.xml` | 地址指向 `SITE_URL` 而非 localhost |

---

## 相关页面

- [[环境变量参考|Configuration]]
- [[升级已部署实例|Upgrading]]
- [[故障排查|Troubleshooting]]
