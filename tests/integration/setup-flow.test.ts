/**
 * 安装向导（`ricenote setup`）的端到端集成测试 —— **完全离线可复现**。
 *
 * 做法：
 * 1. 把官方插件按"发布形态"暂存（manifest + dist + admin，**不含 src 与 tsconfig**），
 *    用 `tar` 打成 npm tarball —— 与 `pnpm publish` 产出的包结构一致；
 * 2. 在测试进程内起一个静态 registry（metadata + tarball），
 *    把 `RICENOTE_NPM_REGISTRY` 指向它，因此不访问真实 npm；
 * 3. **异步 spawn** 真实 CLI（不是 spawnSync）：本进程里的 registry 必须能继续
 *    响应子进程的 HTTP 请求 —— 用阻塞式调用起服务会让双方死等（这正是
 *    最初那版手工演练"卡住"的原因）；
 * 4. 断言：退出码、落盘目录、`.env` 清单、`rn_plugins` 来源记录、管理员创建。
 *
 * 覆盖的关键性质：**必需插件不可被绕过**（只请求 posts 也必须装上
 * identity 与 authorization，否则后台装完就进不去）。
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as tar from 'tar';
import mysql from 'mysql2/promise';

const ROOT = path.resolve(process.cwd(), '..');
/**
 * 测试库名**必须按进程隔离**：本测试会 `DROP DATABASE` 再建库，
 * 若用固定名字，两个测试进程（或与队友并发的构建/测试）同时跑时，
 * 后启动的那个会把前一个正在用的库直接删掉 —— 表现为随机的
 * "表不存在 / 连接被关闭"，而单独复跑又全绿。这类"复跑才好"的失败
 * 最难排查，所以从命名上根除，而不是靠"别并发跑"的约定。
 */
const TEST_DB = `ricenote_setup_flow_${process.pid}`;
const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: 'cc80212562' };
const BASE_ENV = { ...process.env };

interface CatalogEntry {
  id: string;
  npm: string;
  version: string;
  category: string;
}

const catalog = JSON.parse(
  readFileSync(path.join(ROOT, 'packages/shared/manifests/plugin-catalog.json'), 'utf8')
) as { plugins: CatalogEntry[] };

/** 官方插件目录名 → 绝对路径（按 manifest.id 匹配，不依赖目录名与 ID 同名）。 */
function pluginDirOf(id: string): string {
  for (const entry of readdirSync(path.join(ROOT, 'plugins/official'), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(ROOT, 'plugins/official', entry.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    if ((JSON.parse(readFileSync(manifestPath, 'utf8')) as { id?: string }).id === id) return dir;
  }
  throw new Error(`找不到官方插件目录：${id}`);
}

/**
 * 按「发布形态」暂存一个插件并打成 tarball。
 *
 * 关键点：**不复制 `src/` 与 `tsconfig.json`** —— 发布包只有产物，
 * 安装编排据此识别为"只含产物"并跳过依赖安装与构建（否则会去联网装依赖）。
 */
function packPlugin(entry: CatalogEntry, workDir: string): Buffer {
  const source = pluginDirOf(entry.id);
  const staging = path.join(workDir, 'staging', entry.id);
  const packageDir = path.join(staging, 'package');
  mkdirSync(packageDir, { recursive: true });

  cpSync(path.join(source, 'manifest.json'), path.join(packageDir, 'manifest.json'));
  cpSync(path.join(source, 'dist'), path.join(packageDir, 'dist'), { recursive: true });
  for (const extra of ['admin', 'migrations', 'README.md']) {
    const from = path.join(source, extra);
    if (existsSync(from)) cpSync(from, path.join(packageDir, extra), { recursive: true });
  }

  // 与真实发布包同形的清单：files / peerDependencies，但没有 scripts 与 devDependencies
  const original = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  writeFileSync(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: entry.npm,
        version: entry.version,
        type: 'module',
        main: './dist/index.js',
        files: ['dist', 'admin', 'migrations', 'manifest.json', 'README.md'],
        dependencies: original.dependencies ?? {},
        peerDependencies: original.peerDependencies ?? {},
        peerDependenciesMeta: original.peerDependenciesMeta ?? {}
      },
      null,
      2
    )}\n`
  );

  const file = path.join(workDir, 'tarballs', `${entry.npm.replace('@', '').replace('/', '-')}-${entry.version}.tgz`);
  mkdirSync(path.dirname(file), { recursive: true });
  tar.create({ gzip: true, file, cwd: staging, sync: true }, ['package']);
  const buffer = readFileSync(file);
  rmSync(file, { force: true });
  return buffer;
}

interface LocalRegistry {
  origin: string;
  server: Server;
}

async function startRegistry(tarballs: Map<string, Buffer>, packs: Map<string, { version: string; integrity: string; file: string }>): Promise<LocalRegistry> {
  let origin = '';
  const server = createServer((request, response) => {
    const url = request.url ?? '';

    const tarballMatch = /^\/tarballs\/(.+)$/.exec(url);
    if (tarballMatch) {
      const buffer = tarballs.get(decodeURIComponent(tarballMatch[1] as string));
      if (!buffer) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(buffer);
      return;
    }

    const name = decodeURIComponent(url.replace(/^\//, ''));
    const pack = packs.get(name);
    if (!pack) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        'dist-tags': { latest: pack.version },
        versions: {
          [pack.version]: {
            version: pack.version,
            dist: {
              tarball: `${origin}/tarballs/${pack.file}`,
              integrity: pack.integrity
            }
          }
        }
      })
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  return { origin, server };
}

/** 运行真实 CLI（异步，不阻塞事件循环 —— registry 才能响应请求）。 */
function runCli(args: string[], env: Record<string, string | undefined>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'src/cli/index.ts', ...args], {
      cwd: path.join(ROOT, 'apps/server'),
      env: env as NodeJS.ProcessEnv,
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function withDatabase<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection({ ...DB, database: TEST_DB });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

describe('ricenote setup：离线端到端（本地 registry + 真实 CLI）', () => {
  let rootDir: string;
  let registry: LocalRegistry;
  let result: { code: number | null; stdout: string; stderr: string };

  before(async () => {
    /*
     * 演练根目录**必须放在仓库内**：插件运行时要解析宿主提供的包
     * （`@ricenote/plugin-sdk` / `@ricenote/shared`），Node 是从插件目录向上找
     * `node_modules` 的 —— 放在系统临时目录里就找不到宿主，插件会启动失败。
     * 真实部署同样是"插件在项目根内"，所以这也更贴近事实。
     */
    /*
     * 按进程隔离：固定目录会让并发运行互相覆盖 .env、plugins/ 与 themes/。
     *
     * 清理**必须容错**：演练目录里有成千上万个文件（插件产物 + npm 暂存），
     * 某些环境对"批量删除"会弹确认或直接拒绝（safe-delete 守卫），一旦 rmSync 抛错
     * 就会让 before 钩子整体失败、所有用例变成 ENOENT —— 那是环境噪声，
     * 不该伪装成产品缺陷。删不掉就换一个没人用过的新目录继续跑。
     */
    const baseDir = path.join(ROOT, 'storage', `tmp-setup-flow-${process.pid}`);
    try {
      rmSync(baseDir, { recursive: true, force: true });
      rootDir = baseDir;
    } catch {
      rootDir = `${baseDir}-${Date.now().toString(36)}`;
    }
    mkdirSync(rootDir, { recursive: true });

    // 主题是内核启动的硬前提：全新部署要先放一个可用主题进去
    cpSync(path.join(ROOT, 'themes'), path.join(rootDir, 'themes'), { recursive: true });

    const tarballs = new Map<string, Buffer>();
    const packs = new Map<string, { version: string; integrity: string; file: string }>();
    for (const entry of catalog.plugins) {
      const buffer = packPlugin(entry, rootDir);
      const file = `${entry.npm.replace('@', '').replace('/', '-')}-${entry.version}.tgz`;
      tarballs.set(file, buffer);
      packs.set(entry.npm, {
        version: entry.version,
        integrity: `sha512-${createHash('sha512').update(buffer).digest('base64')}`,
        file
      });
    }

    registry = await startRegistry(tarballs, packs);

    // 只请求 posts：identity 靠依赖闭包带入，authorization 只能靠"必需项"并入
    result = await runCli(
      [
        'setup',
        '--yes',
        '--no-scripts',
        '--plugins=posts',
        `--root-dir=${rootDir}`,
        `--db-host=${DB.host}`,
        `--db-port=${String(DB.port)}`,
        `--db-user=${DB.user}`,
        `--db-password=${DB.password}`,
        `--db-name=${TEST_DB}`,
        '--site-title=安装向导测试站',
        '--site-url=http://localhost:3981',
        '--admin-username=installer',
        '--admin-email=installer@example.com'
      ],
      { ...BASE_ENV, RICENOTE_NPM_REGISTRY: registry.origin }
    );
  });

  after(async () => {
    await new Promise<void>((resolve) => registry?.server.close(() => resolve()));
    /*
     * 清理同样容错：删不掉（批量删除守卫、文件被占用）只是留了个临时目录，
     * 不该把已经通过的用例判成失败 —— 那种"红"会让人去查根本不存在的产品问题。
     * 库的清理不能省：它按进程命名，留着会一直堆积。
     */
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `[setup-flow] 演练目录清理失败（不影响测试结论）：${error instanceof Error ? error.message : String(error)}`
      );
    }

    const conn = await mysql.createConnection(DB);
    await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await conn.end();
  });

  it('向导以 0 退出，并输出后台地址与后续步骤', () => {
    assert.equal(result.code, 0, `向导未成功退出：\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /安装向导/);
    assert.match(result.stdout, /后台地址：http:\/\/localhost:3981\/admin\//);
  });

  it('必需插件无法被绕过：只请求 posts 也装上 identity 与 authorization', () => {
    const installed = readdirSync(path.join(rootDir, 'plugins', 'third-party')).filter(
      (name) => !name.includes('.incoming-') && !name.includes('.backup-')
    );
    const manifests = installed.map(
      (dir) =>
        JSON.parse(
          readFileSync(path.join(rootDir, 'plugins', 'third-party', dir, 'manifest.json'), 'utf8')
        ) as { id: string }
    );
    const ids = manifests.map((item) => item.id).sort();
    assert.deepEqual(ids, ['rice.authorization', 'rice.identity', 'rice.posts']);
  });

  it('.env 写入声明式清单与兼容的 seed 列表', () => {
    const env = readFileSync(path.join(rootDir, '.env'), 'utf8');
    const plugins = /^RICENOTE_PLUGINS=(.+)$/m.exec(env)?.[1] ?? '';
    const seed = /^RICENOTE_SEED_PLUGINS=(.+)$/m.exec(env)?.[1] ?? '';

    for (const entry of catalog.plugins.filter((item) =>
      ['rice.identity', 'rice.authorization', 'rice.posts'].includes(item.id)
    )) {
      assert.match(
        plugins,
        new RegExp(`${entry.npm.replace(/[/@.]/g, '\\$&')}@${entry.version}`),
        `RICENOTE_PLUGINS 缺少 ${entry.npm}@${entry.version}\n--- 向导输出 ---\n${result.stdout}`
      );
    }
    for (const short of ['identity', 'authorization', 'posts']) {
      assert.match(seed, new RegExp(`(^|,)${short}(,|$)`), `SEED 缺少 ${short}\n${result.stdout}`);
    }
  });

  it('来源元数据记为 registry 并带上推荐版本', async () => {
    const rows = await withDatabase((conn) =>
      conn.query<mysql.RowDataPacket[]>(
        'SELECT id, source_type, source_spec, resolved_version FROM rn_plugins ORDER BY id'
      )
    );
    const plugins = rows[0];
    assert.equal(plugins.length, 3);
    for (const row of plugins) {
      assert.equal(row.source_type, 'registry');
      assert.match(String(row.source_spec), /^@ricenote\/plugin-/);
      assert.ok(String(row.resolved_version).length > 0);
    }
  });

  it('首次启动创建了初始管理员', async () => {
    const rows = await withDatabase((conn) =>
      conn.query<mysql.RowDataPacket[]>('SELECT username FROM rn_identity_users').catch((error: unknown) => {
        /*
         * 缺表说明插件从未启动：把向导输出一并抛出，否则只剩一句
         * "表不存在"，看不出到底卡在哪一步（这正是本测试的价值）。
         */
        throw new Error(
          `identity 插件未运行（${error instanceof Error ? error.message : String(error)}）\n` +
            `--- 向导输出 ---\n${result.stdout}`
        );
      })
    );
    assert.deepEqual(
      rows[0].map((row) => row.username),
      ['installer']
    );
  });
});
