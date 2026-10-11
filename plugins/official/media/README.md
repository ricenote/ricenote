# rice.media —— 媒体库

文件上传、媒体元数据登记与公开访问。主题设置中的 `image` 字段、文章封面、
站点 Logo 保存的都是这里的**媒体 ID 或访问地址**。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.media` |
| version | `1.0.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `media.library@1` |
| requires | 无 |
| capabilities | `database:own`、`services:provide`、`services:consume`、`routes:admin`、`routes:public`、`media:store`、`admin:menu` |
| migrations | `0001_media.sql` |
| 数据表 | `rn_media` |

> 磁盘文件存放在受管目录 `storage/uploads` 之下，数据库保存**相对路径**，
> 迁移部署目录时无需改数据。

## 扩展点（Hook）

### 原始路由（公开）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/media/:mediaId` | 按 ID 反查落盘路径后回传文件；带长缓存与 `nosniff` |

SVG 额外加 `Content-Security-Policy: default-src 'none'; …; sandbox`，
避免同源上下文中以内联脚本的形式执行。

### 管理 API（权限点 `media.manage`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/media` | 分页列表（可按文件名搜索） |
| POST | `/api/admin/media` | multipart 上传（站点设置里的 Logo/图标上传也走它） |
| DELETE | `/api/admin/media/:mediaId` | 删除记录与磁盘文件 |

### 服务契约（提供）

`media.library@1`：`list` / `findById` / `save` / `remove` / `countAll`。

`save` 的输入是 `{ fileName, mimeType, buffer, alt?, uploaderId? }`，
调用方（其他插件）不需要关心落盘路径。

### 服务契约（消费）

`core.setup@1`（必需）：取 `siteId()` 与受管目录 `paths().uploadsDir`。

### 事件 / 插槽

无。

### 后台菜单

`{ id: 'media.library', label: '媒体库', path: '/media', icon: 'Image', order: 10, permission: 'media.manage' }`

## 设置项（`settingsSchema`，后台自动生成表单）

后台「扩展中心 → 媒体库 → 设置」。保存后需**重启服务**生效。

### 分组「上传」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `maxFileBytes` | number（1024–67108864） | `8388608`（8MB） | 单文件大小上限（传输层上限见 `MAX_UPLOAD_BYTES`） |

> 插件侧会把该值再收敛到 `1KB ~ 64MB`，避免历史脏值让限制失效。

## 安全要点

- 上传文件名不可信：先 `path.basename` + 白名单字符清洗，再随机化文件名；
- 扩展名白名单：`png/jpg/jpeg/gif/webp/avif/svg/pdf/txt/md/zip`；
- MIME 由扩展名推断，不信任客户端声明；
- 落盘前归一化路径并断言仍在 `uploads/` 内（防路径穿越）。

## 依赖与启停

- 可独立启停；
- 禁用后：`/media/:id` 与上传接口消失，`media.library@1` 注销；
  posts 会降级为"按 ID 约定拼接 `/media/{id}`"的访问方式（不报错）；
  后台站点设置的 Logo 上传会失败并提示改用外部地址。
