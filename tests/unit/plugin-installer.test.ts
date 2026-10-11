import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import AdmZip from 'adm-zip';
import { createLogger, installPluginFromZip } from '@ricenote/core';
import { ErrorCode, isRiceNoteError } from '@ricenote/shared';
import { buildRawZip } from './raw-zip.js';

const logger = createLogger({ level: 'error' });
const workDir = mkdtempSync(path.join(tmpdir(), 'ricenote-installer-'));

let installDir = '';
let cacheDir = '';

beforeEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  installDir = path.join(workDir, 'third-party');
  cacheDir = path.join(workDir, 'cache');
  mkdirSync(cacheDir, { recursive: true });
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 构造一个合法插件包。 */
function buildPluginZip(
  manifest: Record<string, unknown>,
  files: Record<string, string> = { 'dist/index.js': 'export default {};' }
): Buffer {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

const VALID_MANIFEST = {
  schemaVersion: 1,
  id: 'acme.notes',
  name: '笔记',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  entry: './dist/index.js'
};

function install(archive: Buffer) {
  return installPluginFromZip({ archive, installDir, cacheDir, logger });
}

/** 断言缓存目录中不残留 staging 目录。 */
function assertNoStagingLeftovers(): void {
  const leftovers = readdirSync(cacheDir).filter((name) => name.startsWith('plugin-install-'));
  assert.deepEqual(leftovers, [], '不应残留临时解压目录');
}

describe('installPluginFromZip：插件包安装', () => {
  it('合法插件包安装成功且落盘到安装目录', async () => {
    const result = await install(buildPluginZip(VALID_MANIFEST));

    assert.equal(result.pluginId, 'acme.notes');
    assert.equal(result.version, '1.0.0');
    assert.equal(result.dir, 'notes');
    assert.equal(result.upgraded, false);
    assert.equal(result.restartRequired, true);

    const target = path.join(installDir, 'notes');
    assert.ok(existsSync(path.join(target, 'manifest.json')));
    assert.ok(existsSync(path.join(target, 'dist', 'index.js')));
    assertNoStagingLeftovers();
  });

  it('兼容压缩包内多包一层目录的打包方式', async () => {
    const wrapped = new AdmZip();
    wrapped.addFile('package/manifest.json', Buffer.from(JSON.stringify(VALID_MANIFEST), 'utf8'));
    wrapped.addFile('package/dist/index.js', Buffer.from('export default {};', 'utf8'));

    const result = await install(wrapped.toBuffer());
    assert.equal(result.pluginId, 'acme.notes');
    assert.ok(existsSync(path.join(installDir, 'notes', 'manifest.json')));
    assert.ok(existsSync(path.join(installDir, 'notes', 'dist', 'index.js')));
  });

  it('同 ID 再次安装视为升级', async () => {
    await install(buildPluginZip(VALID_MANIFEST));
    const upgraded = await install(
      buildPluginZip({ ...VALID_MANIFEST, version: '1.1.0' }, { 'dist/index.js': 'export default {v:"1.1.0"};' })
    );

    assert.equal(upgraded.upgraded, true);
    assert.equal(upgraded.version, '1.1.0');
    assert.ok(existsSync(path.join(installDir, 'notes', 'manifest.json')));
  });

  it('目录被其他插件 ID 占用时拒绝安装（409）', async () => {
    await install(buildPluginZip(VALID_MANIFEST));

    const error = await install(buildPluginZip({ ...VALID_MANIFEST, id: 'other.notes' })).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.PLUGIN_INSTALL_FAILED);
    assert.equal(error.status, 409);
    assertNoStagingLeftovers();
  });

  it('缺少 manifest.json 时拒绝且不留残留', async () => {
    const zip = new AdmZip();
    zip.addFile('dist/index.js', Buffer.from('export default {};', 'utf8'));

    const error = await install(zip.toBuffer()).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.PLUGIN_INSTALL_FAILED);
    assert.match(error.message, /manifest\.json/);
    assert.equal(existsSync(installDir), false);
    assertNoStagingLeftovers();
  });

  it('清单校验失败时返回具体问题', async () => {
    const error = await install(buildPluginZip({ ...VALID_MANIFEST, apiVersion: undefined })).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.PLUGIN_INSTALL_FAILED);
    assert.ok(Array.isArray(error.details.issues));
    assertNoStagingLeftovers();
  });

  it('缺少入口文件时拒绝', async () => {
    const error = await install(buildPluginZip(VALID_MANIFEST, {})).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.PLUGIN_INSTALL_FAILED);
    assert.match(error.message, /入口文件/);
    assert.equal(existsSync(installDir), false);
    assertNoStagingLeftovers();
  });

  it('声明了不存在的迁移目录时拒绝', async () => {
    const manifest = { ...VALID_MANIFEST, migrations: './migrations' };
    const error = await install(buildPluginZip(manifest)).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.PLUGIN_INSTALL_FAILED);
    assert.match(error.message, /迁移目录/);
  });

  it('声明的迁移目录存在时正常安装', async () => {
    const manifest = { ...VALID_MANIFEST, migrations: './migrations' };
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
    zip.addFile('dist/index.js', Buffer.from('export default {};', 'utf8'));
    zip.addFile('migrations/0001_init.sql', Buffer.from('CREATE TABLE t (id INT);', 'utf8'));

    const result = await install(zip.toBuffer());
    assert.equal(result.pluginId, 'acme.notes');
    assert.ok(existsSync(path.join(installDir, 'notes', 'migrations', '0001_init.sql')));
  });

  it('Zip Slip 恶意包被拒绝且不落盘（插件专用错误码）', async () => {
    const archive = buildRawZip([
      { name: 'manifest.json', content: JSON.stringify(VALID_MANIFEST) },
      { name: '../../escaped.js', content: 'export default {};' }
    ]);

    const error = await install(archive).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.PLUGIN_ARCHIVE_UNSAFE);
    assert.equal(existsSync(path.join(workDir, 'escaped.js')), false);
    assert.equal(existsSync(path.join(installDir, 'notes')), false);
    assertNoStagingLeftovers();
  });

  it('不允许的文件类型被拒绝', async () => {
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(VALID_MANIFEST), 'utf8'));
    zip.addFile('dist/index.js', Buffer.from('export default {};', 'utf8'));
    zip.addFile('bin/native.node', Buffer.from('binary', 'utf8'));

    const error = await install(zip.toBuffer()).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.PLUGIN_ARCHIVE_UNSAFE);
    assertNoStagingLeftovers();
  });

  it('入口路径越出插件目录时拒绝', async () => {
    const manifest = { ...VALID_MANIFEST, entry: './../../outside.js' };
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'));

    const error = await install(zip.toBuffer()).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.PLUGIN_INSTALL_FAILED);
  });

  it('安装时忽略压缩包内的无关文件（只按白名单放行）', async () => {
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(VALID_MANIFEST), 'utf8'));
    zip.addFile('dist/index.js', Buffer.from('export default {};', 'utf8'));
    zip.addFile('README.md', Buffer.from('# 说明', 'utf8'));

    const result = await install(zip.toBuffer());
    assert.equal(result.pluginId, 'acme.notes');
    assert.ok(existsSync(path.join(installDir, 'notes', 'README.md')));
  });
});

describe('installPluginFromZip：覆盖安装的目录卫生', () => {
  it('升级时整体替换目录，不残留上一版本的旧文件', async () => {
    await install(
      buildPluginZip(VALID_MANIFEST, {
        'dist/index.js': 'export default {v:"1.0.0"};',
        'dist/legacy.js': 'export default {old:true};'
      })
    );
    assert.ok(existsSync(path.join(installDir, 'notes', 'dist', 'legacy.js')));

    await install(
      buildPluginZip(
        { ...VALID_MANIFEST, version: '1.1.0' },
        { 'dist/index.js': 'export default {v:"1.1.0"};' }
      )
    );

    assert.equal(existsSync(path.join(installDir, 'notes', 'dist', 'legacy.js')), false);
    const manifest = JSON.parse(
      readFileSync(path.join(installDir, 'notes', 'manifest.json'), 'utf8')
    ) as { version: string };
    assert.equal(manifest.version, '1.1.0');
  });
});
