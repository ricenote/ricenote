import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import AdmZip from 'adm-zip';
import { BackupService, createLogger, loadConfig, type DatabaseAdapter } from '@ricenote/core';
import { ErrorCode, isRiceNoteError } from '@ricenote/shared';
import { buildRawZip } from './raw-zip.js';

const workDir = mkdtempSync(path.join(tmpdir(), 'ricenote-backup-'));
const logger = createLogger({ level: 'error' });

let service: BackupService;

/** `inspect` 与工具探测都不触达数据库，因此用一个空壳替代真实连接池。 */
const dbStub = {} as DatabaseAdapter;

before(() => {
  // 不使用仓库的 .env：测试应当自包含，避免受本机配置影响
  const config = loadConfig({ rootDir: workDir, loadDotEnv: false });
  service = new BackupService({ config, logger, db: dbStub });
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 构造一个最小可用的备份包。 */
function buildBackupZip(
  manifest: Record<string, unknown>,
  extra: Record<string, string> = { 'database.sql': 'SELECT 1;' }
): Buffer {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
  for (const [name, content] of Object.entries(extra)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

const VALID_MANIFEST = {
  formatVersion: 1,
  createdAt: '2026-10-11T00:00:00.000Z',
  appVersion: '0.1.0',
  siteId: 'default',
  database: { name: 'ricenote', host: '127.0.0.1', port: 3306 },
  plugins: [{ id: 'rice.posts', version: '1.1.0', enabled: true }],
  themes: [{ id: 'rice.minimal', version: '1.0.0', active: true }],
  uploads: { fileCount: 0, totalBytes: 0 }
};

describe('BackupService.inspect：备份包只读解析', () => {
  it('合法备份包返回清单与 dump 体积', async () => {
    const result = await service.inspect(buildBackupZip(VALID_MANIFEST));

    assert.equal(result.manifest.siteId, 'default');
    assert.equal(result.manifest.plugins.length, 1);
    assert.equal(result.manifest.themes[0]?.active, true);
    assert.ok(result.dumpBytes > 0);
  });

  it('缺少 manifest.json 时拒绝', async () => {
    const zip = new AdmZip();
    zip.addFile('database.sql', Buffer.from('SELECT 1;', 'utf8'));

    const error = await service.inspect(zip.toBuffer()).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.RESTORE_FAILED);
    assert.match(error.message, /manifest\.json/);
  });

  it('缺少 database.sql 时拒绝', async () => {
    const error = await service
      .inspect(buildBackupZip(VALID_MANIFEST, {}))
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.RESTORE_FAILED);
    assert.match(error.message, /database\.sql/);
  });

  it('不支持的格式版本时拒绝', async () => {
    const error = await service
      .inspect(buildBackupZip({ ...VALID_MANIFEST, formatVersion: 2 }))
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.RESTORE_FAILED);
    assert.match(error.message, /格式版本/);
  });

  it('清单不是合法 JSON 时拒绝', async () => {
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from('{ not json', 'utf8'));
    zip.addFile('database.sql', Buffer.from('SELECT 1;', 'utf8'));

    const error = await service.inspect(zip.toBuffer()).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.RESTORE_FAILED);
  });

  it('Zip Slip 恶意备份包被拒绝（复用同一套 ZIP 安全校验）', async () => {
    const archive = buildRawZip([
      { name: 'manifest.json', content: JSON.stringify(VALID_MANIFEST) },
      { name: 'database.sql', content: 'SELECT 1;' },
      { name: '../../escaped.sql', content: 'DROP DATABASE ricenote;' }
    ]);

    const error = await service.inspect(archive).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.RESTORE_FAILED);
  });

  it('不接受的白名单外文件类型被拒绝', async () => {
    const archive = buildRawZip([
      { name: 'manifest.json', content: JSON.stringify(VALID_MANIFEST) },
      { name: 'database.sql', content: 'SELECT 1;' },
      { name: 'evil.sh', content: 'rm -rf /' }
    ]);

    const error = await service.inspect(archive).then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.RESTORE_FAILED);
  });
});

describe('BackupService 工具探测', () => {
  it('备份工具不在 PATH 时返回结构化错误码而非 500', async () => {
    const config = loadConfig({ rootDir: workDir, loadDotEnv: false });
    const broken = new BackupService({
      config,
      logger,
      db: dbStub,
      mysqldumpBinary: 'ricenote-definitely-missing-dump',
      mysqlBinary: 'ricenote-definitely-missing-client'
    });

    const error = await broken.assertToolsAvailable().then(
      () => undefined,
      (reason: unknown) => reason
    );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.BACKUP_TOOL_MISSING);
    assert.equal(error.status, 503);
    assert.match(error.message, /不在 PATH/);
  });

  it('快照文件名的路径穿越被拒绝', () => {
    const error = (() => {
      try {
        service.resolveSnapshotPath('../secret.zip');
        return undefined;
      } catch (reason) {
        return reason;
      }
    })();

    assert.ok(isRiceNoteError(error));
  });
});

describe('BackupService 快照列表', () => {
  it('备份目录不存在时返回空列表', () => {
    assert.deepEqual(service.listSnapshots(), []);
  });

  it('列出快照并按时间倒序', async () => {
    const dir = path.join(workDir, 'storage', 'backups');
    mkdirSync(dir, { recursive: true });

    // 显式设置 mtime：连续写入的两个文件 mtime 可能落在同一毫秒，导致排序不确定
    const older = path.join(dir, 'backup-20260101-000000.zip');
    const newer = path.join(dir, 'backup-20260202-000000.zip');
    writeFileSync(older, Buffer.alloc(10));
    writeFileSync(newer, Buffer.alloc(20));
    utimesSync(older, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    utimesSync(newer, new Date('2026-02-02T00:00:00Z'), new Date('2026-02-02T00:00:00Z'));

    const snapshots = service.listSnapshots();
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0]?.name, 'backup-20260202-000000.zip');
    assert.equal(snapshots[0]?.size, 20);
    assert.equal(snapshots[1]?.name, 'backup-20260101-000000.zip');
  });
});
