# 开发者文档导航

这里的文档比仓库 `docs/` 目录更**逐项**、更**贴近源码**：API 逐方法展开、内核机制讲清实现与取舍、并且有一条从零写插件的完整教程。

> 仓库 `docs/` 仍然是**权威设计文档**（架构总览、Plugin API v1、Theme API v1、扩展点清单、17 篇 ADR）。
> 本 wiki 的开发者页面会在需要深挖时给出对应的绝对链接。

---

## 推荐阅读路线

### 路线 A：我要写一个插件

```
起步  →  教程  →  参考  →  （按需）原理
```

1. [[起步：目录即插件|Plugin-API-Getting-Started]] —— 心里先有"插件长什么样"。
2. [[完整教程：从零写插件|Plugin-API-Tutorial]] —— **跟着敲一遍**，从脚手架到打包发布。
3. [[manifest 逐字段参考|Plugin-API-Manifest-Reference]] —— 写清单时查。
4. [[PluginContext 逐方法参考|Plugin-API-Context-Reference]] —— 写代码时查。
5. 需要与别的插件协作 → [[跨插件服务契约|Plugin-API-Service-Contracts]]
6. 要做界面 → [[插件自带后台界面|Plugin-API-Admin-UI]]
7. 要暴露配置 → [[声明式设置表单|Plugin-API-Settings]]
8. 想理解为什么这么设计 → [[插件生命周期与依赖解析|Architecture-Plugin-Lifecycle]]

### 路线 B：我要写一个主题

1. [[主题包结构与契约|Theme-API-Overview]]
2. [[模板变量与过滤器|Theme-API-Template-Reference]]
3. [[挂载点清单|Theme-API-Slots]]
4. [[主题设置与多语言|Theme-API-Settings]]

### 路线 C：我要改内核 / 读懂实现

按**一次请求的生命周期**读最顺：

1. [[启动时序|Architecture-Core-Bootstrap]] —— 进程起来时发生了什么。
2. [[插件生命周期与依赖解析|Architecture-Plugin-Lifecycle]] —— 插件是怎么被组织起来的。
3. [[渲染与缓存|Architecture-Render-Pipeline]] —— 一次前台请求如何变成 HTML。
4. [[安全控制面|Architecture-Security]] —— 一次后台写请求要过几道关。
5. [[数据层与迁移|Architecture-Data-and-Migrations]] —— 数据所有权与演进。
6. [[命名扩展点注册表|Architecture-Extension-Registry]] —— 插件之间如何互相扩展。
7. [[分层与数据所有权|Architecture-Overview]] —— 回到全局视角。

---

## 页面索引

| 页面 | 一句话 |
| --- | --- |
| [[分层与数据所有权\|Architecture-Overview]] | 总体分层、模块职责边界、谁拥有哪些表 |
| [[启动时序\|Architecture-Core-Bootstrap]] | `bootstrap()` 的每一步及其失败后果 |
| [[插件生命周期与依赖解析\|Architecture-Plugin-Lifecycle]] | 状态机、capability 解析、拓扑排序、零残留断言 |
| [[渲染与缓存\|Architecture-Render-Pipeline]] | 模板查找、插槽占位符替换、HTML 缓存键与标签失效 |
| [[数据层与迁移\|Architecture-Data-and-Migrations]] | 连接池、事务、表命名约束、迁移锁与校验值 |
| [[安全控制面\|Architecture-Security]] | 会话、CSRF、能力白名单、限流、审计、脱敏 |
| [[命名扩展点注册表\|Architecture-Extension-Registry]] | 三作用域统一模型、append/replace、后台下发 |
| [[起步：目录即插件\|Plugin-API-Getting-Started]] | 最小可运行插件与两条启动期约定 |
| [[manifest 逐字段参考\|Plugin-API-Manifest-Reference]] | 每个字段的类型、约束与常见错误 |
| [[PluginContext 逐方法参考\|Plugin-API-Context-Reference]] | 每个门面方法的签名、返回值与抛错 |
| [[跨插件服务契约\|Plugin-API-Service-Contracts]] | 每个契约的逐方法语义与降级行为 |
| [[插件自带后台界面\|Plugin-API-Admin-UI]] | 零构建入口、四态宿主、SDK 契约 |
| [[声明式设置表单\|Plugin-API-Settings]] | 字段类型、校验、合并写入与生效时机 |
| [[完整教程：从零写插件\|Plugin-API-Tutorial]] | 端到端手把手（含可复制代码） |
| [[主题包结构与契约\|Theme-API-Overview]] | `theme.json` 字段与模板回退链 |
| [[模板变量与过滤器\|Theme-API-Template-Reference]] | 上下文对象与全部 helper/filter |
| [[主题设置与多语言\|Theme-API-Settings]] | 三层配置、乐观锁、多语言解析 |
| [[挂载点清单\|Theme-API-Slots]] | 9 个标准插槽与渲染约定 |
| [[扩展点全量清单\|Hooks-Inventory]] | 一张表查完所有扩展点 |
| [[架构决策记录索引\|ADR]] | ADR-001 ~ ADR-017 |
| [[维护与发布指南\|Contributing]] | 如何加 wiki 页面、如何发布、常用命令 |

---

## 事实来源与约定

写这些文档时使用的**事实来源**（你可以自行核对）：

| 主题 | 源码位置 |
| --- | --- |
| 插件契约 | `packages/plugin-sdk/src/`、`packages/shared/manifests/plugin.schema.json` |
| 主题契约 | `packages/theme-sdk/src/`、`packages/shared/manifests/theme.schema.json` |
| 设置表单 | `packages/shared/manifests/settings.schema.json` |
| 内核实现 | `packages/core/src/`（`bootstrap.ts`、`plugins/`、`render/`、`themes/`、`database/`、`security/`、`extensions/`） |
| 后台界面 SDK | `packages/admin-sdk/src/` |
| HTTP 层与 CLI | `apps/server/src/` |
| 官方插件范例 | `plugins/official/*`、`plugins/third-party/reading-time` |

**约定**：本 wiki 只描述**当前代码实际行为**。若发现文档与实现不一致，以实现为准，并欢迎提 issue —— 已知的若干处偏差记录在 [[常见问题|FAQ]]。
