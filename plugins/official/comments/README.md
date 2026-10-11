# rice.comments —— 评论

访客评论的完整实现：嵌套回复、四态审核状态机、关键词黑名单与提交频率限制，
并通过 `post.comments` 插槽把评论线程注入文章页。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.comments` |
| version | `1.0.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `content.comments@1` |
| requires | 无（`content.posts@1` 为软依赖） |
| capabilities | `database:own`、`services:provide`、`services:consume`、`routes:public`、`routes:admin`、`events:publish`、`slots:register`、`admin:menu` |
| migrations | `0001_comments.sql` |
| 数据表 | `rn_comments` |

## 扩展点（Hook）

### 原始路由（公开）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/comments/submit` | 访客提交评论（受频率限制与关键词黑名单约束） |
| GET | `/api/comments` | 按 `postId` 读取已通过评论（线程化，邮箱脱敏） |

> 用原始路由而非页面路由：评论是站内局部交互（表单提交与数据读取），
> 不产生独立页面，也不需要主题渲染。

### 管理 API（权限点 `comment.moderate`）

| 方法 | 路径 |
| --- | --- |
| GET | `/api/admin/comments` |
| GET | `/api/admin/comments/counts` |
| POST | `/api/admin/comments/moderate` |

### 插槽

| 插槽 | 组件名 | 说明 |
| --- | --- | --- |
| `post.comments` | `comments.thread` | 输出评论列表 + 提交表单 |

主题侧写法（两套官方主题均已接入）：

```njk
{% if has_feature('comments') %}
  <section class="rn-comments">
    <h2>评论</h2>
    {{ slot('post.comments', { postId: post.id }) }}
  </section>
{% endif %}
```

### 服务契约

提供 `content.comments@1`：`listApprovedThreaded` / `submit` / `listForAdmin` / `moderate` /
`countByStatus` / `countsForPosts` / `recent`。

消费：

| 契约 | 必需性 | 用途 |
| --- | --- | --- |
| `core.html@1`、`core.theme@1` | 必需 | 评论正文消毒、缓存失效 |
| `content.posts@1` | 可选 | 后台列表显示所属文章标题（`titlesOf`） |
| `identity.users@1` | 可选 | 关联已登录用户 |

### 事件

本插件**不发布事件**，也不订阅事件。

### 后台菜单

`{ id: 'comments.moderate', label: '评论审核', path: '/comments', icon: 'MessageSquare', order: 20, permission: 'comment.moderate' }`

## 审核状态机

```
pending（待审） ──approve──▶ approved（通过）
      ▲                          │
      │                          ├─spam──▶ spam（垃圾）
      └──────── pending ◀────────┤
                                 └─trash─▶ trash（回收）
```

后台批量操作支持 `approve` / `pending` / `spam` / `trash` / `delete`。

## 设置项（`settingsSchema`，后台自动生成表单）

后台「扩展中心 → 评论 → 设置」。保存后需**重启服务**生效（`ctx.config` 是插件启动期快照）。

### 分组「通用」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否开放评论区（关闭后插槽不输出任何内容） |
| `requireApproval` | boolean | `true` | 新评论是否进入待审 |
| `pageSize` | number（1–100） | `20` | 线程分页大小 |
| `maxLength` | number（1–20000） | `2000` | 正文长度上限 |
| `maxDepth` | number（1–10） | `5` | 嵌套回复最大深度 |

### 分组「反垃圾」

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `rateLimitWindowSeconds` | number（0–86400） | `60` | 频率限制窗口（`0` 关闭该限制） |
| `rateLimitMaxSubmissions` | number（0–100） | `3` | 窗口内最多提交次数（`0` 关闭该限制） |
| `maxLinksPerComment` | number（0–100） | `2` | 单条评论允许的链接数（超限判为垃圾） |
| `blockedKeywords` | stringList（≤200 项） | `[]` | 关键词黑名单（命中即判为垃圾），表单里每行一项 |

## 安全要点

- 评论正文经 `core.html@1` 消毒后才存库与输出，前台只输出 `TrustedHtml`；
- 前台输出邮箱一律脱敏，后台列表才展示完整邮箱；
- 提交频率按 IP 哈希统计，不存储明文 IP；
- 评论插件不直接查询 `rn_posts`：文章标题通过 `content.posts@1.titlesOf()` 批量获取，
  避免 N+1 与跨插件联表。

## 依赖与启停

- 无硬依赖，可独立启停；
- 禁用后 `post.comments` 插槽为空片段，主题无需改动（`has_feature('comments')` 会返回 false）。
