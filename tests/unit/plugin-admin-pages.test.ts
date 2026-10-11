/**
 * 插件自带后台界面的声明解析与校验。
 *
 * 这些规则的价值在于"在启动/构建期把问题拦住"：
 * 界面入口写错、页面路径与别的插件冲突，最终表现都是"菜单点进去打不开"，
 * 排查成本远高于在这里报错。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isRiceNoteError, type PluginManifest } from '@ricenote/shared';
import { PLUGIN_ADMIN_URL_PREFIX, pluginAdminEntryUrl, resolveAdminPages } from '@ricenote/core';
import type { LoadedPlugin } from '@ricenote/core';

/** 构造一个最小可用的已发现插件（目录用仓库内真实存在的插件目录）。 */
function pluginWith(admin: PluginManifest['admin']): LoadedPlugin {
  const dir = path.resolve('plugins/official/navigation');
  return {
    manifest: {
      schemaVersion: 1,
      id: 'rice.navigation',
      name: '导航栏',
      version: '1.1.0',
      apiVersion: '^1.0.0',
      entry: './dist/index.js',
      ...(admin ? { admin } : {})
    },
    dir,
    entryPath: path.join(dir, 'dist/index.js'),
    builtin: true
  };
}

const PAGE = {
  id: 'navigation.items',
  label: '导航栏',
  path: '/navigation',
  icon: 'Navigation',
  order: 18,
  permission: 'nav.view',
  entry: './admin/main.js'
};

describe('pluginAdminEntryUrl：入口换算', () => {
  it('把 ./admin/x.js 换算为托管 URL', () => {
    assert.equal(
      pluginAdminEntryUrl('rice.navigation', './admin/main.js'),
      `${PLUGIN_ADMIN_URL_PREFIX}/rice.navigation/main.js`
    );
    assert.equal(
      pluginAdminEntryUrl('rice.posts', './admin/pages/list.js'),
      `${PLUGIN_ADMIN_URL_PREFIX}/rice.posts/pages/list.js`
    );
  });
});

describe('resolveAdminPages：声明解析', () => {
  it('补上插件 ID、托管 URL 与入口绝对路径', () => {
    const pages = resolveAdminPages(pluginWith({ pages: [PAGE] }));

    assert.equal(pages.length, 1);
    assert.equal(pages[0]?.pluginId, 'rice.navigation');
    assert.equal(pages[0]?.entryUrl, '/plugin-admin/rice.navigation/main.js');
    assert.equal(pages[0]?.entryPath, path.resolve('plugins/official/navigation/admin/main.js'));
    assert.equal(pages[0]?.permission, 'nav.view');
  });

  it('未声明 admin 的插件返回空清单', () => {
    assert.deepEqual(resolveAdminPages(pluginWith(undefined)), []);
  });

  it('声明 style 时同时算出样式托管 URL 与路径', () => {
    const pages = resolveAdminPages(
      pluginWith({ pages: [{ ...PAGE, style: './admin/style.css' }] })
    );

    assert.equal(pages[0]?.styleUrl, '/plugin-admin/rice.navigation/style.css');
    assert.equal(
      pages[0]?.stylePath,
      path.resolve('plugins/official/navigation/admin/style.css')
    );
  });

  it('未声明 style 时不下发样式 URL（宿主因此不会去探测文件）', () => {
    const pages = resolveAdminPages(pluginWith({ pages: [PAGE] }));
    assert.equal(pages[0]?.styleUrl, undefined);
    assert.equal(pages[0]?.stylePath, undefined);
  });

  it('路径必须以 / 开头', () => {
    assert.throws(
      () => resolveAdminPages(pluginWith({ pages: [{ ...PAGE, path: 'navigation' }] })),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_MANIFEST_INVALID'
    );
  });

  it('页面 ID 必须合法且同插件内唯一', () => {
    assert.throws(
      () => resolveAdminPages(pluginWith({ pages: [{ ...PAGE, id: 'BadId' }] })),
      (error: unknown) => isRiceNoteError(error)
    );
    assert.throws(
      () =>
        resolveAdminPages(
          pluginWith({ pages: [PAGE, { ...PAGE, path: '/other' }] })
        ),
      /ID 重复/
    );
  });

  it('同一插件内路径不得重复', () => {
    assert.throws(
      () =>
        resolveAdminPages(
          pluginWith({ pages: [PAGE, { ...PAGE, id: 'navigation.other' }] })
        ),
      /路径重复/
    );
  });
});
