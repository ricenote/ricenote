# 后台功能导览

管理后台是 Vue 3 SPA，由服务端托管：`http://<你的地址>/admin/`。

**Core 只提供通用页面**；文章、页面、导航栏、分类标签、媒体、评论、用户、角色等页面都由**插件自带**，
按插件是否启用动态出现在侧栏（未启用时对应入口消失，而不是留下一个坏链接）。

---

## 登录

| 项 | 说明 |
| --- | --- |
| 地址 | `/login`（未登录访问其它后台地址会重定向到这里，登录后回跳原地址） |
| 凭据 | 安装向导创建的管理员账号；忘记密码可由其他管理员在「用户」页重置，或直接改数据库 |
| 会话 | Cookie + HMAC 签名（HttpOnly / SameSite）；有效期由 `SESSION_TTL_SECONDS` 与 identity 插件设置决定 |
| 安全 | 登录失败限流；所有写操作需要 CSRF 双重提交校验；所有管理写操作落入审计日志 |

---

## Core 自有页面

| 页面 | 路径 | 所需权限 | 功能 |
| --- | --- | --- | --- |
| 仪表盘 | `/` | 仅需登录 | 告警卡（失败插件、缺失服务）、站点状态（版本、运行时长、Node、激活主题、插件总数）、统计卡（文章/用户/媒体/缓存）、最近更新文章、插件健康列表 |
| 外观中心 | `/themes` | `theme.view` | 主题列表与安装、激活、声明式设置表单（含预览 / 历史 / 回滚 / 重置） |
| 扩展中心 | `/plugins` | `plugin.view` | 插件列表与启停、安装/更新/卸载、官方插件目录、更新检查、安装任务与日志、插件设置 |
| 运行日志 | `/logs` | `system.maintain` | 只读日志：按级别 / 时间范围 / 关键字 / 文件过滤 + 分页（按文件尾部有限窗口读取） |
| 备份与恢复 | `/backup` | `system.maintain` | 导出一键备份、只读预览上传包、快照列表 / 下载 / 删除 / 回滚 |
| 个人资料 | `/profile` | 仅需登录 | 修改显示名与邮箱；修改密码（需校验原密码，成功后其他设备会话失效） |
| 系统设置 | `/settings` | 仅需登录（写入需 `theme.manage`） | 站点信息在线修改、运行时能力与诊断、插槽/事件清单、审计日志 |
| 404 | 任意未匹配地址 | —— | 明确提示而不是静默跳回仪表盘 |

### 仪表盘的降级行为

统计卡依赖各插件的服务契约。**契约缺失（对应插件未启用）时该项统计降级为 0 并列入 `missingServices`**，
页面顶部给出告警 —— 这是"插件可独立启停"的另一面，不是故障。

### 「待重启」按钮

顶栏在存在待生效变更时显示「待重启」（柠檬黄描边 + 圆点 + 悬停原因）。
点击后弹确认 → 显示进行中态 → **轮询等待服务恢复**（先等健康检查通过，再等 `startedAt` 变化以确认是新进程）。

---

## 插件带来的页面

由各插件在 `manifest.json` 的 `admin.pages` 中声明，`order` 降序排列（同序按 ID），权限不足则不出现在侧栏。

| 页面 | 路径 | 所需权限 | 由谁提供 | 功能 |
| --- | --- | --- | --- | --- |
| 媒体库 | `/media` | `media.manage` | `rice.media` | 上传（扩展名白名单 + 随机文件名）、列表、元数据、删除；可供内容选择器调用 |
| 分类与标签 | `/taxonomy` | `post.view`（写入需 `taxonomy.manage`） | `rice.taxonomy` | 词条管理、文章关联 |
| 页面 | `/pages` | `page.view` | `rice.pages` | 列表 + 筛选 + 抽屉式编辑 + 状态与模板选择 + 删除确认 |
| 页面编辑 | `/pages/editor` | `page.manage` | `rice.pages` | 独立编辑页（**不进侧栏**，靠深链或列表跳转进入） |
| 导航栏 | `/navigation` | `nav.view`（写入需 `nav.manage`） | `rice.navigation` | 前台预览、上下移排序、启用开关、类型化编辑；引用类目标失效时给出原因 |
| 友情链接 | `/friend-links` | `link.view`（写入需 `link.manage`） | `rice.friend-links` | 友链列表 + 弹窗表单、启用开关、排序数值（越小越靠前）；前台页面为 `/links` |
| 角色与权限 | `/roles` | `user.manage` | `rice.authorization` | 角色、权限点、用户-角色分派 |
| 评论审核 | `/comments` | `comment.moderate` | `rice.comments` | 状态页签与计数、嵌套缩进展示、批量操作、详情浮层（含 IP 哈希与 UA） |
| 用户 | `/users` | `user.manage` | `rice.identity` | 用户列表、创建、重置他人密码（**不能重置自己**） |
| 文章 | `/posts` | `post.view` | `rice.posts` | 列表 + 筛选 + 状态操作 |
| 编辑文章 | `/posts/editor` | `post.write` | `rice.posts` | 独立编辑页（**不进侧栏**）：Markdown 编辑、分类与标签、SEO 字段、预览、状态切换 |

> 声明了页面但**插件未启用**时，该页面为「已声明未注册」状态，由兜底页面给出明确提示（而非白屏或 404）。

### 「编辑增强」插件做了什么

`rice.editor-enhance` 不提供任何页面，它通过贡献扩展点把**文章/页面编辑页**升级：

- 正文区从普通文本域换成 **Toast UI Editor**（Markdown 双栏实时预览、中文界面、关闭使用统计）；
- 在列表页替换默认操作按钮区、在编辑器工具栏追加按钮。

它 vendor 了上游编辑器产物（MIT），**宿主不新增依赖、插件侧无构建步骤**。
vendor 缺失时**自动降级**回文本域 —— 编辑功能与草稿都不缺失。

### 标签输入

文章编辑页的标签是「输入即选择、不存在即创建」：单输入框内多选已有标签（忽略大小写与首尾空白、高亮匹配、键盘上下 + 回车选取）；
输入不存在的名称时**按权限**自动创建标签并选中。分类选择保持为下拉。

> 创建标签需要 `taxonomy.manage`。没有该权限的角色只能选择已有标签，界面会给出原因说明，而不是"输入了没反应"。

---

## 权限点与内置角色

权限点归**拥有它的一方**：插件在自己的 `manifest.permissions` 里声明（含展示名与分组），
Core 的控制面与共用权限点写在内核里。Core 校验全局唯一并聚合，
`rice.authorization` 只负责按站点语言展示与分派。

| 权限点 | 组别 | 含义 | 声明方 |
| --- | --- | --- | --- |
| `post.view` / `post.write` / `post.publish` / `post.delete` | 内容 | 文章查看、撰写、发布、删除 | `rice.posts` |
| `page.view` / `page.manage` | 内容 | 页面查看 / 管理 | `rice.pages` |
| `taxonomy.manage` | 内容 | 分类与标签维护（含"输入即创建标签"） | `rice.taxonomy` |
| `media.manage` | 内容 | 媒体上传与删除 | `rice.media` |
| `comment.moderate` | 互动 | 评论审核 | `rice.comments` |
| `nav.view` / `nav.manage` | 外观 | 导航栏查看 / 管理 | `rice.navigation` |
| `link.view` / `link.manage` | 外观 | 友情链接查看 / 管理 | `rice.friend-links` |
| `theme.view` / `theme.manage` | 外观 | 主题查看 / 管理（含站点信息写入） | Core |
| `plugin.view` / `plugin.manage` | 扩展 | 插件查看 / 启停与设置 | Core |
| `plugin.install` | 扩展 | 插件**安装 / 更新 / 卸载 / 构建**（会在服务器上执行插件代码，默认仅管理员） | Core |
| `user.manage` | 用户 | 用户与角色管理（identity 与 authorization 共用） | Core |
| `system.audit` / `system.maintain` / `system.restart` | 系统 | 审计日志 / 运行日志与备份 / 一键重启 | Core |

**内置角色只有 `administrator`（`*`）**：启动只保证它存在且权限为 `*`（否则库被改坏后没人能进后台）。

> `editor` / `author` / `contributor` 曾是内置角色，现在**不再内置**（升级时由迁移删除）：
> 插件不该替站点决定"谁该有什么权限"。请按自己的分工在「角色与权限」页自建角色并勾选权限点。
> 新建用户也**不会再自动获得角色**（首个用户仍自动成为 `administrator`），需要显式分配。

未声明的权限点（第三方插件在补上声明之前）会以「未登记」分组出现在权限目录里，
**仍然可以分配给角色** —— 鉴权按权限点标识比对，与是否声明无关。

> **`plugin.install` 与 `plugin.manage` 是刻意分开的**：安装会在服务器上执行插件代码（含依赖安装与构建脚本），
> 因此后台安装时需要勾选"已知晓风险"的确认框，并写入审计。

---

## 后台 API 一览（供调试参考）

所有后台接口挂在 `/api/admin/*`，统一经过守卫链：**认证 → CSRF（写方法）→ 权限（fail-closed）→ 业务 → 审计**。

| 类别 | 路径 |
| --- | --- |
| 会话与本人 | `GET/POST/DELETE /session`、`GET /me`、`PUT /me`、`POST /me/password` |
| 系统 | `GET /dashboard`、`GET /menu`、`GET/PUT /site`、`GET /system/state`、`POST /system/restart`、`GET /audit`、`GET /capabilities`、`GET /logs`、`/backup/*` |
| 主题 | `GET /themes`、`POST /themes/install`、`GET/PUT /themes/:themeId/settings`、`.../settings/reset`、`.../settings/rollback`、`POST /themes/:themeId/preview`、`POST /themes/:themeId/activate`、`DELETE /themes/:themeId` |
| 插件 | `GET /plugins`、`POST /plugins/:pluginId/enable`、`.../disable`、`POST /plugins/install`、`POST /plugins/install/source`、`POST /plugins/:pluginId/update`、`.../remove`、`GET /plugins/catalog`、`GET /plugins/updates`、`GET /plugins/jobs[/:jobId]`、`GET/PUT /plugins/:pluginId/settings` |
| 扩展 | `GET /extensions`、`GET /content-fields` |
| 插件业务 | 由各插件注册，见对应插件 README（如 `/posts`、`/pages`、`/media`、`/terms`、`/users`、`/roles`、`/navigation/items`、`/comments`） |

---

## 相关页面

- [[主题与外观|Themes]]
- [[插件安装与更新|Plugins-Install-and-Update]]
- [[官方插件一览|Plugins-Overview]]
- [[命令行参考|CLI-Reference]]
