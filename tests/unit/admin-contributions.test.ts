/**
 * 声明式扩展点贡献的解析（以 admin 作用域为主）。
 *
 * 三条链路的形状差异是插件作者最容易写错的地方，因此这里分别锁住：
 * - `admin`：payload 是"浏览器可 import 的托管 URL"，样式与权限放 meta；
 * - `render` / `server`：payload 由 Core 动态 import 插件产物得到。
 *
 * 另外锁住"单条失败只跳过该条"的失败策略：清单里的拼写/产物缺失在
 * `pnpm validate`（部署前）就该被拦下，运行期为一条写错的贡献让整个插件
 * 不可用，代价明显更大。静态校验本身的用例在 `extension-static-validate.test.ts`。
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ErrorCode, isRiceNoteError, type PluginManifest } from '@ricenote/shared';
import {
  AdminMenuRegistry,
  ExtensionRegistry,
  PLUGIN_ADMIN_URL_PREFIX,
  createPluginContext,
  pluginAdminEntryUrl,
  registerDeclaredAdminPages,
  registerDeclaredExtensions,
  resolveAdminPages,
  type ContextFactoryDeps,
  type LoadedPlugin,
  type Logger
} from '@ricenote/core';

/** 静默日志器：本文件断言的是注册结果，不需要往 stdout 打日志。 */
function silentLogger(): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger
  };
  return logger;
}

const logger = silentLogger();

/** 仓库内真实存在的插件目录：`dir` 必须绝对（测试的 cwd 是 tests/，相对路径会指向别处）。 */
const NAVIGATION_DIR = path.join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'plugins',
  'official',
  'navigation'
);

/** 构造一个已发现的插件；admin 贡献不需要读文件，render/server 贡献才需要真实产物。 */
function pluginWith(id: string, extra: Partial<PluginManifest>, dir = NAVIGATION_DIR): LoadedPlugin {
  const absolute = path.resolve(dir);
  return {
    manifest: {
      schemaVersion: 1,
      id,
      name: id,
      version: '1.0.0',
      apiVersion: '^1.0.0',
      entry: './dist/index.js',
      ...extra
    },
    dir: absolute,
    entryPath: path.join(absolute, 'dist/index.js'),
    builtin: true
  };
}

describe('声明式 admin 贡献：URL 换算与注册表落库', () => {
  it('payload 是可 import 的托管 URL，入口/样式/权限/文案进 meta', async () => {
    const extensions = new ExtensionRegistry(logger);
    const plugin = pluginWith('rice.media', {
      extensionPoints: [
        {
          name: 'rice.media.picker',
          scope: 'admin',
          replaceable: false,
          props: [{ name: 'value', description: '当前媒体值' }]
        }
      ],
      contributions: [
        {
          point: 'rice.media.picker',
          scope: 'admin',
          entry: './admin/main.js',
          style: './admin/main.css',
          permission: 'media.upload',
          label: '媒体选择器',
          order: 5
        }
      ]
    });

    const disposers = await registerDeclaredExtensions({ plugin, extensions, logger });
    const effective = extensions.effective('rice.media.picker', 'admin');

    assert.equal(effective.length, 1);
    assert.equal(effective[0]?.payload, `${PLUGIN_ADMIN_URL_PREFIX}/rice.media/main.js`);
    assert.equal(effective[0]?.scope, 'admin');
    assert.equal(effective[0]?.meta?.entry, './admin/main.js');
    assert.equal(effective[0]?.meta?.permission, 'media.upload');
    assert.equal(effective[0]?.meta?.label, '媒体选择器');
    // meta 里存相对路径、下发时再换算：宿主是唯一知道托管前缀的一方
    assert.equal(
      pluginAdminEntryUrl('rice.media', effective[0]?.meta?.style ?? ''),
      `${PLUGIN_ADMIN_URL_PREFIX}/rice.media/main.css`
    );
    // 子目录入口同样保留层级（列表页/编辑页就放在 admin/pages/ 下）
    assert.equal(
      pluginAdminEntryUrl('rice.media', './admin/pages/list.js'),
      `${PLUGIN_ADMIN_URL_PREFIX}/rice.media/pages/list.js`
    );
    assert.deepEqual(
      extensions.declaredPoints('admin').map((point) => point.name),
      ['rice.media.picker']
    );

    // 停用插件 = 贡献消失（disposer 由 PluginManager 统一回收）
    disposers.forEach((dispose) => dispose());
    assert.deepEqual(extensions.effective('rice.media.picker', 'admin'), []);
  });

  it('产物缺失的 render 贡献只跳过该条，其它贡献照常注册', async () => {
    const extensions = new ExtensionRegistry(logger);
    const plugin = pluginWith('rice.media', {
      contributions: [
        { point: 'rice.posts.list.actions', scope: 'render', entry: './dist/missing.js' },
        { point: 'rice.media.picker', scope: 'admin', entry: './admin/main.js' }
      ]
    });

    const disposers = await registerDeclaredExtensions({ plugin, extensions, logger });

    assert.deepEqual(extensions.effective('rice.posts.list.actions', 'render'), []);
    assert.equal(extensions.effective('rice.media.picker', 'admin').length, 1);
    assert.equal(disposers.length, 1);
  });

  it('render 入口没导出 render 时不登记（payload 形状按作用域校验）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rn-ext-render-'));
    try {
      mkdirSync(path.join(root, 'dist'), { recursive: true });
      writeFileSync(path.join(root, 'dist', 'not-a-slot.js'), 'export default { name: "not-a-slot" };');
      const extensions = new ExtensionRegistry(logger);
      const plugin = pluginWith(
        'rice.demo',
        { contributions: [{ point: 'rice.demo.card', scope: 'render', entry: './dist/not-a-slot.js' }] },
        root
      );

      const disposers = await registerDeclaredExtensions({ plugin, extensions, logger });

      assert.deepEqual(disposers, []);
      assert.deepEqual(extensions.effective('rice.demo.card', 'render'), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('扩展点能力门控：未声明能力时运行时拒绝', () => {
  function contextFor(capabilities: PluginManifest['capabilities']) {
    const deps = {
      db: { forPlugin: () => ({}) },
      services: {},
      events: {},
      router: {},
      slots: {},
      extensions: new ExtensionRegistry(logger),
      adminMenu: new AdminMenuRegistry(),
      site: () => ({}),
      pluginSettings: new Map<string, Record<string, unknown>>(),
      logger
    } as unknown as ContextFactoryDeps;
    return createPluginContext(pluginWith('rice.demo', { capabilities }), deps);
  }

  it('未声明 extensions:declare / extensions:contribute 时给出 RN_FORBIDDEN（而不是静默降级）', () => {
    const { context } = contextFor([]);

    assert.throws(
      () => context.extensions.declare({ name: 'rice.demo.card', scope: 'admin' }),
      (error: unknown) => {
        assert.ok(isRiceNoteError(error));
        assert.equal(error.code, ErrorCode.FORBIDDEN);
        assert.match(error.message, /extensions:declare/);
        return true;
      }
    );
    assert.throws(
      () => context.extensions.contribute('rice.demo.card', 'x', { scope: 'admin' }),
      (error: unknown) => isRiceNoteError(error) && error.code === ErrorCode.FORBIDDEN
    );
  });

  it('声明了能力后同一调用通过，且句柄被登记（停用时可校验泄漏）', () => {
    const { context, pendingDisposers } = contextFor(['extensions:declare', 'extensions:contribute']);

    context.extensions.declare({ name: 'rice.demo.card', scope: 'admin' });
    context.extensions.contribute('rice.demo.card', 'payload', { scope: 'admin' });

    assert.equal(pendingDisposers(), 2);
  });
});

describe('hidden 页面：路由/深链保留，侧栏可见性由 hidden 决定', () => {
  const HIDDEN = {
    id: 'posts.editor',
    label: '编辑文章',
    path: '/posts/edit',
    entry: './admin/main.js',
    hidden: true
  } as const;

  it('声明解析保留 hidden，并算出可深链的入口 URL', () => {
    const pages = resolveAdminPages(pluginWith('rice.posts', { admin: { pages: [HIDDEN] } }));

    assert.equal(pages[0]?.hidden, true);
    assert.equal(pages[0]?.entryUrl, `${PLUGIN_ADMIN_URL_PREFIX}/rice.posts/main.js`);
  });

  it('隐藏页照样注册进菜单并保留 hidden（深链与刷新可用）', () => {
    const menu = new AdminMenuRegistry();
    const disposers = registerDeclaredAdminPages(
      pluginWith('rice.posts', { admin: { pages: [HIDDEN] } }),
      menu,
      logger
    );

    assert.equal(disposers.length, 1);
    const items = menu.list();
    assert.equal(items.length, 1);
    assert.equal(items[0]?.path, '/posts/edit');
    assert.equal(items[0]?.entryUrl, `${PLUGIN_ADMIN_URL_PREFIX}/rice.posts/main.js`);

    /*
     * 这条断言曾经锁的是**缺陷**：早先这里构造菜单项时漏了 `hidden`，而
     * `PluginManager.declaredAdminPages()`（未启动插件那条路径）带着它。
     * 后台 `/menu` 优先返回已注册项、并过滤掉同路径的声明项，于是"已启动插件"
     * 的隐藏页反而缺 `hidden`，侧栏的 `available !== false && hidden !== true`
     * 拦不住它 —— 行为还取决于插件启没启动，最难排查。
     *
     * 现在两条路径都带 `hidden`，故断言改为 `true`：谁再把它漏掉，
     * 这条测试立刻红，而不是等某天发现"隐藏页出现在侧栏里"。
     */
    assert.equal(items[0]?.hidden, true);
  });
});
