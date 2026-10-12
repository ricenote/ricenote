# 起步：目录即插件

一个 RiceNote 插件就是**一个目录**，目录里有 `manifest.json` 与它声明的入口文件。

```
my-plugin/
├── manifest.json      # 清单：身份、能力、依赖、后台页面、设置
├── package.json       # 仅本地开发/构建需要（发布时也对齐版本）
├── src/index.ts       # 源码（构建后到 dist/）
├── dist/index.js      # 入口（manifest.entry 指向它）
└── migrations/        # 可选：SQL 迁移
```

**最简形态**只需要 `manifest.json` + `entry` 指向的一个 JS 文件。

---

## 1. 最小合法 manifest

```json
{
  "schemaVersion": 1,
  "id": "acme.example",
  "name": "示例插件",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",
  "entry": "./dist/index.js"
}
```

这 6 个字段是 `required`，且 schema 设了 `additionalProperties: false`
（**写错字段名会直接校验失败**，不会静默忽略）。

各字段的完整说明见 [[manifest 逐字段参考|Development/Plugin-API/Manifest-Reference]]。

---

## 2. 最小插件

```ts
import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';

export default definePlugin({
  async start(ctx: PluginContext) {
    ctx.logger.info('插件已启动');
  }
});
```

`definePlugin` 是一个**恒等函数**，唯一作用是保留类型推导。

### 三个生命周期钩子（全部可选）

| 钩子 | 何时调用 | 应该做什么 | **不应**做什么 |
| --- | --- | --- | --- |
| `setup(ctx)` | 早期：注册迁移、准备静态资源 | 声明式注册工作 | **不要注册路由** |
| `start(ctx)` | 依赖就绪、迁移完成后 | 注册路由 / 订阅事件 / 提供服务 / 注册插槽与扩展点 | 不要假设"无依赖关系的其它插件已启动" |
| `stop(ctx)` | 停用或关机时 | 释放资源、上报状态 | —— |

三个钩子都可以是同步或异步（返回 `void | Promise<void>`）。

---

## 3. 能力必须显式声明

**插件能调用哪些 Core API，完全由 `manifest.json` 的 `capabilities` 决定。**
未声明的能力**不会静默降级**，而是拿到一个"拒绝桩"，调用即抛 `RN_FORBIDDEN`（403），
错误信息里会指出缺哪个能力。

```json
"capabilities": ["routes:public", "database:own", "events:subscribe"]
```

12 项能力全清单：

| 能力 | 解锁的 API |
| --- | --- |
| `database:own` | `ctx.db.*`（否则 `ctx.db` 是拒绝桩） |
| `routes:public` | `ctx.routes.page()`、`ctx.routes.raw()`（公开） |
| `routes:admin` | `ctx.routes.adminApi()`、`ctx.routes.raw({ capability: 'routes:admin' })` |
| `services:provide` | `ctx.services.provide()` |
| `services:consume` | `ctx.services.use()` / `tryUse()` |
| `events:publish` | `ctx.events.emit()` |
| `events:subscribe` | `ctx.events.on()` |
| `slots:register` | `ctx.slots.register()` |
| `extensions:declare` | `ctx.extensions.declare()` |
| `extensions:contribute` | `ctx.extensions.contribute()` |
| `admin:menu` | `ctx.adminMenu.add()`（声明式 `admin.pages` 不需要） |
| `media:store` | 媒体存储写入 |

> 设计意图：**审查一个插件安全不安全，先看它的 `capabilities`**。
> 能力面就是它的权限面，必须显式且最小。

---

## 4. 两条必须遵守的启动期约定

### 4.1 不要在 `start()` 里做"需要其它插件已就绪"的初始化

拓扑排序只保证**依赖在前**，**不保证**没有相互依赖关系的插件之间的先后顺序。
因此"我要在 posts 插件启动后做点什么"这类逻辑**不能靠 `start()` 的顺序**。

✅ 正确做法：挂到生命周期事件 `core.runtime.started.v1` 上。

```ts
ctx.events.on('core.runtime.started.v1', async ({ started, failed, excluded }) => {
  // 此刻所有插件都已启动（failed / excluded 是被剔除的插件 ID）
});
```

> 真实案例：`rice.identity` 曾直接在 `start()` 里创建初始管理员并发事件，
> 而此时 `rice.authorization` 还没订阅 → 管理员拿不到角色。现在改为订阅该事件后再执行。

### 4.2 可选依赖必须在**请求期**惰性解析

`tryUse()` 在 `start()` 阶段可能返回 `undefined`（即使那个插件最终会启动）——
这是"假阴性"，不能据此做永久判断。

```ts
// ❌ 在 start 里缓存判断，可能永久错过
const taxonomy = ctx.services.tryUse<ContentTaxonomyService>('content.taxonomy@1');

// ✅ 每次要用时再解析
function taxonomyOf(ctx: PluginContext) {
  return ctx.services.tryUse<ContentTaxonomyService>('content.taxonomy@1');
}
```

`rice.posts` 对 `content.taxonomy@1`、`media.library@1`、`identity.users@1` 三个可选依赖
全部采用请求期解析；依赖可用性在 `core.runtime.started.v1` 回调里上报（供诊断展示）。

### 4.3 第三条硬承诺：停用后"零残留"

`stop()` 里**应当**调用你在 `start()` 中拿到的所有 `Dispose` / `Unsubscribe` 句柄；
即使你忘了，Core 也会**兜底释放**你注册的一切（路由 / 服务 / 插槽 / 事件 / 菜单 / 扩展点），
并由零残留断言在测试中检查。

因此"插件可独立启停"是可测试承诺，而不是口头约定。

---

## 5. 一个真实的 20 行级插件

这是仓库里 `plugins/third-party/reading-time` 的核心逻辑（真实代码）：

```ts
import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';

export default definePlugin({
  async start(ctx: PluginContext) {
    const wordsPerMinute = ctx.config.get('wordsPerMinute', 300);
    const showWordCount = ctx.config.get<boolean>('showWordCount', true);
    const label = ctx.config.get('label', '阅读时长');

    ctx.slots.register('post.beforeContent', {
      name: 'acme.reading-time',
      render(context) {
        const post = context.data.post as { html?: unknown } | undefined;
        const text = extractText(post?.html);
        if (text.length === 0) return '';
        const words = countWords(text);
        const minutes = Math.max(1, Math.ceil(words / wordsPerMinute));
        const wordsPart = showWordCount ? ` · 约 ${words} 字` : '';
        return `<p class="acme-reading-time">${label} 约 ${minutes} 分钟${wordsPart}</p>`;
      }
    });

    ctx.logger.info('阅读时长插件已就绪', { wordsPerMinute, showWordCount, label });
  },

  async stop(ctx: PluginContext) {
    // Slot 由 Core 统一注销，这里只需报告状态
    ctx.logger.info('阅读时长插件已停止');
  }
});
```

它的 manifest 声明了**一个能力**：

```json
{
  "schemaVersion": 1,
  "id": "acme.reading-time",
  "name": "阅读时长",
  "version": "1.1.0",
  "apiVersion": "^1.0.0",
  "author": "Acme Studio",
  "license": "MIT",
  "entry": "./dist/index.js",
  "capabilities": ["slots:register"]
}
```

注意 `ctx.config.get(key, fallback)` 拿到的是**已经合并过默认值**的配置：
合并顺序为 `manifest.settings`（旧写法）→ `manifest.settingsSchema` 的字段 `default` → 数据库覆盖值。

> ⚠️ 一个容易踩的坑：`post.html` 有两种形态 —— 普通字符串，或渲染器注入的**受信句柄**（带 `value` 字段）。
> 插件里要兼容两者，否则会拿到 `undefined`（示例中的 `extractText()` 就是干这个的）。

---

## 6. 接下来

- 字段细节 → [[manifest 逐字段参考|Development/Plugin-API/Manifest-Reference]]
- 每个 API 的签名与边界 → [[PluginContext 逐方法参考|Development/Plugin-API/Context-Reference]]
- 与其它插件协作 → [[跨插件服务契约|Development/Plugin-API/Service-Contracts]]
- 做后台界面 → [[插件自带后台界面|Development/Plugin-API/Admin-UI]]
- 暴露可配置项 → [[声明式设置表单|Development/Plugin-API/Settings]]
- **端到端走一遍** → [[完整教程：从零写插件|Development/Plugin-API/Tutorial]]
