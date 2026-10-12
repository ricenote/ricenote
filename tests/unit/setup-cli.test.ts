/**
 * 安装向导的纯逻辑单元测试（离线、无数据库、无交互终端）。
 *
 * 压着的性质：
 * - `parseSetupArgs` 是容器/CI 场景的唯一入口，参数解析错了会直接装错东西；
 * - `upsertEnvFile` 必须**增量更新**：用户的注释、手写键与顺序都不能被冲掉，
 *   否则"重跑一次向导"就等于把运维的手工配置抹了；
 * - 生成的凭据要满足身份插件的校验（长度、非纯数字），否则首次启动建管理员会失败；
 * - 库名要挡住 DDL 注入（它会被拼进 `CREATE DATABASE`）。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { validateDatabaseName } from '@ricenote/core';
import { parseSetupArgs } from '../../apps/server/src/cli/setup.js';
import {
  buildDatabaseUrl,
  generateAdminPassword,
  generateSessionSecret,
  readEnvFile,
  upsertEnvFile
} from '../../apps/server/src/cli/setup-env.js';

describe('parseSetupArgs：非交互参数解析', () => {
  it('识别开关', () => {
    const options = parseSetupArgs(['--yes', '--skip-install', '--from-manifest', '--no-scripts', '--force-env']);
    assert.deepEqual(
      {
        yes: options.yes,
        skipInstall: options.skipInstall,
        fromManifest: options.fromManifest,
        allowScripts: options.allowScripts,
        forceEnv: options.forceEnv
      },
      { yes: true, skipInstall: true, fromManifest: true, allowScripts: false, forceEnv: true }
    );
  });

  it('默认允许脚本执行（高风险确认由后台承担）', () => {
    assert.equal(parseSetupArgs([]).allowScripts, true);
    assert.equal(parseSetupArgs([]).yes, false);
  });

  it('解析 `--key=value` 与 `--key value` 两种写法', () => {
    const inline = parseSetupArgs(['--db-host=db.internal', '--db-port=3307', '--site-title=我的站']);
    assert.equal(inline.db.host, 'db.internal');
    assert.equal(inline.db.port, 3307);
    assert.equal(inline.site.title, '我的站');

    const spaced = parseSetupArgs(['--db-name', 'ricenote_prod', '--admin-username', 'root']);
    assert.equal(spaced.db.name, 'ricenote_prod');
    assert.equal(spaced.admin.username, 'root');
  });

  it('解析连接串（口令里的特殊字符要能还原）', () => {
    const options = parseSetupArgs(['--db-url=mysql://user:p%40ss%3Aword@127.0.0.1:3306/ricenote_x']);
    assert.deepEqual(options.db, {
      host: '127.0.0.1',
      port: 3306,
      user: 'user',
      password: 'p@ss:word',
      name: 'ricenote_x'
    });
  });

  it('连接串里的分项可被显式参数覆盖', () => {
    const options = parseSetupArgs(['--db-url=mysql://root:x@127.0.0.1:3306/a', '--db-name=b']);
    assert.equal(options.db.name, 'b');
    assert.equal(options.db.user, 'root');
  });

  it('插件清单按逗号切分并去掉空白', () => {
    const options = parseSetupArgs(['--plugins=posts, seo ,pages']);
    assert.deepEqual(options.plugins, ['posts', 'seo', 'pages']);
  });

  it('--help 独立于其他参数生效', () => {
    assert.equal(parseSetupArgs(['--help']).help, true);
    assert.equal(parseSetupArgs(['-h']).help, true);
  });

  it('解析本进程监听地址与端口（与数据库的 --db-* 各归各的）', () => {
    const options = parseSetupArgs([
      '--host=127.0.0.1',
      '--port=8080',
      '--db-host=db.internal',
      '--db-port=3307'
    ]);
    assert.equal(options.http.host, '127.0.0.1');
    assert.equal(options.http.port, 8080);
    /*
     * 这条断言压着本次改动最容易踩的坑：`--port`（站点监听）与 `--db-port`（数据库）
     * 名字相近，若解析时互相覆盖，用户的"换个端口跑"会变成"连错数据库"。
     */
    assert.equal(options.db.host, 'db.internal');
    assert.equal(options.db.port, 3307);

    const spaced = parseSetupArgs(['--host', '0.0.0.0', '--port', '65535']);
    assert.equal(spaced.http.host, '0.0.0.0');
    assert.equal(spaced.http.port, 65535);
  });

  it('未提供监听参数时留空（默认值交给 .env 与默认档决定）', () => {
    const options = parseSetupArgs(['--yes']);
    assert.equal(options.http.host, undefined);
    assert.equal(options.http.port, undefined);
  });

  it('非法监听端口在解析阶段就被拒绝（而不是装完启动时才炸）', () => {
    /*
     * 端口是**进程绑定**参数：`0` 会让内核随机分配（用户却以为固定下来了）、
     * `65536` / `abc` / 空串只会在 `pnpm start` 的 listen 阶段才报错 ——
     * 那时向导早已以 0 退出，用户拿到的是一个起不来的站点。
     */
    for (const bad of ['0', '65536', 'abc', '3000.5', '-1', '', ' ']) {
      assert.throws(() => parseSetupArgs([`--port=${bad}`]), /--port/, `端口「${bad}」应被拒绝`);
    }
    assert.throws(() => parseSetupArgs(['--host=']), /--host/, '空的监听地址应被拒绝');

    // 边界值必须放行，否则 1 与 65535 会变成"看起来像错的"合法配置
    assert.equal(parseSetupArgs(['--port=1']).http.port, 1);
    assert.equal(parseSetupArgs(['--port=65535']).http.port, 65535);
  });
});

describe('upsertEnvFile：增量更新，不冲掉用户内容', () => {
  let dir: string;
  const file = (): string => path.join(dir, '.env');

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ricenote-env-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('空文件也能生成合法的 .env（不留开头空行）', () => {
    const result = upsertEnvFile(file(), [
      { key: 'DB_HOST', value: '127.0.0.1' },
      { key: 'DB_NAME', value: 'ricenote' }
    ]);
    assert.deepEqual(result.added, ['DB_HOST', 'DB_NAME']);
    const text = readFileSync(file(), 'utf8');
    assert.ok(!text.startsWith('\n'), '生成的文件不应以空行开头');
    assert.match(text, /^DB_HOST=127\.0\.0\.1$/m);
  });

  it('重跑是幂等的：原位替换，不产生重复行', () => {
    upsertEnvFile(file(), [{ key: 'DB_HOST', value: 'db.internal' }]);
    upsertEnvFile(file(), [{ key: 'DB_HOST', value: 'db.internal' }]);
    const text = readFileSync(file(), 'utf8');
    assert.equal(text.match(/^DB_HOST=/gm)?.length, 1);
    assert.match(text, /^DB_HOST=db\.internal$/m);
    assert.equal(readEnvFile(file()).DB_HOST, 'db.internal');
  });

  it('保留注释、手写键与顺序', () => {
    const custom = path.join(dir, 'custom.env');
    writeFileSync(
      custom,
      ['# 我的注释', 'DB_HOST=old', 'MY_HAND_WRITTEN=keep-me', 'DB_NAME=ricenote', ''].join('\n')
    );

    upsertEnvFile(custom, [{ key: 'DB_HOST', value: 'new' }, { key: 'SESSION_SECRET', value: 's3cret' }]);
    const lines = readFileSync(custom, 'utf8').split('\n');

    assert.equal(lines[0], '# 我的注释');
    assert.equal(lines[1], 'DB_HOST=new');
    assert.equal(lines[2], 'MY_HAND_WRITTEN=keep-me');
    assert.equal(lines[3], 'DB_NAME=ricenote');
    assert.ok(readFileSync(custom, 'utf8').includes('SESSION_SECRET=s3cret'));
  });

  it('含空白或 # 的值会加引号（否则 dotenv 会当成注释截断）', () => {
    const quoted = path.join(dir, 'quoted.env');
    upsertEnvFile(quoted, [
      { key: 'DB_PASSWORD', value: 'p@ss word#1' },
      { key: 'SITE_TITLE', value: 'My Site' }
    ]);
    assert.equal(readEnvFile(quoted).DB_PASSWORD, 'p@ss word#1');
    assert.equal(readEnvFile(quoted).SITE_TITLE, 'My Site');
  });
});

describe('凭据生成与连接串', () => {
  it('SESSION_SECRET 每次不同且足够长', () => {
    const first = generateSessionSecret();
    const second = generateSessionSecret();
    assert.notEqual(first, second);
    assert.ok(first.length >= 32, `熵不足：${first.length}`);
  });

  it('初始管理员密码满足身份插件的校验（长度 ≥ 8 且非纯数字）', () => {
    const password = generateAdminPassword();
    assert.ok(password.length >= 8);
    assert.ok(!/^\d+$/.test(password));
  });

  it('DATABASE_URL 对口令做 URL 编码', () => {
    const url = buildDatabaseUrl({
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'p@ss:word/1',
      name: 'ricenote'
    });
    assert.equal(url, 'mysql://root:p%40ss%3Aword%2F1@127.0.0.1:3306/ricenote');
  });
});

describe('库名校验：DDL 注入防线', () => {
  it('接受合法库名', () => {
    assert.equal(validateDatabaseName('ricenote'), undefined);
    assert.equal(validateDatabaseName('rice_note$1'), undefined);
  });

  it('拒绝空值、非法字符与超长', () => {
    assert.ok(validateDatabaseName(''));
    assert.ok(validateDatabaseName('rice note'));
    assert.ok(validateDatabaseName('ricenote; DROP TABLE rn_plugins'));
    assert.ok(validateDatabaseName('1ricenote'));
    assert.ok(validateDatabaseName('a'.repeat(65)));
  });
});
