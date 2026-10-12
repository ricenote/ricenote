# 完整教程：从零写一个插件

本教程从空目录开始，写出一个**功能完整、可发布**的插件：`acme.notice`（站点公告条）。

它覆盖了插件开发的全部主要能力：

| 学习点 | 对应章节 |
| --- | --- |
| 目录结构与脚手架 | [2](#2-脚手架) |
| `manifest.json` 逐字段 | [3](#3-manifest逐字段填) |
| 数据表与迁移 | [4](#4-数据与迁移) |
| 插槽（前台渲染） | [5](#5-前台公告条插槽) |
| 管理 API 路由 | [6](#6-管理-api) |
| 声明式设置 | [7](#7-声明式设置) |
| 自带后台界面（零构建） | [8](#8-后台界面零构建) |
| 事件与生命周期 | [9](#9-事件与启动时序) |
| 测试 | [10](#10-测试) |
| 本地调试 | [11](#11-本地调试) |
| 打包与发布 | [12](#12-打包与发布) |

> 全程代码都可以直接复制。若想先看一个"极简真实插件"，读 `plugins/third-party/reading-time`；
> 想看"复杂真实插件"，读 `plugins/official/posts`。

---

## 1. 目标

- 在**每个页面顶部**显示一条公告条（可开关、可自定义文案与色调）；
- 公告内容存在数据库里，可在后台编辑；
- 提供 `acme.notice@1` 契约，让别的插件能读到当前公告；
- 中英文文案、可发布到 npm。

---

## 2. 脚手架

```
plugins/third-party/notice/
├── manifest.json
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts          # 插件入口
│   ├── repository.ts     # 数据访问
│   └── service.ts        # 业务逻辑
├── migrations/
│   └── 0001_notice.sql
├── admin/
│   ├── main.js           # 后台界面（零构建）
│   └── style.css
└── dist/                 # 构建产物（勿提交）
```

在 `pnpm-workspace.yaml` 已包含 `plugins/third-party/*` 的前提下，创建目录后执行 `pnpm install` 即可纳入工作区。

### `package.json`

```json
{
  "name": "@ricenote-example/plugin-notice",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "engines": { "node": ">=20.11.0" },
  "files": ["dist", "admin", "migrations", "manifest.json", "README.md"],
  "publishConfig": { "access": "public" },
  "license": "MIT",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "peerDependencies": {
    "@ricenote/plugin-sdk": "^0.5.0",
    "@ricenote/shared": "^0.5.0"
  },
  "peerDependenciesMeta": {
    "@ricenote/plugin-sdk": { "optional": true },
    "@ricenote/shared": { "optional": true }
  },
  "devDependencies": {
    "@ricenote/plugin-sdk": "workspace:^",
    "@ricenote/shared": "workspace:^"
  }
}
```

三个关键点：

1. **宿主提供的包必须写 `peerDependencies`，且标记 `optional: true`** ——
   把它们写成普通 `dependencies` 会被安装器**直接拒绝**（会导致两份实例）。
2. `files` 决定发布内容；`manifest.json` 必须包含，否则装完无法识别。
3. `main` 与 `manifest.entry` 要指向同一个文件。

### `tsconfig.json`

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022"
  },
  "include": ["src/**/*.ts"]
}
```

---

## 3. `manifest.json` 逐字段填

```json
{
  "schemaVersion": 1,
  "id": "acme.notice",
  "name": "站点公告",
  "description": "在每个页面顶部显示一条可管理的公告条，并提供 acme.notice@1 契约供其他插件读取。",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",
  "author": "Acme Studio",
  "license": "MIT",
  "entry": "./dist/index.js",

  "provides": ["acme.notice@1"],

  "capabilities": [
    "database:own",
    "services:provide",
    "routes:admin",
    "slots:register"
  ],

  "migrations": "./migrations",

  "admin": {
    "pages": [
      {
        "id": "notice.editor",
        "label": "站点公告",
        "path": "/notice",
        "icon": "Megaphone",
        "order": 60,
        "permission": "theme.manage",
        "entry": "./admin/main.js",
        "style": "./admin/style.css"
      }
    ]
  },

  "settingsSchema": {
    "display": {
      "label": { "zh-CN": "显示", "en": "Display" },
      "fields": {
        "enabled": { "type": "boolean", "label": "启用公告条", "default": true },
        "position": {
          "type": "select", "label": "显示位置", "default": "top",
          "options": [
            { "value": "top", "label": { "zh-CN": "页面顶部", "en": "Top" } },
            { "value": "bottom", "label": { "zh-CN": "页面底部", "en": "Bottom" } }
          ]
        },
        "dismissible": { "type": "boolean", "label": "允许访客关闭", "default": true }
      }
    }
  }
}
```

逐项说明（完整字段表见 [[manifest 参考|Development/Plugin-API/Manifest-Reference]]）：

| 字段 | 为什么这么写 |
| --- | --- |
| `id` | 必须**至少两段**（`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$`），所以用 `acme.notice` |
| `entry` | 必须以 `./` 开头 |
| `provides` | 我们要对外提供契约，因此声明它 |
| `capabilities` | 用了 `ctx.db`（`database:own`）、`ctx.services.provide`、`ctx.routes.adminApi`、`ctx.slots.register` |
| `migrations` | 有数据表就必须声明迁移目录 |
| `admin.pages[].entry` | 必须是 `./admin/*.js` |
| `admin.pages[].permission` | 公告是站点级外观内容，用 `theme.manage` |

> 每次改完 manifest 都跑一次 `pnpm validate` —— 它不需要数据库，会立刻告诉你哪个字段不合法。

---

## 4. 数据与迁移

### `migrations/0001_notice.sql`

```sql
-- 站点公告：单站点保留一行（site_id 为将来多站点留出扩展位）
CREATE TABLE IF NOT EXISTS rn_notice (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     VARCHAR(64)     NOT NULL DEFAULT 'default',
  message     VARCHAR(500)    NOT NULL DEFAULT '',
  tone        VARCHAR(16)     NOT NULL DEFAULT 'info',
  link_url    VARCHAR(500)    NULL,
  link_label  VARCHAR(80)     NULL,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notice_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

约定：

- 表名以 **`rn_`** 开头（迁移写的是完整表名，插件代码里用 `ctx.db.table('notice')` 让 Core 拼前缀）；
- 字符集 `utf8mb4` / `utf8mb4_unicode_ci`；
- **迁移只有前向演进**：文件一旦被应用就**不要再改**（SHA-256 校验值会让内核拒绝启动），要改就新增 `0002_*.sql`。

### `src/repository.ts`

```ts
import type { PluginContext } from '@ricenote/plugin-sdk';

export interface NoticeRecord {
  message: string;
  tone: string;
  linkUrl: string | null;
  linkLabel: string | null;
}

export function createNoticeRepository(ctx: PluginContext) {
  const table = ctx.db.table('notice');     // → rn_notice

  return {
    async load(): Promise<NoticeRecord | null> {
      const rows = await ctx.db.query<{
        message: string; tone: string; link_url: string | null; link_label: string | null;
      }>(`SELECT message, tone, link_url, link_label FROM ${table} WHERE site_id = ? LIMIT 1`,
          [ctx.site.id]);

      const row = rows[0];
      if (!row) return null;
      return { message: row.message, tone: row.tone, linkUrl: row.link_url, linkLabel: row.link_label };
    },

    async save(input: NoticeRecord, actorId: number | null): Promise<void> {
      await ctx.db.execute(
        `INSERT INTO ${table} (site_id, message, tone, link_url, link_label, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           message = VALUES(message), tone = VALUES(tone),
           link_url = VALUES(link_url), link_label = VALUES(link_label),
           updated_by = VALUES(updated_by)`,
        [ctx.site.id, input.message, input.tone, input.linkUrl, input.linkLabel, actorId]
      );
    }
  };
}
```

要点：

- `ctx.db.table('notice')` 返回 `rn_notice`，并顺带做了命名合法性校验；
- 参数用 `?` 占位（`multipleStatements: false`，不能塞多条语句）；
- `ctx.site.id` 取当前站点标识（v1 固定 `default`）。

---

## 5. 前台公告条（插槽）

公告条要出现在**每个页面**上，因此用标准插槽 `body.start`：

```ts
// src/service.ts
import type { PluginContext } from '@ricenote/plugin-sdk';
import { createNoticeRepository, type NoticeRecord } from './repository.js';

export interface NoticeService {
  get(): Promise<NoticeRecord | null>;
  set(input: NoticeRecord, actorId: number | null): Promise<void>;
}

export function createNoticeService(ctx: PluginContext): NoticeService {
  const repo = createNoticeRepository(ctx);
  return {
    get: () => repo.load(),
    set: (input, actorId) => repo.save(input, actorId)
  };
}
```

```ts
// src/index.ts（渲染部分）
import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';
import { createNoticeService } from './service.js';

/** 颜色只接受白名单值，绝不把用户输入直接拼进 class/style。 */
const TONE_CLASS: Record<string, string> = {
  info: 'acme-notice--info',
  warn: 'acme-notice--warn',
  success: 'acme-notice--success'
};

/** 输出到 HTML 的文本必须转义。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 只放行站内路径与 http(s) 绝对地址，杜绝 javascript: 之类。 */
function safeHref(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/')) return url;
  return /^https?:\/\//i.test(url) ? url : null;
}

export default definePlugin({
  async start(ctx: PluginContext) {
    const service = createNoticeService(ctx);

    ctx.services.provide({ name: 'acme.notice@1', version: '1.0.0', implementation: service });

    const enabled = ctx.config.get<boolean>('enabled', true);
    if (!enabled) {
      ctx.logger.info('公告条已按设置关闭');
      return;
    }

    const position = ctx.config.get('position', 'top') === 'bottom' ? 'body.end' : 'body.start';
    const dismissible = ctx.config.get<boolean>('dismissible', true);

    ctx.slots.register(position, {
      name: 'acme.notice',
      async render() {
        const notice = await service.get();
        if (!notice || notice.message.trim() === '') return '';

        const toneClass = TONE_CLASS[notice.tone] ?? TONE_CLASS.info;
        const href = safeHref(notice.linkUrl);
        const link = href
          ? `<a class="acme-notice__link" href="${escapeHtml(href)}" rel="noopener noreferrer">`
            + `${escapeHtml(notice.linkLabel ?? '了解更多')}</a>`
          : '';
        const close = dismissible
          ? '<button class="acme-notice__close" type="button" data-acme-notice-close aria-label="关闭">×</button>'
          : '';

        return `<div class="acme-notice ${toneClass}" data-acme-notice role="status">`
             + `<span class="acme-notice__text">${escapeHtml(notice.message)}</span>${link}${close}</div>`;
      }
    });

    ctx.logger.info('站点公告插件已就绪', { position, dismissible });
  }
});
```

三个必须遵守的安全习惯：

1. **所有文本都转义**（插槽内容不会走模板的自动转义）；
2. **URL 走白名单**（只接受 `/` 开头与 `http(s)://`）；
3. **枚举值映射到固定 class**，不要把用户输入拼进 `class` 或 `style`。

> 关闭按钮需要一点前端脚本。请在主题的 `assets/js` 或插件自带的静态资源里处理，
> 并保持"**没有 JavaScript 也能看到公告**"的降级。

---

## 6. 管理 API

后台界面需要两个接口：读与写。用 `ctx.routes.adminApi()` 注册，Core 会自动套上
"认证 → CSRF → 权限 → 审计"。

```ts
// src/index.ts 追加
import type { HttpRequestLike, HttpResponseLike } from '@ricenote/plugin-sdk';

function readBody(request: HttpRequestLike): Record<string, unknown> {
  return (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
}

// 在 start() 内：
ctx.routes.adminApi({
  method: 'GET',
  path: '/notice',
  permission: 'theme.manage',
  async handler(request, reply) {
    reply.json({ notice: await service.get() });
  }
});

ctx.routes.adminApi({
  method: 'PUT',
  path: '/notice',
  permission: 'theme.manage',
  async handler(request, reply) {
    const body = readBody(request);
    const message = String(body.message ?? '').trim();

    if (message.length > 500) {
      reply.statusCode = 400;
      reply.json({ error: { code: 'RN_VALIDATION_FAILED', message: '公告文案不能超过 500 字' } });
      return;
    }
    const tone = ['info', 'warn', 'success'].includes(String(body.tone)) ? String(body.tone) : 'info';
    const linkUrl = body.linkUrl ? String(body.linkUrl) : null;

    await service.set(
      { message, tone, linkUrl, linkLabel: body.linkLabel ? String(body.linkLabel) : null },
      request.viewer?.user.id ?? null
    );
    reply.json({ ok: true });
  }
});
```

要点：

| 项 | 说明 |
| --- | --- |
| 路径 | `path: '/notice'` → 实际地址 `/api/admin/notice` |
| 权限 | 不写 `permission` 就只要求登录 —— **写操作请务必声明** |
| 校验 | 服务端必须自己校验（前端校验只是体验） |
| 操作者 | `request.viewer?.user.id` 取当前登录者（公开路由下为 `undefined`） |
| 错误 | 返回 `{ error: { code, message } }`，前端 `ApiError` 会解析它 |

> `ctx.routes.adminApi` 返回 `Dispose`。虽然 Core 会兜底释放，但**良好习惯**是把它存起来，
> 在 `stop()` 里主动调用。

---

## 7. 声明式设置

`settingsSchema` 已经在 [第 3 步](#3-manifest逐字段填) 写好了，无需后台代码 ——
后台「扩展中心 → 插件 → 设置」会自动出现表单。

插件侧这样读取（`ctx.config` 已合并默认值）：

```ts
const enabled = ctx.config.get<boolean>('enabled', true);
const position = ctx.config.get('position', 'top');
```

建议在读取时再收敛一次越界值（防历史脏值）：

```ts
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
```

改设置后需要**重启**才生效，后台会给出「待重启」按钮。

---

## 8. 后台界面（零构建）

`admin/main.js` —— 纯 ESM，不打包，不装前端依赖：

```js
/**
 * 站点公告后台界面（零构建）。
 * - 依赖全部来自 /admin-sdk/v1/ricenote-admin.js（与宿主共用同一份 Vue）
 * - 组件（Card/Field/Textarea/Select/Switch/Button）由宿主全局注册，模板里直接写标签
 */
import {
  api,
  defineAdminPage,
  onMounted,
  reactive,
  ref,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

const TONE_OPTIONS = [
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警示' },
  { value: 'success', label: '成功' }
];

export default defineAdminPage({
  title: '站点公告',
  setup() {
    const toast = useToast();
    const loading = ref(true);
    const saving = ref(false);
    const form = reactive({ message: '', tone: 'info', linkUrl: '', linkLabel: '' });

    async function load() {
      loading.value = true;
      try {
        const data = await api.get('/notice');
        const notice = data.notice;
        if (notice) {
          form.message = notice.message ?? '';
          form.tone = notice.tone ?? 'info';
          form.linkUrl = notice.linkUrl ?? '';
          form.linkLabel = notice.linkLabel ?? '';
        }
      } catch (error) {
        toast.error(error && error.message ? error.message : '加载失败');
      } finally {
        loading.value = false;
      }
    }

    async function save() {
      saving.value = true;
      try {
        await api.put('/notice', { ...form });
        toast.success('已保存，重启后生效');
      } catch (error) {
        toast.error(error && error.message ? error.message : '保存失败');
      } finally {
        saving.value = false;
      }
    }

    onMounted(load);
    return { loading, saving, form, toneOptions: TONE_OPTIONS, save };
  },
  template: `
    <Card title="站点公告">
      <Field label="公告文案" :hint="'最多 500 字'">
        <Textarea v-model="form.message" :rows="3" />
      </Field>

      <Field label="色调">
        <Select v-model="form.tone" :options="toneOptions" />
      </Field>

      <Field label="跳转地址" hint="留空则不显示链接；仅支持站内路径或 http(s) 绝对地址">
        <Input v-model="form.linkUrl" placeholder="/about 或 https://example.com" />
      </Field>

      <Field label="链接文案">
        <Input v-model="form.linkLabel" placeholder="了解更多" />
      </Field>

      <Button :loading="saving" @click="save">保存</Button>
    </Card>
  `
});
```

`admin/style.css`：

```css
.acme-notice {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; font-size: 14px; line-height: 1.5;
}
.acme-notice--info    { background: #f5f7fa; color: #33415c; }
.acme-notice--warn    { background: #fff7e6; color: #8a5a00; }
.acme-notice--success { background: #eefaf0; color: #1f6b3a; }
.acme-notice__text    { flex: 1; }
.acme-notice__link    { text-decoration: underline; }
.acme-notice__close   { background: none; border: 0; cursor: pointer; font-size: 18px; }
```

注意：

- **不要 import Vue**：`ref` / `reactive` 等全部从 SDK 导入；
- **不要 import 组件**：`Card` / `Field` / `Textarea` / `Select` / `Input` / `Button` 由宿主全局注册；
- `api` 自动带 CSRF 令牌，路径自动加 `/api/admin` 前缀。

---

## 9. 事件与启动时序

假如你希望"文章发布后刷新公告缓存"，**不要**在 `start()` 里假设其它插件已就绪，
而是挂到生命周期事件：

```ts
ctx.events.on('core.runtime.started.v1', async ({ started, failed, excluded }) => {
  ctx.logger.info('内核启动完成', { started: started.length, failed, excluded });
});
```

订阅内容事件（需要能力 `events:subscribe`）：

```ts
ctx.events.on('content.post.published.v1', async (payload) => {
  ctx.logger.debug('文章已发布', { postId: payload.postId });
});
```

| 约定 | 原因 |
| --- | --- |
| 不要在 `start()` 里做"需要别人已就绪"的事 | 拓扑排序只保证依赖在前，不保证无关插件之间的顺序 |
| 可选依赖用 `tryUse()` 且**在请求期**解析 | `start()` 阶段可能拿到"假阴性"的 `undefined` |
| `emit` 记得 `await` | 它是异步的，不等待会丢订阅者错误 |

---

## 10. 测试

### 10.1 纯函数单元测试（快、无需数据库）

把可测逻辑抽成纯函数（例如上面的 `escapeHtml` / `safeHref`），放进 `tests/` 中测试：

```ts
import { describe, expect, it } from 'vitest';
import { safeHref } from '../src/index.js';

describe('safeHref', () => {
  it('放行站内路径与 http(s)', () => {
    expect(safeHref('/about')).toBe('/about');
    expect(safeHref('https://example.com')).toBe('https://example.com');
  });
  it('拒绝危险协议与相对地址', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('//evil.com')).toBeNull();
    expect(safeHref('relative/path')).toBeNull();
  });
});
```

> 想这么做，就把这些函数 `export` 出来。**"抽纯函数 + 单测"是官方插件的通行做法**
> （例如 `rice.navigation` 的 `safeHref` 与 `reading-time` 的 `countWords`）。

### 10.2 集成测试（真实起内核）

仓库的集成测试会在**独立测试库**上完整启动内核，验证契约发布、路由注册、插槽注入与零残留。
新插件建议按同样思路补三条用例：

| 用例 | 断言 |
| --- | --- |
| 启用后 | `acme.notice@1` 契约可解析；`/api/admin/notice` 可访问；`body.start` 插槽有组件 |
| 保存公告后 | 前台渲染出的 HTML 含公告文案（注意转义：`<script>` 应变为 `&lt;script&gt;`） |
| 停用后 | 契约消失、路由 404、插槽为空 —— **零残留** |

可直接参照仓库中的 `tests/integration/` 既有模式（内核启动辅助、独立 `ricenote_test` 库）。
`assertNoLeaks()` 会在插件停止后替你检查路由 / 服务 / 插槽 / 事件 / 菜单 / 扩展点的残留。

---

## 11. 本地调试

### 让改动立即生效

把插件目录登记到 `.env`：

```bash
RICENOTE_LOCAL_PLUGINS=../my-plugins,./plugins/third-party/notice
```

效果：

- 这些目录**参与插件发现**，因此**不需要"安装"这个动作**；
- 开发环境会监视其变化并**自动重启内核**（900ms 抖动合并），实现"改动即生效"；
- 由 `RICENOTE_WATCH_LOCAL_PLUGINS`（默认 `true`）控制是否监视。

### 一轮典型调试循环

```bash
pnpm build                       # 编译插件（tsc → dist）
pnpm validate                    # 校验 manifest 与扩展点
pnpm start                       # 启动（本地插件目录已登记时会被自动发现）
```

后台改动 `.js` 界面文件**不需要重启**（前端模块按 URL 加载）；改了 `src/` 就要 `pnpm build`。

### 排查手段

| 问题 | 怎么看 |
| --- | --- |
| 插件没被加载 | 启动摘要的"排除 / 无效"段；`pnpm plugin` 列表 |
| 能力不足 | 日志里 `RN_FORBIDDEN` + 缺失的能力名 |
| 插槽没输出 | 插件是否启用？插槽名是否写对？`render()` 是否返回空串？ |
| 后台页面打不开 | `manifest.admin.pages[].entry` 文件是否存在、是否以 `./admin/` 开头 |
| 设置不生效 | 改完需要**重启**；确认读取的键名与 `settingsSchema` 一致 |
| 迁移报错 | 不要修改已应用的 `.sql`；新增迁移文件 |
| 数据不对 | `ctx.logger.debug` 打出 SQL 与参数（注意脱敏） |

> ⚠️ 一个高频陷阱：**进程内软重启不重载模块代码**（Node ESM 缓存按 URL 生效）。
> 改了 `dist/` 里的代码必须重启**进程**；后台按钮只解决配置与启停的生效。

---

## 12. 打包与发布

### 12.1 发布前自检

```bash
pnpm validate      # manifest / 扩展点 / 版本三者一致 / 入口文件存在
pnpm typecheck     # 类型
pnpm test          # 测试
pnpm build         # 产物
```

对照检查：

| 检查项 | 期望 |
| --- | --- |
| `manifest.version` == `package.json.version` | 一致（进入官方目录时还需等于目录推荐版本） |
| `files` 是否包含 `dist`、`admin`、`migrations`、`manifest.json` | ✅ |
| `publishConfig.access` | `public` |
| 宿主提供的包是否写成普通依赖 | **不应**（必须 `peerDependencies` + `optional`） |
| `dist/index.js` 是否存在 | ✅ |
| `admin.pages[].entry` 引用的文件是否存在 | ✅ |

### 12.2 交给安装器安装（推荐）

用户侧一条命令即可安装你的插件：

```bash
# 从 npm
pnpm plugin install acme-plugin-notice@^1.0.0

# 从 Git（tag / 分支 / 提交；取源码后按 scripts.build 构建）
pnpm plugin install --git https://github.com/acme/ricenote-notice.git --ref v1.0.0

# 从本地目录 / 压缩包（离线兜底）
pnpm plugin install --dir ./plugins/third-party/notice
pnpm plugin install --zip ./notice.zip
```

后台「扩展中心」也支持同样三种来源，并共用同一个任务队列与日志。

### 12.3 从 npm 分发的形态

安装器会区分两种情况：

| 形态 | 判定 | 行为 |
| --- | --- | --- |
| **含源码** | 目录里有 `src/` 或 `tsconfig.json` | 安装普通依赖 + 执行 `scripts.build` |
| **仅产物** | 两者都没有 | **跳过依赖安装与构建**，直接使用 `dist/` 与 `admin/` |

从 npm 分发的包应当是"仅产物"形态（源码在独立仓库）。
`scripts/split-plugin-repos.mjs` 就是用来把单调仓库里的插件拆成独立仓库的。

> 官方插件的发布流水线（`scripts/release-plugins.mjs`）采取**先校验后发布**：
> 校验版本三处一致、包名与目录一致、`files` 完整、宿主包未写成普通依赖、产物存在，
> 再按依赖顺序逐包发布；`--dry-run` / `--only=` / `--skip-published` 可用。

---

## 13. 完整清单（复制用）

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | 身份、能力、依赖、后台页面、设置、扩展点 |
| `package.json` | 包名、版本、`files`、peer 依赖、构建脚本 |
| `tsconfig.json` | 编译到 `dist/` |
| `src/index.ts` | `definePlugin` + 生命周期 + 路由 + 插槽 + 服务 |
| `src/service.ts` | 业务逻辑 |
| `src/repository.ts` | 数据访问 |
| `migrations/0001_notice.sql` | 建表 |
| `admin/main.js` | 后台界面（零构建） |
| `admin/style.css` | 界面样式 |
| `README.md` | 用途、能力、扩展点、设置项、数据表 |

`README.md` 建议按官方插件的格式写：**用途 → 清单摘要 → 全部扩展点 → 设置项 → 数据表 → 启停影响**。

---

## 相关页面

- [[manifest 逐字段参考|Development/Plugin-API/Manifest-Reference]]
- [[PluginContext 逐方法参考|Development/Plugin-API/Context-Reference]]
- [[插件自带后台界面|Development/Plugin-API/Admin-UI]]
- [[声明式设置表单|Development/Plugin-API/Settings]]
- [[插件生命周期与依赖解析|Development/Architecture/Plugin-Lifecycle]]
- [[插件安装与更新|Plugins/Install-and-Update]]
- 真实范例：[reading-time（极简）](https://github.com/ricenote/ricenote/tree/main/plugins/third-party/reading-time) ｜
  [posts（完整）](https://github.com/ricenote/ricenote/tree/main/plugins/official/posts)
