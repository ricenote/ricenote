# 插件自带后台界面

插件可以在 `admin/` 下写**零构建**的前端模块，就获得一个完整的后台页面：
不装前端依赖、不打包、不需要构建步骤。

这是 [ADR-014](https://github.com/ricenote/ricenote/blob/main/docs/adr/ADR-014-plugin-owned-admin-ui.md) 的核心决策：
**后台界面交还给插件，Core 只保留通用宿主。**

---

## 1. 先看一个真实文件的开头

`plugins/official/navigation/admin/main.js`：

```js
/**
 * 导航栏插件的后台界面（零构建）。
 *
 * 这是一个**纯 ESM 模块**，不经过任何打包：
 * - 依赖全部来自 `/admin-sdk/v1/ricenote-admin.js`（Core 托管，与宿主共用同一份 Vue）；
 * - 组件（Card/Button/DataTable/Dialog/Select/Switch/…）已由宿主全局注册，
 *   因此模板里直接写标签即可，无需 import；
 * - `api` 自带 CSRF 与会话 Cookie 处理。
 */
import {
  api, computed, defineAdminPage, onMounted, ref, useSession, useToast
} from '/admin-sdk/v1/ricenote-admin.js';

export default defineAdminPage({ /* ... */ });
```

三个关键约定：

| 约定 | 说明 |
| --- | --- |
| **import 来源** | 只能从 `/admin-sdk/v1/ricenote-admin.js` 导入 —— 这是 Core 托管的**单实例** SDK |
| **组件全局注册** | `Card` / `Button` / `DataTable` / `Dialog` / `Select` / `Switch` / `Icon` / `Field` … 直接写标签，不用 import |
| **默认导出** | 必须 `export default` 一个由 `defineAdminPage()` 定义的 Vue 组件 |

> **为什么必须从固定 URL 导入**：宿主与插件共用**同一份 Vue 与同一份全局状态**
> （认证状态、提示条、菜单）。如果插件自己带一份 Vue，就会出现"两份实例"——
> 表现为**页面空白但控制台干净**的疑难问题。SDK 的构建期断言会拦住这种产物。

---

## 2. 声明页面

在 `manifest.json` 里声明：

```json
{
  "admin": {
    "pages": [
      {
        "id": "notice.editor",
        "label": "公告",
        "path": "/notice",
        "icon": "Megaphone",
        "order": 60,
        "permission": "post.view",
        "entry": "./admin/main.js",
        "style": "./admin/style.css"
      }
    ]
  }
}
```

- `entry` 必须是 `./admin/*.js`；
- 宿主把它换算为 URL：`./admin/main.js` → `/plugin-admin/<pluginId>/main.js`；
- 该路径的访问要求：**已登录 + 插件已启用 + 路径限定在插件的 `admin/` 目录内**；
- `permission` 决定侧栏是否显示（权限不足则不出现）；
- `hidden: true` 表示**不进侧栏**（编辑器类页面靠深链或列表跳转进入）。

`pnpm validate` 会校验入口文件存在、路径与 ID 全局唯一。

---

## 3. 宿主的四种状态

Core 的通用宿主 `PluginHostView` 负责加载你的模块，并处理四态：

| 状态 | 表现 |
| --- | --- |
| 加载中 | 骨架 / 加载指示 |
| 就绪 | 渲染你的组件 |
| 加载失败 | 错误提示（含重试） |
| 未启用 | 明确提示"插件未启用"，而不是白屏 |

宿主还提供**错误边界**（`onErrorCaptured`）：插件界面出错**只降级当前页**，不会拖垮整个后台。

此外，模块 `import` 失败时会自动追加 `?retry=1` **重试一次**（应对部署后缓存不一致）。

---

## 4. `defineAdminPage`

```ts
defineAdminPage(options: {
  title?: string;
  setup?: () => Record<string, unknown>;   // 标准 Vue setup
  template?: string;                        // 模板字符串
  render?: () => unknown;                   // 或用渲染函数
}): Component
```

最小可用示例：

```js
import { api, defineAdminPage, onMounted, ref, useToast } from '/admin-sdk/v1/ricenote-admin.js';

export default defineAdminPage({
  title: '公告',
  setup() {
    const toast = useToast();
    const message = ref('');
    const saving = ref(false);

    async function load() {
      const data = await api.get('/notice');
      message.value = data.message ?? '';
    }
    async function save() {
      saving.value = true;
      try {
        await api.put('/notice', { message: message.value });
        toast.success('已保存');
      } catch (error) {
        toast.error(error?.message ?? '保存失败');
      } finally {
        saving.value = false;
      }
    }

    onMounted(load);
    return { message, saving, save };
  },
  template: `
    <Card title="站点公告">
      <Field label="公告文案">
        <Textarea v-model="message" :rows="3" />
      </Field>
      <Button :loading="saving" @click="save">保存</Button>
    </Card>
  `
});
```

注意：`Card` / `Field` / `Textarea` / `Button` 都**没有 import** —— 它们由宿主全局注册。

---

## 5. SDK 导出清单

`/admin-sdk/v1/ricenote-admin.js` 除 SDK 自身内容外，还**再导出 Vue 与 Vue Router**，
因此你可以在一个 import 里拿到全部东西。

### Vue 与路由（再导出）

`ref` / `reactive` / `computed` / `watch` / `onMounted` / `onBeforeUnmount` / `nextTick` /
`useRoute` / `useRouter` / `onBeforeRouteLeave` 等。

### 组合式能力

| API | 返回 | 说明 |
| --- | --- | --- |
| `useSession()` | `user` / `ready` / `pending` / `isAuthenticated` / `displayName` / `can(permission)` / `refresh` / `login` / `logout` | 当前登录者与权限判断 |
| `useToast()` | `items` / `push(msg, tone?)` / `success` / `error` / `info` / `warning` / `dismiss(id)` | 提示条 |
| `useSystemState()` | `value` / `restarting` / `phase` / `restartRequired` / `pendingReason` / `refresh` / `markPending(reason?)` / `restart(reason?)`；另有 `isRestartingError(error)` | 待重启与重启进度 |
| `useAsyncData(loader, options?)` | `data` / `loading` / `error` / `reload()` | 异步数据加载 |

### API 客户端

```ts
api.get<T>(path, options?)      api.post<T>(path, body?, options?)
api.put<T>(path, body?, options?)   api.delete<T>(path, options?)
api.raw(method, path, options?)     api.upload<T>(path, formData)
api.list<T>(path, options?)         api.download(path, { method?, body? })
```

- 路径前缀固定 `/api/admin`，所以写 `api.get('/notice')` 实际请求 `/api/admin/notice`；
- 写方法（POST/PUT/DELETE）**自动带 CSRF 令牌**；
- 抛出 `ApiError`，带 `isConflict` / `isUnauthenticated` 判断；
- 另有 `saveBlob(blob, filename)` 用于下载。

### 工具

`cn(...classes)`（clsx + tailwind-merge）、`formatBytes`、`formatDateTime`、`formatDate`、`formatDuration`、
`resolveIcon(name)` / `ICONS`。

### 组件

**原子**：`Badge`、`Button`、`Card`、`Dialog`、`Input`、`Label`、`Select`、`Switch`、`Textarea`、`Toaster`

**复合**：`AdminPage`、`ConfirmDialog`、`DataTable`、`EmptyState`、`Field`、`Icon`、`LoadingState`、`Pagination`、`Tabs`

**额外全局注册**：`ContentFields`（内容自定义字段区，自己按主题声明取数）、`PluginSlot`（扩展点容器）

> 样式方面：SDK 提供了受控的工具类白名单（`safelist`），因此运行时安装的第三方插件也能用到安全子集
> （**不含阴影与毛玻璃类**，符合后台视觉约束）。

---

## 6. 扩展别人的界面：`defineAdminContribution`

除了"整页"，插件还可以往**别人的界面**里插东西（三作用域扩展点的 `admin` 作用域）。

```js
import { defineAdminContribution } from '/admin-sdk/v1/ricenote-admin.js';

export default defineAdminContribution({
  name: 'acme-notice-banner',
  props: ['postId'],                    // ← 必须声明！
  setup(props) {
    return { postId: props.postId };
  },
  template: `<p>当前文章：{{ postId }}</p>`
});
```

在 `manifest.json` 里注册为贡献：

```json
{
  "contributions": [
    { "point": "rice.posts.editorToolbar", "scope": "admin", "mode": "append",
      "order": 10, "entry": "./admin/toolbar.js", "label": "公告按钮" }
  ]
}
```

### ⚠️ `props` 必须声明 —— 一个静默的坑

宿主用 `h(component, context)` 把提供方声明的字段作为 props 传入。而 **Vue 只把组件自己声明过的字段填进 `setup(props)`**，
未声明的同名字段会落进 `ctx.attrs`。

后果：`setup(props)` 静默拿到 `undefined`，表现为「**点了没反应，也不报错**」。

✅ 三种正确做法：

```js
// 1. 声明 props（推荐）
defineAdminContribution({ props: ['postId'], setup(props) { /* props.postId 有值 */ } })

// 2. 从 attrs 读（兜底）
defineAdminContribution({ setup(props, ctx) { const postId = ctx.attrs.postId; } })

// 3. 用 render 函数，参数即上下文
defineAdminContribution({ render: (props) => h('p', props.postId) })
```

### 消费别人的扩展点：`<PluginSlot>`

```js
import { defineAdminPage } from '/admin-sdk/v1/ricenote-admin.js';

export default defineAdminPage({
  title: '文章编辑',
  template: `
    <Field label="正文">
      <PluginSlot name="rice.posts.editorBody" :context="{ postId: 1 }">
        <!-- 默认内容：没有任何贡献时渲染这里 -->
        <Textarea />
      </PluginSlot>
    </Field>
  `
});
```

`<PluginSlot>` 的渲染规则（与注册表一致）：

| 情况 | 结果 |
| --- | --- |
| 没有生效贡献 | 只渲染**默认内容**（默认插槽） |
| 有 `append` 贡献 | 默认内容 + 各贡献按 `order` 降序 |
| 有 `replace` 贡献 | **只渲染胜出者**，默认内容不渲染 |

每条贡献有**独立错误边界**；样式按**引用计数**注入 / 卸载（多个插件共用同一 CSS 不会重复注入，也不会被提前卸载）。

`useAdminExtensions()` 提供底层数据与状态：

```ts
{
  points,                       // 当前登录者可见的扩展点
  contributions,                // 可见的贡献
  ready,                        // 数据是否就绪
  refresh(),                    // 重新拉取
  effectiveFor(point)           // 某个扩展点最终生效的贡献（已按规则裁决）
}
```

数据来源是 `GET /api/admin/extensions`，已按**启用态 + admin 作用域 + 权限**过滤 ——
因此前端不需要也不应该自己做权限判断。

---

## 7. 数据来源与取数

插件界面的数据来自**插件自己的管理 API**（`ctx.routes.adminApi` 注册，路径在 `/api/admin` 下）。

```js
// 页面里
const items = await api.get('/notice/items');

// 插件服务端
ctx.routes.adminApi({
  method: 'GET',
  path: '/notice',
  permission: 'post.view',
  async handler(request, reply) {
    reply.json(await service.load());
  }
});
```

注意 `path` 拼出来的实际地址是 `/api/admin/notice`。

---

## 8. 实现检查清单

| 检查项 | 期望 |
| --- | --- |
| `admin/main.js` 是否 `export default defineAdminPage({...})` | ✅ |
| import 是否全部来自 `/admin-sdk/v1/ricenote-admin.js` | ✅（**不要**自己带 Vue） |
| `manifest.admin.pages[].entry` 是否以 `./admin/` 开头且文件存在 | ✅ |
| 贡献组件是否声明了 `props` | ✅（否则静默失效） |
| 界面是否需要权限 | 在 `admin.pages[].permission` 或 `contributions[].permission` 声明 |
| 是否需要样式 | 放在 `admin/` 下并用 `style` 声明 |
| `pnpm validate` | 通过 |

---

## 相关页面

- [[manifest 逐字段参考|Plugin-API-Manifest-Reference]]（`admin` / `contributions` 字段）
- [[命名扩展点注册表|Architecture-Extension-Registry]]
- [[完整教程：从零写插件|Plugin-API-Tutorial]]
- [[后台功能导览|Admin-Guide]]
