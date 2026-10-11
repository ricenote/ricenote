import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import AdmZip from 'adm-zip';
import { createManifestValidator } from '@ricenote/shared';
import { extractZipSafely } from '@ricenote/core';
import { buildRawZip } from './raw-zip.js';

/** 测试以 tests/ 为工作目录运行，因此需要显式定位仓库根目录。 */
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workDir = mkdtempSync(path.join(tmpdir(), 'ricenote-zip-'));

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 构造一个包含指定条目的内存 ZIP。 */
function buildZip(entries: { name: string; content: string }[]): Buffer {
  const zip = new AdmZip();
  for (const entry of entries) {
    zip.addFile(entry.name, Buffer.from(entry.content, 'utf8'));
  }
  return zip.toBuffer();
}

describe('主题 ZIP 安装安全校验', () => {
  it('正常主题包可安全解压', () => {
    const target = path.join(workDir, 'ok');
    const archive = buildZip([
      { name: 'theme.json', content: '{"schemaVersion":1}' },
      { name: 'templates/index.njk', content: '<h1>hi</h1>' }
    ]);

    const result = extractZipSafely(archive, target);
    assert.equal(result.files.length, 2);
    assert.equal(result.files.includes('theme.json'), true);
  });

  it('拒绝 Zip Slip 路径穿越', () => {
    const archive = buildRawZip([{ name: '../escape.json', content: 'x' }]);
    assert.throws(() => extractZipSafely(archive, path.join(workDir, 'slip')), /路径非法|逃逸/);
  });

  it('拒绝绝对路径与 Windows 盘符', () => {
    assert.throws(
      () => extractZipSafely(buildRawZip([{ name: '/etc/passwd', content: 'x' }]), path.join(workDir, 'abs')),
      /路径非法/
    );
    assert.throws(
      () => extractZipSafely(buildRawZip([{ name: 'C:/windows/x.css', content: 'x' }]), path.join(workDir, 'drive')),
      /路径非法/
    );
  });

  it('拒绝反斜杠绕过', () => {
    assert.throws(
      () => extractZipSafely(buildRawZip([{ name: '..\\evil.css', content: 'x' }]), path.join(workDir, 'backslash')),
      /路径非法/
    );
  });

  it('拒绝符号链接条目（穿越到目标目录之外）', () => {
    assert.throws(
      () =>
        extractZipSafely(
          buildRawZip([{ name: 'link.css', content: '/etc/passwd', unixMode: 0xa1ff }]),
          path.join(workDir, 'symlink')
        ),
      /符号链接/
    );
  });

  it('拒绝白名单外的扩展名', () => {
    assert.throws(
      () => extractZipSafely(buildZip([{ name: 'evil.php', content: '<?php ?>' }]), path.join(workDir, 'ext')),
      /不允许的文件类型/
    );
  });

  it('超出自定义体积上限时拒绝', () => {
    const archive = buildZip([{ name: 'big.css', content: 'a'.repeat(4096) }]);
    assert.throws(
      () =>
        extractZipSafely(archive, path.join(workDir, 'big'), {
          maxArchiveBytes: 32 * 1024 * 1024,
          maxEntries: 100,
          maxTotalUncompressedBytes: 1024,
          maxEntryUncompressedBytes: 512,
          maxPathDepth: 8,
          allowedExtensions: ['.css']
        }),
      /体积/
    );
  });

  it('在发现恶意条目前不写入任何文件（两阶段校验）', () => {
    const target = path.join(workDir, 'atomic');
    const archive = buildRawZip([
      { name: 'theme.json', content: '{}' },
      { name: '../escape.txt', content: 'x' }
    ]);

    assert.throws(() => extractZipSafely(archive, target));
    // 两阶段校验：恶意条目在写入任何文件之前就被发现
    const written = existsSync(target) ? readdirSync(target) : [];
    assert.equal(written.length, 0);
  });
});

describe('清单完整性（真实插件与主题目录）', () => {
  it('两套内置主题的 theme.json 均通过 Schema 校验', () => {
    const validator = createManifestValidator();

    for (const theme of ['minimal', 'default']) {
      const manifestPath = path.resolve(rootDir, `themes/${theme}/theme.json`);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
      const result = validator.validateTheme(manifest);
      assert.equal(result.valid, true, `${theme}: ${JSON.stringify(result.issues)}`);
    }
  });

  it('全部官方插件的 manifest.json 均通过 Schema 校验', () => {
    const validator = createManifestValidator();

    for (const plugin of ['identity', 'authorization', 'posts', 'taxonomy', 'media', 'hello']) {
      const manifestPath = path.resolve(rootDir, `plugins/official/${plugin}/manifest.json`);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
      const result = validator.validatePlugin(manifest);
      assert.equal(result.valid, true, `${plugin}: ${JSON.stringify(result.issues)}`);
    }
  });
});
