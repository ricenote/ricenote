import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { loadConfig, resolveRootDir } from '@ricenote/core';

const workDir = mkdtempSync(path.join(tmpdir(), 'ricenote-root-'));

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 构造一个带工作区标记文件的目录树。 */
function makeWorkspace(name: string, nested: string): { root: string; cwd: string } {
  const root = path.join(workDir, name);
  const cwd = path.join(root, nested);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n', 'utf8');
  return { root, cwd };
}

describe('resolveRootDir：项目根目录定位', () => {
  it('从包目录向上找到工作区根目录', () => {
    const { root, cwd } = makeWorkspace('nested-ws', 'apps/server');
    assert.equal(resolveRootDir(cwd), root);
  });

  it('已经是根目录时直接返回（不做多余解析）', () => {
    const { root } = makeWorkspace('at-root', '.');
    assert.equal(resolveRootDir(root), root);
  });

  it('找不到标记文件时回退为传入目录（不抛错）', () => {
    const lonely = path.join(workDir, 'lonely', 'deep');
    mkdirSync(lonely, { recursive: true });
    assert.equal(resolveRootDir(lonely), path.resolve(lonely));
  });

  it('多级嵌套也能找到最近的根目录', () => {
    const { root, cwd } = makeWorkspace('deep-ws', 'apps/server/src/http');
    assert.equal(resolveRootDir(cwd), root);
  });

  it('loadConfig 默认使用解析出的根目录（能读到根目录 .env 的路径配置）', () => {
    const root = path.join(workDir, 'config-ws');
    const cwd = path.join(root, 'apps', 'server');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');
    writeFileSync(
      path.join(root, '.env'),
      ['DB_HOST=127.0.0.1', 'DB_USER=root', 'DB_NAME=rootcfg', 'STORAGE_DIR=./storage'].join('\n'),
      'utf8'
    );

    // 明确传入 rootDir，避免读取仓库自身的 .env 造成用例相互干扰
    const config = loadConfig({ rootDir: root, loadDotEnv: true });
    assert.equal(config.paths.rootDir, root);
    assert.equal(config.paths.storageDir, path.join(root, 'storage'));
    assert.equal(config.paths.pluginsDir, path.join(root, 'plugins/official'));
    assert.equal(config.paths.themesDir, path.join(root, 'themes'));
    assert.equal(config.database.name, 'rootcfg');
  });

  it('未显式传 rootDir 时，paths.rootDir 与解析结果一致', () => {
    const config = loadConfig({ loadDotEnv: false });
    // 测试进程 cwd 位于仓库内的 tests/ 目录，应向上解析到仓库根
    assert.equal(config.paths.rootDir, resolveRootDir());
    assert.equal(config.paths.rootDir.endsWith(path.join('ricenote', 'tests')) , false);
  });
});
