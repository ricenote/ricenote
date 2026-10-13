/**
 * 版本号派生的一致性测试 —— 离线、无需数据库。
 *
 * 压着的性质：版本号的**唯一手写处是 `packages/shared/manifests/plugin-catalog.json`**，
 * 其余 20 多处（根 `package.json`、`packages/core/src/version.ts`、四个 SDK 包与四个私有工作区包、
 * 13 个插件的 `manifest.json`/`package.json`/`README.md` 版本行、插件宿主区间、
 * wiki 首页/页脚/插件一览的版本列）都是派生的。
 *
 * 历史上真正漂移过的正是这些派生处：SDK 包版本漏改不报错、插件 README 的 `| version |` 行
 * 悄悄落后、镜像仓库的 peer 区间与源码不一致。所以这里既在**真实仓库**上跑 `--check`
 * （并断言检查项数量，避免规则被删后空跑通过），也用临时 fixture 造负例，
 * 确认每一类漂移都能被点名、并能被 `--sync` 修回。
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(process.cwd(), '..');
const CLI = path.join(ROOT, 'scripts', 'version.mjs');

/** `packages/core/src/version.ts` 里由引擎维护的提示行（fixture 需要逐字一致）。 */
const NOTICE = '// 本行由 `pnpm version:sync` 从 plugin-catalog.json 派生，请勿手改。';

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** 跑一次 CLI；失败时把 stdout/stderr 一并带回来，便于断言报错内容。 */
function runVersion(args: string[], cwd = ROOT): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

// ---------------------------------------------------------------------------
// 真实仓库
// ---------------------------------------------------------------------------

describe('真实仓库：全部派生处与单一来源一致', () => {
  it('--check 通过，且检查项数量足够多（防止规则被删后空跑通过）', () => {
    const result = runVersion(['--check']);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

    const matched = /共 (\d+) 项检查/.exec(result.stdout);
    assert.ok(matched, `应当输出检查项数量：${result.stdout}`);

    /*
     * 期待值：1（根）+ 1（core/version.ts）+ 4（SDK）+ 4（私有工作区）+ 13×3（插件三处）
     * + 12×2+1（宿主区间）+ 2（wiki 首页/页脚）+ 14（插件一览行）= 90。
     * 下限取 80：少一条规则都会立刻失败，又不会因为将来多一个插件而误报。
     */
    assert.ok(Number(matched[1]) >= 80, `检查项过少（${matched[1]}），规则可能被误删`);
  });
});

// ---------------------------------------------------------------------------
// fixture：造负例，验证"能定位 + 能修回 + 幂等"
// ---------------------------------------------------------------------------

const PACKAGE_JSON_FILES: Record<string, string> = {
  'packages/shared/package.json': '@ricenote/shared',
  'packages/plugin-sdk/package.json': '@ricenote/plugin-sdk',
  'packages/theme-sdk/package.json': '@ricenote/theme-sdk',
  'packages/admin-sdk/package.json': '@ricenote/admin-sdk',
  'packages/core/package.json': '@ricenote/core',
  'apps/server/package.json': '@ricenote/server',
  'apps/admin/package.json': '@ricenote/admin',
  'tests/package.json': '@ricenote/tests'
};

/**
 * 写一个最小但结构完整的仓库骨架：单一来源 + 全部派生点。
 *
 * 刻意不追求与真实仓库逐字一致（那由"真实仓库"那组用例覆盖），
 * 只要求覆盖每一条规则，好让负例精确命中想测的那一处。
 */
function createFixture(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ricenote-version-'));
  const write = (rel: string, content: string): void => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content.endsWith('\n') ? content : `${content}\n`);
  };

  write(
    'package.json',
    JSON.stringify({ name: 'ricenote', version: '0.6.1', private: true }, null, 2)
  );
  write(
    'packages/core/src/version.ts',
    ['/** 内核版本号。 */', NOTICE, "export const APP_VERSION = '0.6.1';"].join('\n')
  );
  for (const [rel, name] of Object.entries(PACKAGE_JSON_FILES)) {
    write(rel, JSON.stringify({ name, version: '0.6.1' }, null, 2));
  }
  write(
    'packages/shared/manifests/plugin-catalog.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        appVersion: '0.6.1',
        plugins: [
          {
            id: 'rice.demo',
            npm: '@ricenote/plugin-demo',
            version: '1.2.0',
            category: 'optional',
            label: '演示',
            description: '演示插件。',
            capabilities: ['services:provide'],
            requires: [],
            repository: 'https://github.com/ricenote/plugin-demo',
            license: 'MIT'
          }
        ]
      },
      null,
      2
    )
  );
  write(
    'plugins/official/demo/manifest.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        id: 'rice.demo',
        name: '演示',
        description: '演示插件。',
        version: '1.2.0',
        apiVersion: '^1.0.0',
        entry: './dist/index.js',
        capabilities: ['services:provide']
      },
      null,
      2
    )
  );
  write(
    'plugins/official/demo/package.json',
    JSON.stringify(
      {
        name: '@ricenote/plugin-demo',
        version: '1.2.0',
        type: 'module',
        peerDependencies: {
          '@ricenote/plugin-sdk': '^0.6.0',
          '@ricenote/shared': '^0.6.0'
        },
        peerDependenciesMeta: {
          '@ricenote/plugin-sdk': { optional: true },
          '@ricenote/shared': { optional: true }
        },
        devDependencies: {
          '@ricenote/plugin-sdk': 'workspace:^',
          '@ricenote/shared': 'workspace:^'
        }
      },
      null,
      2
    )
  );
  write(
    'plugins/official/demo/README.md',
    ['# 演示', '', '## 清单摘要', '', '| 项 | 值 |', '| --- | --- |', '| id | `rice.demo` |', '| version | `1.2.0` |'].join('\n')
  );
  write(
    'CHANGELOG.md',
    [
      '# Changelog',
      '',
      '本项目的所有显著变更都会记录在此文件中。',
      '',
      '## [Unreleased]',
      '',
      '## [0.6.1] - 2026-01-01',
      '',
      '### Fixed',
      '',
      '- 示例条目。',
      '',
      '[Unreleased]: https://github.com/ricenote/ricenote/compare/v0.6.1...HEAD',
      '[0.6.1]: https://github.com/ricenote/ricenote/releases/tag/v0.6.1'
    ].join('\n')
  );
  write('wiki/Home.md', '当前版本：**0.6.1** ｜ 许可：MIT');
  write('wiki/_Footer.md', 'RiceNote 0.6.1 ｜ MIT 许可');
  write(
    'wiki/Plugins-Overview.md',
    [
      '# 官方插件一览',
      '',
      '| 插件 | ID | 版本 | 提供的能力契约 | 依赖 | 后台页面 |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 演示 | `rice.demo` | 1.2.0 | `demo@1` | —— | —— |'
    ].join('\n')
  );

  return dir;
}

/** 把 fixture 里某个文件的一段文本改掉（改不到就抛错，避免"负例其实是无效的"）。 */
function patch(dir: string, rel: string, from: string, to: string): void {
  const file = path.join(dir, rel);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `${rel} 里应当包含 ${from}`);
  writeFileSync(file, text.replace(from, to));
}

function readFixture(dir: string, rel: string): string {
  return readFileSync(path.join(dir, rel), 'utf8');
}

/**
 * 把 fixture 的所有文件改成 CRLF 行尾。
 *
 * 真实仓库的 Markdown/JSON 都是 CRLF，而 `mkdtempSync` 写出来的是 LF ——
 * 曾经正因为这个差异漏掉一个缺陷：`releaseChangelog` 用 `[ \t]*\n` 匹配
 * `## [Unreleased]`，在 CRLF 文件上匹配不到，bump 走到收口那一步就抛错。
 */
function toCrlf(dir: string): void {
  for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
    const file = path.join(dir, rel);
    if (!statSync(file).isFile()) continue;
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
}

describe('fixture：干净的骨架应当直接通过', () => {
  it('--check 退出码 0', () => {
    const dir = createFixture();
    try {
      const result = runVersion(['--check', `--root=${dir}`]);
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixture：三类历史上真正漂移过的派生点都能被点名', () => {
  const cases = [
    {
      name: 'SDK 包版本落后（0.6.x 里漏改不报错的那类）',
      file: 'packages/shared/package.json',
      patch: (dir: string) => patch(dir, 'packages/shared/package.json', '"version": "0.6.1"', '"version": "0.6.0"'),
      expect: 'packages/shared/package.json'
    },
    {
      name: '插件 README 的 | version | 行落后',
      file: 'plugins/official/demo/README.md',
      patch: (dir: string) => patch(dir, 'plugins/official/demo/README.md', '| version | `1.2.0` |', '| version | `1.1.0` |'),
      expect: 'plugins/official/demo/README.md'
    },
    {
      name: '插件宿主区间与宿主次版本不一致',
      file: 'plugins/official/demo/package.json',
      patch: (dir: string) => patch(dir, 'plugins/official/demo/package.json', '"@ricenote/plugin-sdk": "^0.6.0"', '"@ricenote/plugin-sdk": "^0.5.0"'),
      expect: 'plugins/official/demo/package.json'
    },
    {
      name: 'wiki 首页版本落后',
      file: 'wiki/Home.md',
      patch: (dir: string) => patch(dir, 'wiki/Home.md', '**0.6.1**', '**0.6.0**'),
      expect: 'wiki/Home.md'
    },
    {
      name: '插件一览的版本列落后',
      file: 'wiki/Plugins-Overview.md',
      patch: (dir: string) => patch(dir, 'wiki/Plugins-Overview.md', '| `rice.demo` | 1.2.0 |', '| `rice.demo` | 1.0.0 |'),
      expect: 'wiki/Plugins-Overview.md'
    }
  ];

  for (const testCase of cases) {
    it(`${testCase.name}：check 失败并点名，sync 能修回`, () => {
      const dir = createFixture();
      try {
        testCase.patch(dir);

        const failed = runVersion(['--check', `--root=${dir}`]);
        assert.equal(failed.status, 1, '应当以非零退出码失败');
        assert.match(`${failed.stdout}${failed.stderr}`, new RegExp(testCase.expect.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')));

        const synced = runVersion(['--sync', `--root=${dir}`]);
        assert.equal(synced.status, 0, `${synced.stdout}${synced.stderr}`);

        const recheck = runVersion(['--check', `--root=${dir}`]);
        assert.equal(recheck.status, 0, `sync 之后应当一致：${recheck.stdout}${recheck.stderr}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe('fixture：sync 幂等，bump 正确递增', () => {
  it('连续两次 sync，第二次零改动', () => {
    const dir = createFixture();
    try {
      patch(dir, 'wiki/Home.md', '**0.6.1**', '**0.1.0**');

      const first = runVersion(['--sync', `--root=${dir}`]);
      assert.equal(first.status, 0, `${first.stdout}${first.stderr}`);
      assert.match(first.stdout, /写回/, '第一次应当有实际改动');

      const second = runVersion(['--sync', `--root=${dir}`]);
      assert.equal(second.status, 0, `${second.stdout}${second.stderr}`);
      assert.match(second.stdout, /已是最新/, '第二次应当无改动');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--bump minor 把 0.6.1 递增为 0.7.0 并预演（不写盘）', () => {
    const dir = createFixture();
    try {
      const before = readFixture(dir, 'package.json');
      const result = runVersion(['--bump', 'minor', '--dry-run', `--root=${dir}`]);

      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /0\.6\.1 → 0\.7\.0/);
      // 宿主区间跟着次版本走
      assert.match(result.stdout, /\^0\.6\.0 → \^0\.7\.0/);
      assert.equal(readFixture(dir, 'package.json'), before, '--dry-run 不该写盘');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--bump patch --plugin=rice.demo:minor 同时递增应用与单个插件', () => {
    const dir = createFixture();
    try {
      // --no-verify：fixture 不是真实仓库，跳过 bump 末尾的 install/build/validate
      const result = runVersion(['--bump', 'patch', '--plugin=rice.demo:minor', '--no-verify', `--root=${dir}`]);
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

      const catalog = JSON.parse(readFixture(dir, 'packages/shared/manifests/plugin-catalog.json')) as {
        appVersion: string;
        plugins: { version: string }[];
      };
      assert.equal(catalog.appVersion, '0.6.2');
      assert.equal(catalog.plugins[0].version, '1.3.0');
      // 派生处一并跟上
      assert.match(readFixture(dir, 'plugins/official/demo/README.md'), /\| version \| `1\.3\.0` \|/);
      assert.match(readFixture(dir, 'plugins/official/demo/package.json'), /"version": "1\.3\.0"/);
      assert.match(readFixture(dir, 'wiki/Plugins-Overview.md'), /\| `rice\.demo` \| 1\.3\.0 \|/);

      // CHANGELOG：新段落标题 + 链接引用收口，且历史段落原样保留
      const changelog = readFixture(dir, 'CHANGELOG.md');
      assert.match(changelog, /^## \[0\.6\.2\] - \d{4}-\d{2}-\d{2}$/m);
      assert.match(changelog, /^\[Unreleased\]: \S+\/compare\/v0\.6\.2\.\.\.HEAD$/m);
      assert.match(
        changelog,
        /^\[0\.6\.2\]: https:\/\/github\.com\/ricenote\/ricenote\/releases\/tag\/v0\.6\.2$/m
      );
      assert.match(changelog, /^## \[0\.6\.1\] - 2026-01-01$/m, '历史段落不应被改动');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--bump 把 [Unreleased] 里已写好的条目搬进新版本段落', () => {
    const dir = createFixture();
    try {
      patch(dir, 'CHANGELOG.md', '## [Unreleased]\n', '## [Unreleased]\n\n### Added\n\n- 待发布的条目。\n');

      const result = runVersion(['--bump', 'patch', '--no-verify', `--root=${dir}`]);
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

      const changelog = readFixture(dir, 'CHANGELOG.md');
      const section = changelog.slice(changelog.indexOf('## [0.6.2]'), changelog.indexOf('## [0.6.1]'));
      assert.match(section, /### Added/);
      assert.match(section, /- 待发布的条目。/);

      // Unreleased 段被清空（内容已搬走）
      const unreleased = changelog.slice(changelog.indexOf('## [Unreleased]'), changelog.indexOf('## [0.6.2]'));
      assert.equal(unreleased.trim(), '## [Unreleased]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fixture：CRLF 行尾（真实仓库就是 CRLF，而 fixture 默认是 LF）', () => {
  it('CRLF 的 CHANGELOG 也能收口，且不会写出混排行尾', () => {
    const dir = createFixture();
    try {
      toCrlf(dir);

      const check = runVersion(['--check', `--root=${dir}`]);
      assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);

      const result = runVersion(['--bump', 'patch', '--no-verify', `--root=${dir}`]);
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

      const changelog = readFixture(dir, 'CHANGELOG.md');
      assert.match(changelog, /^## \[0\.6\.2\] - \d{4}-\d{2}-\d{2}\r$/m, '新段落应当用 CRLF 行尾');
      assert.match(changelog, /^\[0\.6\.2\]: https:\/\/\S+\r$/m);
      assert.ok(!/[^\r]\n/.test(changelog), 'CRLF 文件里不该出现裸 LF（行尾混排）');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
