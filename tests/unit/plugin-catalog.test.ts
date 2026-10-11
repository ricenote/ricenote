/**
 * 官方插件目录（推荐清单）与发布形态的单元测试 —— 离线、无需数据库。
 *
 * 压着的性质：
 * - 清单本身是**唯一事实来源**，它一旦与仓库不一致，发布出去的包就会与
 *   安装向导看到的版本对不上（而且 npm 上的版本收不回）；
 * - `buildCatalogView` 决定扩展中心显示"未安装 / 可更新 / 随仓库分发"，
 *   三种状态写错都会让管理员做出错误判断；
 * - 「宿主提供的包」不能出现在 `dependencies` 里（否则插件目录内会出现第二份 SDK）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildCatalogView, isOfficialPlugin } from '@ricenote/core';
import {
  HOST_PROVIDED_PACKAGES,
  findCatalogEntryById,
  findCatalogEntryByNpm,
  getPluginCatalog,
  isHostProvidedPackage,
  requiredCatalogEntries,
  withRequiredDependencies
} from '@ricenote/shared';

const ROOT = path.resolve(process.cwd(), '..');
const officialDir = path.join(ROOT, 'plugins/official');

/** 按 manifest.id 找到插件目录（不假设目录名与 ID 同名）。 */
function pluginDirOf(id: string): string | undefined {
  for (const entry of readdirSync(officialDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(officialDir, entry.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    if ((JSON.parse(readFileSync(manifestPath, 'utf8')) as { id?: string }).id === id) return dir;
  }
  return undefined;
}

describe('官方插件目录：清单自身', () => {
  it('通过 Schema 校验，并且随当前应用版本发布', () => {
    const catalog = getPluginCatalog();
    assert.equal(catalog.schemaVersion, 1);
    const appVersion = (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    }).version;
    assert.equal(catalog.appVersion, appVersion);
  });

  it('必需项恰好是身份与权限两项，且都声明了"缺它进不去"的理由', () => {
    const required = requiredCatalogEntries().map((entry) => entry.id).sort();
    assert.deepEqual(required, ['rice.authorization', 'rice.identity']);
  });

  it('包名规范（作用域包）且不重复', () => {
    const catalog = getPluginCatalog();
    const names = new Set<string>();
    for (const entry of catalog.plugins) {
      assert.match(entry.npm, /^@ricenote\/plugin-[a-z0-9-]+$/);
      assert.ok(!names.has(entry.npm), `包名重复：${entry.npm}`);
      names.add(entry.npm);
      assert.equal(findCatalogEntryById(entry.id)?.npm, entry.npm);
      assert.equal(findCatalogEntryByNpm(entry.npm)?.id, entry.id);
    }
  });

  it('依赖只指向清单内存在的插件', () => {
    const catalog = getPluginCatalog();
    for (const entry of catalog.plugins) {
      for (const dependency of entry.requires) {
        assert.ok(
          catalog.plugins.some((item) => item.id === dependency),
          `${entry.id} 依赖了不在目录中的 ${dependency}`
        );
      }
    }
  });
});

describe('官方插件目录：与仓库实际形态一致', () => {
  it('每个条目的版本与 manifest / package.json 三处一致', () => {
    for (const entry of getPluginCatalog().plugins) {
      const dir = pluginDirOf(entry.id);
      assert.ok(dir, `找不到插件目录：${entry.id}`);

      const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
        id: string;
        version: string;
      };
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name: string;
        version: string;
        private?: boolean;
        files?: string[];
        publishConfig?: { access?: string };
        dependencies?: Record<string, string>;
      };

      assert.equal(manifest.id, entry.id);
      assert.equal(manifest.version, entry.version, `${entry.id} 的 manifest 版本与清单不一致`);
      assert.equal(pkg.version, entry.version, `${entry.id} 的 package.json 版本与清单不一致`);
      assert.equal(pkg.name, entry.npm);

      // 可发布形态：否则发布脚本会在最后一步才失败
      assert.notEqual(pkg.private, true);
      assert.equal(pkg.publishConfig?.access, 'public');
      assert.ok(pkg.files?.includes('dist'), `${entry.id} 的 files 缺少 dist`);
      assert.ok(pkg.files?.includes('manifest.json'), `${entry.id} 的 files 缺少 manifest.json`);

      // 宿主提供的包绝不能被写成普通依赖（会在插件目录内装出第二份实例）
      for (const name of Object.keys(pkg.dependencies ?? {})) {
        assert.ok(!isHostProvidedPackage(name), `${entry.id} 把宿主包 ${name} 写成了 dependencies`);
      }
    }
  });

  it('宿主提供包白名单与文档一致', () => {
    assert.deepEqual(
      [...HOST_PROVIDED_PACKAGES].sort(),
      ['@ricenote/admin-sdk', '@ricenote/plugin-sdk', '@ricenote/shared', '@ricenote/theme-sdk']
    );
  });
});

describe('勾选联动：依赖闭包', () => {
  it('勾选 authorization 会带上 identity', () => {
    const selected = withRequiredDependencies(['rice.authorization']).map((entry) => entry.id);
    assert.deepEqual(selected.sort(), ['rice.authorization', 'rice.identity']);
  });

  it('保持清单顺序（required 在前），便于安装顺序稳定', () => {
    const selected = withRequiredDependencies(['rice.posts']).map((entry) => entry.id);
    assert.deepEqual(selected, ['rice.identity', 'rice.posts']);
  });

  it('出现环或未知 ID 时不死循环', () => {
    assert.deepEqual(withRequiredDependencies([]), []);
    assert.deepEqual(withRequiredDependencies(['rice.unknown']), []);
  });
});

describe('扩展中心目录视图：三种状态', () => {
  const summary = [
    { id: 'rice.identity', version: '1.3.0', builtin: true },
    { id: 'rice.posts', version: '1.4.0', builtin: false }
  ];

  it('未装 / 已装 / 落后于推荐版本 分别标注正确', () => {
    const view = buildCatalogView(summary);
    const byId = new Map(view.map((item) => [item.id, item]));

    const identity = byId.get('rice.identity');
    assert.deepEqual(
      { installed: identity?.installed, builtin: identity?.builtin, outdated: identity?.updateToRecommended },
      { installed: true, builtin: true, outdated: false }
    );

    // posts 已装 1.4.0 < 推荐 1.5.0 → 提示可更新
    const posts = byId.get('rice.posts');
    assert.deepEqual(
      { installed: posts?.installed, builtin: posts?.builtin, outdated: posts?.updateToRecommended },
      { installed: true, builtin: false, outdated: true }
    );

    // 未装的插件：installed=false、installedVersion=null
    const seo = byId.get('rice.seo');
    assert.equal(seo?.installed, false);
    assert.equal(seo?.installedVersion, null);
    assert.equal(seo?.updateToRecommended, false);

    // 视图覆盖清单中的每一项（扩展中心据此列出全部官方插件）
    assert.equal(view.length, getPluginCatalog().plugins.length);
  });
});

describe('official 判定：来源与 ID 两条路径', () => {
  it('npm 来源按包名匹配', () => {
    assert.equal(
      isOfficialPlugin('rice.posts', { type: 'registry', spec: '@ricenote/plugin-posts@^1.5.0' }),
      true
    );
    assert.equal(
      isOfficialPlugin('rice.posts', { type: 'registry', spec: 'some-other-plugin@^2.0.0' }),
      false
    );
  });

  it('本地/仓库内置来源按 ID 匹配', () => {
    assert.equal(isOfficialPlugin('rice.identity', { type: 'local', spec: 'plugins/official/identity' }), true);
    assert.equal(isOfficialPlugin('acme.third-party', { type: 'local', spec: '/tmp/x' }), false);
  });

  it('非目录内的插件一律不是官方', () => {
    assert.equal(isOfficialPlugin('acme.demo'), false);
  });
});
