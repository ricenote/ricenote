# RiceNote Wiki

**RiceNote** 是插件优先的轻量级博客与内容管理系统（CMS）：内核只提供引导、安全边界、注册表与渲染基础设施，文章、页面、导航栏、分类标签、媒体、用户与权限、评论、搜索、SEO **全部以独立插件实现**，可独立开发、启停与升级。

- **小内核**：Core 不含业务概念，只管"怎么把插件安全地组织起来"。
- **业务皆插件**：14 个官方插件覆盖内容网站的完整能力，可按需启用。
- **插件自带后台界面**：插件在 `admin/` 下写零构建的前端模块即可获得完整管理页面。
- **三路来源安装插件**：npm Registry / Git 仓库 / 本地目录（含压缩包），后台与 CLI 共用同一套编排、任务队列与实时日志。
- **零构建主题**：主题 = `theme.json` + `templates/*.njk` + `assets/*`，只需 HTML/CSS 与可选 JavaScript。
- **易部署**：面向个人 VPS，提供 Docker Compose（MySQL 8.4 + server + Nginx）。

当前版本：**0.8.0** ｜ 许可：MIT ｜ 仓库：[ricenote/ricenote](https://github.com/ricenote/ricenote)

---

## 从这里开始

### 我要把站点跑起来

| 页面 | 说明 |
| --- | --- |
| [[快速开始\|Getting-Started]] | 环境要求、安装依赖、一条命令走完安装向导、访问站点 |
| [[安装向导\|Installation]] | `pnpm run setup` 的全部参数、必须安装的两项插件、手工安装高级路径 |
| [[环境变量参考\|Configuration]] | 逐个环境变量的含义、默认值与"改完要不要重启" |

### 我要把它部署到服务器

| 页面 | 说明 |
| --- | --- |
| [[容器化部署与反向代理\|Deployment]] | Docker Compose 三服务拓扑、Nginx、监听端口与 `SITE_URL` 的区别 |
| [[升级已部署实例\|Upgrading]] | 插件自助更新与程序本体更新两条流程、迁移的三条硬注意事项 |
| [[故障排查\|Troubleshooting]] | 启动、迁移、插件、主题、后台、前台六类问题的排查顺序 |
| [[常见问题\|FAQ]] | 从真实缺陷里提炼的坑与语义约定 |

### 我要用后台管理内容

| 页面 | 说明 |
| --- | --- |
| [[后台功能导览\|Admin-Guide]] | 每个后台页面的职责，以及权限点与角色的对应关系 |
| [[命令行参考\|CLI-Reference]] | `plugin` / `theme` / `validate` / `migrate` / `setup` 子命令与参数 |
| [[主题与外观\|Themes]] | 主题结构与三层配置模型、声明式设置表单、页面模板选择 |
| [[官方插件一览\|Plugins-Overview]] | 13 个官方插件的用途、能力与相互依赖 |
| [[插件安装与更新\|Plugins-Install-and-Update]] | 三路来源、任务队列、失败回滚、更新检查 |

### 我要写插件或主题

建议按 **教程 → 参考 → 原理** 的顺序读：

1. [[从零写一个插件（完整教程）\|Plugin-API-Tutorial]] —— 从脚手架到打包发布，含可直接复制的代码。
2. [[manifest.json 逐字段参考\|Plugin-API-Manifest-Reference]] 与 [[PluginContext 逐方法参考\|Plugin-API-Context-Reference]] —— 写代码时查这一层。
3. [[Theme API\|Theme-API-Overview]] —— 写主题时看这里。
4. [[内核机制剖析\|Architecture-Overview]] —— 想知道"它为什么这么设计"时再读。

其余入口见 [[开发者文档导航\|Development]]。

---

## 本 wiki 的组织方式

- 本 wiki 的**内容源**在仓库的 [`wiki/`](https://github.com/ricenote/ricenote/tree/main/wiki) 目录，通过 `pnpm wiki:publish` 同步发布，见 [[维护与发布指南|Contributing]]。
- 更深入的实现细节与全部架构决策记录在仓库 [`docs/`](https://github.com/ricenote/ricenote/tree/main/docs) 目录；本 wiki 的开发者页面会给出对应的绝对链接。
- 版本变更见 [CHANGELOG.md](https://github.com/ricenote/ricenote/blob/main/CHANGELOG.md)。
