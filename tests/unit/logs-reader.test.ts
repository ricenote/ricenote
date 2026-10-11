import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { LogsReader } from '@ricenote/core';
import { ErrorCode, isRiceNoteError } from '@ricenote/shared';

const workDir = mkdtempSync(path.join(tmpdir(), 'ricenote-logs-'));
let logsDir = '';

beforeEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  logsDir = path.join(workDir, 'logs');
  mkdirSync(logsDir, { recursive: true });
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 写入 JSON Lines 日志文件。 */
function writeLog(name: string, lines: unknown[]): void {
  const content = lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n';
  writeFileSync(path.join(logsDir, name), content, 'utf8');
}

const entry = (level: string, message: string, extra: Record<string, unknown> = {}) => ({
  ts: '2026-10-11T10:00:00.000Z',
  level,
  message,
  ...extra
});

describe('LogsReader：日志列表与基础解析', () => {
  it('缺少日志目录时返回空列表而非抛错', () => {
    const reader = new LogsReader({ logsDir: path.join(workDir, 'missing') });
    assert.deepEqual(reader.listFiles(), []);
  });

  it('只列出 .log 文件并按最近修改倒序', () => {
    writeLog('older.log', [entry('info', '旧')]);
    writeLog('newer.log', [entry('info', '新')]);
    writeFileSync(path.join(logsDir, 'notes.txt'), 'not a log', 'utf8');

    const names = new LogsReader({ logsDir }).listFiles().map((file) => file.name);
    assert.equal(names.length, 2);
    assert.ok(names.includes('older.log'));
    assert.ok(names.includes('newer.log'));
  });

  it('解析结构化字段与时间戳', () => {
    writeLog('server.log', [entry('info', '启动完成', { plugin: 'rice.posts', count: 3 })]);
    const result = new LogsReader({ logsDir }).query({});

    assert.equal(result.items.length, 1);
    const item = result.items[0]!;
    assert.equal(item.level, 'info');
    assert.equal(item.message, '启动完成');
    assert.equal(item.timestamp, '2026-10-11T10:00:00.000Z');
    assert.equal(item.fields.plugin, 'rice.posts');
    assert.equal(item.file, 'server.log');
    assert.equal(item.line, 1);
  });

  it('非 JSON 行按原文保留并标记 unparsed', () => {
    writeLog('server.log', ['纯文本输出', entry('warn', '正常行')]);
    const result = new LogsReader({ logsDir }).query({});

    assert.equal(result.items.length, 2);
    const raw = result.items.find((item) => item.message === '纯文本输出');
    assert.ok(raw);
    assert.equal(raw.fields.unparsed, true);
  });

  it('忽略空行与 CRLF 结尾', () => {
    writeFileSync(path.join(logsDir, 'server.log'), `${JSON.stringify(entry('info', 'A'))}\r\n\r\n`, 'utf8');
    const result = new LogsReader({ logsDir }).query({});
    assert.equal(result.items.length, 1);
  });
});

describe('LogsReader：过滤、排序与分页', () => {
  it('按级别过滤', () => {
    writeLog('server.log', [
      entry('info', 'a'),
      entry('warn', 'b'),
      entry('error', 'c'),
      entry('debug', 'd')
    ]);

    const reader = new LogsReader({ logsDir });
    assert.equal(reader.query({ level: 'error' }).items.length, 1);
    assert.equal(reader.query({ level: 'warn' }).items.length, 1);
    assert.equal(reader.query({ level: 'all' }).items.length, 4);
    assert.equal(reader.query({}).items.length, 4);
  });

  it('关键字同时匹配 message 与字段值', () => {
    writeLog('server.log', [
      entry('info', '插件已启动', { plugin: 'rice.search' }),
      entry('info', '其它', { plugin: 'rice.posts' })
    ]);

    const reader = new LogsReader({ logsDir });
    assert.equal(reader.query({ keyword: 'search' }).items.length, 1);
    assert.equal(reader.query({ keyword: '插件' }).items.length, 1);
    assert.equal(reader.query({ keyword: 'SEARCH' }).items.length, 1);
    assert.equal(reader.query({ keyword: '不存在' }).items.length, 0);
  });

  it('结果按时间倒序并支持分页', () => {
    writeLog('server.log', [
      { ts: '2026-10-11T10:00:01.000Z', level: 'info', message: '1' },
      { ts: '2026-10-11T10:00:03.000Z', level: 'info', message: '3' },
      { ts: '2026-10-11T10:00:02.000Z', level: 'info', message: '2' }
    ]);

    const reader = new LogsReader({ logsDir });
    const page1 = reader.query({ page: 1, pageSize: 2 });
    assert.deepEqual(
      page1.items.map((item) => item.message),
      ['3', '2']
    );
    assert.equal(page1.total, 3);

    const page2 = reader.query({ page: 2, pageSize: 2 });
    assert.deepEqual(
      page2.items.map((item) => item.message),
      ['1']
    );
  });

  it('跨多个文件聚合，且优先取最新文件', () => {
    writeLog('a.log', [entry('info', '来自 A')]);
    writeLog('b.log', [entry('info', '来自 B')]);

    const result = new LogsReader({ logsDir }).query({});
    assert.equal(result.total, 2);
    assert.equal(result.files.length, 2);
  });

  it('达到条目上限时标记 truncated', () => {
    writeLog('server.log', Array.from({ length: 50 }, (_, index) => entry('info', `第 ${index} 条`)));
    const result = new LogsReader({ logsDir, maxEntries: 10 }).query({});

    assert.equal(result.truncated, true);
    assert.equal(result.total, 10);
    assert.equal(result.items.length, 10);
  });

  it('超出读取窗口时只保留完整行（丢弃被截断的半行）', () => {
    const lines = Array.from({ length: 400 }, (_, index) => entry('info', `第 ${index} 条`, { pad: 'x'.repeat(60) }));
    writeLog('server.log', lines);

    // 窗口仅 1KB，远小于文件体积，应丢弃首个不完整的行
    const result = new LogsReader({ logsDir, tailBytes: 1024 }).query({ pageSize: 200 });
    assert.ok(result.scannedLines > 0);
    assert.ok(result.scannedLines < lines.length);
    for (const item of result.items) {
      assert.match(item.message, /^第 \d+ 条$/);
    }
  });
});

describe('LogsReader：路径安全', () => {
  it('拒绝路径穿越文件名', () => {
    const reader = new LogsReader({ logsDir });
    const error = (() => {
      try {
        reader.query({ file: '../secret.log' });
        return undefined;
      } catch (reason) {
        return reason;
      }
    })();

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.LOG_PATH_UNSAFE);
  });

  it('拒绝带目录分隔符的文件名', () => {
    const reader = new LogsReader({ logsDir });
    const attempted = ['sub/other.log', '..\\win.log', '/etc/passwd'];

    for (const name of attempted) {
      const error = (() => {
        try {
          reader.query({ file: name });
          return undefined;
        } catch (reason) {
          return reason;
        }
      })();
      assert.ok(isRiceNoteError(error), `应拒绝：${name}`);
      assert.equal(error.code, ErrorCode.LOG_PATH_UNSAFE);
    }
  });

  it('不存在的日志文件返回 404 错误码', () => {
    const error = (() => {
      try {
        new LogsReader({ logsDir }).query({ file: 'nope.log' });
        return undefined;
      } catch (reason) {
        return reason;
      }
    })();

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.NOT_FOUND);
  });

  it('指定合法文件时只读取该文件', () => {
    writeLog('a.log', [entry('info', '来自 A')]);
    writeLog('b.log', [entry('info', '来自 B')]);

    const result = new LogsReader({ logsDir }).query({ file: 'a.log' });
    assert.equal(result.total, 1);
    assert.deepEqual(result.files, ['a.log']);
  });
});
