/**
 * 权限点登记表的单元测试 —— 离线、无需数据库。
 *
 * 压着的性质（对应 ADR-018 的两条刻意不对称的规则）：
 * - **重复声明 = 错误**：同一标识被两方声明说明归属不清，权限目录会出现两个同名项，
 *   而且"谁该给它写文案"无解 —— 必须在启动期就失败；
 * - **用了却没声明 = 仅告警**：鉴权按标识字符串比对、**不依赖声明**，
 *   因此未声明的权限点照旧可用，只是目录里没有中文名与归属；
 * - 登记表本身**不参与鉴权**：它只服务展示与告警，所以 `list()` 必须能同时给出
 *   "只声明未使用"与"只使用未声明"两种项。
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CORE_PERMISSIONS, PermissionRegistry } from '@ricenote/core';
import { resolveLocalizedText, type PluginManifest } from '@ricenote/shared';

/** 测试以 tests/ 为工作目录运行，因此需要显式定位仓库根目录。 */
const ROOT = path.resolve(process.cwd(), '..');

async function errorCodeOf(run: () => void): Promise<string | undefined> {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('权限点登记表：声明与使用的合并视图', () => {
  it('Core 自有权限点与插件声明都进入目录，并带上归属', () => {
    const registry = new PermissionRegistry();
    registry.declare(null, CORE_PERMISSIONS);
    registry.declare('rice.posts', [
      { key: 'post.publish', label: { 'zh-CN': '发布文章', en: 'Publish posts' }, group: { 'zh-CN': '内容' } }
    ]);

    const list = registry.list();
    const themeView = list.find((item) => item.key === 'theme.view');
    assert.equal(themeView?.declaredBy, null, 'Core 自有权限点的 declaredBy 为 null');
    assert.equal(resolveLocalizedText(themeView?.label ?? undefined, 'zh-CN'), '查看主题');

    const publish = list.find((item) => item.key === 'post.publish');
    assert.equal(publish?.declaredBy, 'rice.posts');
    assert.equal(resolveLocalizedText(publish?.group ?? undefined, 'zh-CN'), '内容');

    assert.equal(registry.declaredCount(), CORE_PERMISSIONS.length + 1);
  });

  it('未声明但被使用的权限点仍出现在目录里，label/group 为空', () => {
    const registry = new PermissionRegistry();
    registry.declare(null, CORE_PERMISSIONS);
    registry.track('legacy.thing', 'acme.plugin', 'admin-api');

    const item = registry.list().find((entry) => entry.key === 'legacy.thing');
    assert.ok(item, '未登记的权限点也必须可分配，因此不能从目录里丢掉');
    assert.equal(item.label, null);
    assert.equal(item.group, null);
    assert.equal(item.declaredBy, null);
    assert.deepEqual(item.usedBy, ['acme.plugin']);
  });

  it('声明与使用来自不同插件时，usedBy 如实合并（如 taxonomy 使用 posts 的 post.view）', () => {
    const registry = new PermissionRegistry();
    registry.declare('rice.posts', [
      { key: 'post.view', label: { 'zh-CN': '查看文章' }, group: { 'zh-CN': '内容' } }
    ]);
    registry.declare('rice.taxonomy', undefined);
    registry.track('post.view', 'rice.posts', 'admin-api');
    registry.track('post.view', 'rice.taxonomy', 'admin-page');

    const item = registry.list().find((entry) => entry.key === 'post.view');
    assert.equal(item?.declaredBy, 'rice.posts');
    assert.deepEqual(item?.usedBy, ['rice.posts', 'rice.taxonomy']);
  });

  it('重复使用同一权限点只记一次（按插件去重）', () => {
    const registry = new PermissionRegistry();
    registry.track('post.view', 'rice.posts', 'admin-api');
    registry.track('post.view', 'rice.posts', 'admin-page');

    const item = registry.list().find((entry) => entry.key === 'post.view');
    assert.deepEqual(item?.usedBy, ['rice.posts']);
  });

  it('空 permission 被忽略（仅需登录的路由与菜单）', () => {
    const registry = new PermissionRegistry();
    registry.track(undefined, 'rice.posts', 'admin-api');
    registry.track(null, 'rice.posts', 'admin-menu');

    assert.deepEqual(registry.list(), []);
    assert.deepEqual(registry.undeclared(), []);
  });
});

describe('权限点登记表：重复声明与格式校验', () => {
  it('跨插件重复声明同一权限点直接失败', async () => {
    const registry = new PermissionRegistry();
    registry.declare('rice.posts', [
      { key: 'post.view', label: { 'zh-CN': '查看文章' }, group: { 'zh-CN': '内容' } }
    ]);

    const code = await errorCodeOf(() =>
      registry.declare('acme.posts', [
        { key: 'post.view', label: { 'zh-CN': '重复' }, group: { 'zh-CN': '内容' } }
      ])
    );
    assert.equal(code, 'RN_MANIFEST_INVALID');
  });

  it('插件不得重复声明 Core 自有的控制面权限点', async () => {
    const registry = new PermissionRegistry();
    registry.declare(null, CORE_PERMISSIONS);

    const code = await errorCodeOf(() =>
      registry.declare('acme.thing', [
        { key: 'plugin.manage', label: { 'zh-CN': '抢一个' }, group: { 'zh-CN': '扩展' } }
      ])
    );
    assert.equal(code, 'RN_MANIFEST_INVALID');
  });

  it('同一个插件内重复声明也失败', async () => {
    const registry = new PermissionRegistry();
    const code = await errorCodeOf(() =>
      registry.declare('acme.thing', [
        { key: 'thing.view', label: { 'zh-CN': 'A' }, group: { 'zh-CN': '内容' } },
        { key: 'thing.view', label: { 'zh-CN': 'B' }, group: { 'zh-CN': '内容' } }
      ])
    );
    assert.equal(code, 'RN_MANIFEST_INVALID');
  });

  it('标识必须是 <域>.<动作> 形式', async () => {
    const registry = new PermissionRegistry();

    for (const key of ['thing', 'thing.', '.view', 'Thing.View', 'thing view', 'thing.*']) {
      const code = await errorCodeOf(() =>
        registry.declare('acme.thing', [{ key, label: { 'zh-CN': 'x' }, group: { 'zh-CN': 'g' } }])
      );
      assert.equal(code, 'RN_MANIFEST_INVALID', `${key} 应被拒绝`);
    }
  });

  it('允许带短横线的域与动作（如 friend-links 这类命名）', () => {
    const registry = new PermissionRegistry();
    registry.declare('acme.friend-links', [
      { key: 'friend-link.view', label: { 'zh-CN': '查看' }, group: { 'zh-CN': '外观' } }
    ]);
    assert.ok(registry.list().some((item) => item.key === 'friend-link.view'));
  });
});

describe('权限点登记表：清单静态使用与未声明告警', () => {
  it('declareManifest 会把后台页面与扩展点贡献的 permission 记为使用', () => {
    const registry = new PermissionRegistry();
    registry.declareManifest('rice.posts', {
      permissions: [
        { key: 'post.view', label: { 'zh-CN': '查看文章' }, group: { 'zh-CN': '内容' } }
      ],
      admin: {
        pages: [
          {
            id: 'posts.list',
            label: '文章',
            path: '/posts',
            permission: 'post.view',
            entry: './admin/main.js'
          },
          {
            id: 'posts.editor',
            label: '编辑文章',
            path: '/posts/editor',
            permission: 'post.write',
            entry: './admin/editor.js'
          }
        ]
      },
      contributions: [
        { point: 'rice.media.picker', scope: 'admin', entry: './admin/picker.js', permission: 'media.manage' }
      ]
    });

    const items = registry.list();
    assert.deepEqual(
      items.find((item) => item.key === 'post.view')?.usedBy,
      ['rice.posts']
    );
    assert.deepEqual(
      items.find((item) => item.key === 'post.write')?.usedBy,
      ['rice.posts']
    );
    assert.deepEqual(
      items.find((item) => item.key === 'media.manage')?.usedBy,
      ['rice.posts']
    );
  });

  it('undeclared 只列出"被使用且无人声明"的标识，并给出使用者', () => {
    const registry = new PermissionRegistry();
    registry.declare(null, CORE_PERMISSIONS);
    registry.declareManifest('rice.posts', {
      permissions: [
        { key: 'post.view', label: { 'zh-CN': '查看文章' }, group: { 'zh-CN': '内容' } }
      ],
      admin: {
        pages: [
          { id: 'posts.list', label: '文章', path: '/posts', permission: 'post.view', entry: './admin/a.js' },
          { id: 'posts.x', label: 'x', path: '/x', permission: 'legacy.thing', entry: './admin/a.js' }
        ]
      }
    });

    const undeclared = registry.undeclared();
    assert.deepEqual(
      undeclared.map((item) => item.key),
      ['legacy.thing']
    );
    assert.deepEqual(undeclared[0]?.usedBy, ['rice.posts']);
    assert.deepEqual(undeclared[0]?.sources, ['admin-page']);
  });
});

/**
 * 仓库守卫：把官方插件的真实清单喂给登记表。
 *
 * 这条守卫能在提交前拦住最容易犯的错 —— **在 admin.pages / contributions 里用了
 * 一个没声明的权限点**（拼写错误、或新增权限点忘了补声明）。它对应的正是
 * `pnpm validate` 与启动日志里的那两条提示，只是这里把"提示"钉成断言。
 */
describe('官方插件的权限点声明（仓库守卫）', () => {
  function loadOfficialManifests(): { id: string; manifest: PluginManifest }[] {
    const officialDir = path.join(ROOT, 'plugins/official');
    const output: { id: string; manifest: PluginManifest }[] = [];

    for (const name of readdirSync(officialDir).sort()) {
      const manifestPath = path.join(officialDir, name, 'manifest.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest;
      output.push({ id: manifest.id, manifest });
    }

    return output;
  }

  it('全部官方插件的声明与使用自洽：没有重复声明，也没有"用了没声明"', () => {
    const plugins = loadOfficialManifests();
    assert.ok(plugins.length > 0, '应至少发现一个官方插件');

    const registry = new PermissionRegistry();
    registry.declare(null, CORE_PERMISSIONS);

    for (const plugin of plugins) {
      // 重复声明会在这里直接抛出（跨插件或与 Core 冲突）
      registry.declareManifest(plugin.id, plugin.manifest);
    }

    assert.deepEqual(
      registry.undeclared().map((item) => `${item.key} ← ${item.usedBy.join(',')}`),
      [],
      '以下权限点被使用但未声明，请补到对应插件的 manifest.permissions'
    );
  });

  it('Core 控制面权限点确实被登记（否则插件可以抢注同名权限点）', () => {
    const registry = new PermissionRegistry();
    registry.declare(null, CORE_PERMISSIONS);

    for (const key of ['plugin.manage', 'theme.manage', 'user.manage', 'system.restart']) {
      const item = registry.list().find((entry) => entry.key === key);
      assert.ok(item, `${key} 应在 Core 声明里`);
      assert.equal(item.declaredBy, null, `${key} 应由 Core 声明（declaredBy = null）`);
    }
  });
});
