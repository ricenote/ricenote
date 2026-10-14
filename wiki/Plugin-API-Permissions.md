# 权限点声明与角色分配

插件里但凡有「需要登录才能用」的入口，就要有一个权限点（permission）守着。本页讲清四件事：
**什么时候需要**、**怎么声明**、**声明错了会怎样**、**声明之后谁来授权**。

> 字段定义看 [[manifest 逐字段参考|Plugin-API-Manifest-Reference]] 第 8 节；
> 后台侧怎么分配角色看 [[后台功能导览|Admin-Guide]]；
> 内核怎么校验与聚合看 [ADR-018](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-018-plugin-permission-declarations.md)。

---

## 1. 什么时候需要权限点

只有**需要认证的入口**才配权限点，公开页面不需要：

| 入口 | 写在哪里 | 登记时机 |
| --- | --- | --- |
| 后台页面 | `manifest.admin.pages[].permission` | 加载期（静态） |
| 扩展点贡献（admin 作用域） | `manifest.contributions[].permission` | 加载期（静态） |
| 管理 API | `ctx.routes.adminApi({ permission })` | 插件 `start()` 运行期 |
| 后台菜单（命令式） | `ctx.adminMenu.add({ permission })` | 插件 `start()` 运行期 |

`.env` 那种"整站开关"不该用权限点表达；权限点回答的是**"哪个用户能做这件事"**。

> 鉴权与声明是**解耦**的：上面四处写的都是**标识字符串**，安全网关只做字符串比对
> （问 authorization 的 resolver「这个人有没有 `post.publish`」）。
> 声明影响的是**目录展示与归属**，不参与鉴权判断。

---

## 2. 怎么声明

在自己的 `manifest.json` 里用 `permissions` 数组声明**你拥有的**权限点：

```json
{
  "permissions": [
    {
      "key": "notice.manage",
      "label": { "zh-CN": "管理公告条", "en": "Manage the notice bar" },
      "group": { "zh-CN": "内容", "en": "Content" }
    }
  ]
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `key` | ✅ | 必须是 `<域>.<动作>`：全小写、以字母开头、两段都允许短横线（正则 `^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$`），≤ 80 字符，**全局唯一** |
| `label` | ✅ | 展示名（`localizedText`：字符串或多语言对象），会直接显示给站点管理员 |
| `group` | ✅ | 权限目录里的分组名（同样是 `localizedText`），自由文案，同站点内保持一致即可 |

数组最多 40 项。

### 命名约定

`key` 的**域**表达业务归属，**与插件 ID 无关**（`rice.posts` 声明的是 `post.*` 而不是 `rice.posts.*`）。
仓库现有官方插件的实际用法可以直接照抄：

| 域 | 拥有者 | 现有权限点 |
| --- | --- | --- |
| `post.` | `rice.posts` | `post.view` / `post.write` / `post.publish` / `post.delete` |
| `page.` | `rice.pages` | `page.view` / `page.manage` |
| `taxonomy.` | `rice.taxonomy` | `taxonomy.manage` |
| `media.` | `rice.media` | `media.manage` |
| `comment.` | `rice.comments` | `comment.moderate` |
| `nav.` | `rice.navigation` | `nav.view` / `nav.manage` |
| `link.` | `rice.friend-links` | `link.view` / `link.manage` |

动作词汇的惯例：`view` = 只读（能进页面、能看列表）；`manage` = 增删改；需要更细的颗粒度时再拆
`write` / `publish` / `delete` / `moderate`（参考 `post.*`）。

**一条经验**：只读入口也给它一个 `xxx.view`，否则"能进后台但只能看"的角色无法表达，
管理员就只能把 `xxx.manage` 一起给出去。

---

## 3. 声明错了会怎样

两条规则**刻意不对称**，启动期与 `pnpm validate` 用的是同一份实现：

| 情况 | 结果 |
| --- | --- |
| 同一标识被两方声明（两个插件，或插件与 Core 撞车） | **错误**：`RN_MANIFEST_INVALID`，启动失败、`pnpm validate` 失败 |
| 同一方重复声明同一标识 | **错误**：`RN_MANIFEST_INVALID` |
| `key` 不符合 `<域>.<动作>` | **错误**：`RN_MANIFEST_INVALID` |
| 某个标识**被使用但无人声明** | **仅告警**：插件照常工作 |

报错文案里会点名谁在声明，例如：

```
权限点重复声明：nav.manage（已由 rice.navigation 声明）
```

**为什么"用了没声明"只告警**：鉴权按标识字符串比对，与是否声明无关，所以漏声明不该让站点起不来。
代价是权限目录里这一项**没有中文名**，会落到「未登记」分组。启动日志会给出汇总：

```
存在被使用但未声明的权限点（鉴权不受影响；建议在对应插件的 manifest.permissions 中声明）
  count: 2  items: ["notice.manage ← acme.notice", …]
```

「未登记」的权限点**仍然可以分配给角色**（不会从目录里消失），所以第三方插件在补齐声明之前不会变成"不可用"。

---

## 4. 不要重复声明 Core 的权限点

控制面权限点由内核声明（`packages/core/src/security/permissions.ts`），插件**不得**再声明一遍——
否则按第 3 节第一条直接判为冲突：

| 权限点 | 分组 | 说明 |
| --- | --- | --- |
| `theme.view` / `theme.manage` | 外观 | 外观中心 |
| `plugin.view` / `plugin.manage` / `plugin.install` | 扩展 | 扩展中心；`plugin.install` 刻意与"启停配置"分开（等同授予服务器代码执行） |
| `user.manage` | 用户 | **跨插件共用**：identity 的 `/users*` 与 authorization 的 `/roles` 都校验它，因此由 Core 声明 |
| `system.audit` / `system.maintain` / `system.restart` | 系统 | 操作日志、系统维护、重启服务 |

> `user.manage` 是"共用权限点"的样板：你的插件如果要复用别的插件的权限点，
> 直接用那个标识即可（**不要**自己声明），归属问题交给 Core 或原声明方。

---

## 5. 声明之后：谁来授权

**声明只让权限点出现在目录里，不会自动授予任何人。**

- 内置角色自 `0.5.4` 起**只剩 `administrator`**（权限集合为 `*`，因此天然拥有你新加的权限点）。
  早期那种"插件安装时顺带把权限点授予 editor / author"的做法已随内置角色一起移除。
- 因此你新声明的权限点**默认没有任何角色持有**，需要站点管理员去
  后台「角色与权限」（`/roles`，需 `user.manage`）**自建角色** → 勾选权限点 → 保存 →
  再在用户身上分派该角色。
- manifest 里**没有**、也不应有"把权限点授予某内置角色"的字段：权限分派是**站点配置**，不是插件元数据。
  插件应当只负责"把权限点声明清楚"，把"给谁"留给站点管理员。

这一点对插件作者的实际影响：**在 README 里写清楚新权限点需要管理员去建角色**，
并说明"不给会怎样"（通常是入口在后台菜单里直接不显示）。

---

## 6. 自查：怎么确认声明没漏

1. `pnpm validate` —— 与启动期同一份校验，能抓到**冲突/格式错误**与**加载期可见的漏声明**
   （`admin.pages` / `contributions` 两处静态使用）。
2. 启动日志 —— 运行期注册的 `ctx.routes.adminApi` / `ctx.adminMenu.add` **CLI 看不到**，
   这类漏声明靠启动时的告警兜住。启动后搜一遍"未声明的权限点"。
3. 后台「角色与权限」—— 权限目录里若出现**「未登记」分组**，说明有标识被用了却没声明。
4. 想程序化读结果：`core.security@1` 的 `listDeclaredPermissions()` 返回
   `{ key, label, group, declaredBy, usedBy }`，`declaredBy` 为 `null` 表示由 Core 声明。

> 权限点在**插件发现阶段**登记，**包含未启用的插件** ——
> 因此管理员可以先按目录建好角色，再启用插件。

---

## 7. 宿主版本要求

`permissions` 是 **`0.5.4` 引入**的 manifest 字段，而 manifest schema 设了 `additionalProperties: false`：
**旧宿主读到未知字段会直接判定清单非法**（装不上或启动失败）。

所以声明了 `permissions` 的插件，`package.json` 里的宿主区间**必须写在 `^0.5.4` 及以上**：

```json
{
  "peerDependencies": {
    "@ricenote/plugin-sdk": "^x.y.0",
    "@ricenote/shared": "^x.y.0"
  }
}
```

其中 `x.y` 取**宿主的次版本**（宿主为 `A.B.z` 时写 `^A.B.0`）。区间语义与升级规则见
[[插件安装与更新|Plugins-Install-and-Update]] 的「关于宿主版本区间」。
不声明 `permissions` 的插件不受影响 —— 该字段是**可选**的。

---

## 相关页面

- [[manifest 逐字段参考|Plugin-API-Manifest-Reference]]（第 8 节：字段级约束）
- [[插件自带后台界面|Plugin-API-Admin-UI]]（后台页面与 `permission` 字段）
- [[PluginContext 逐方法参考|Plugin-API-Context-Reference]]（`ctx.routes.adminApi` / `ctx.adminMenu`）
- [[后台功能导览|Admin-Guide]]（管理员视角：角色与权限页怎么用）
- [[扩展点全量清单|Hooks-Inventory]]（现有权限点与后台菜单总表）
- [[安全控制面|Architecture-Security]]（网关如何按标识字符串鉴权）
