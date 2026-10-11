#!/usr/bin/env node
/**
 * 为每个官方插件生成「可独立克隆」的本地 git 仓库（源码镜像，ADR-016）。
 *
 * 为什么是镜像而不是主副本：
 * - 单调仓库仍是开发主战场（`plugins/official` + workspace 软链 + 零构建热调试）；
 * - 独立仓库是**源码镜像**：含 `src`/`admin`/`migrations`/`manifest.json`/`README`/`LICENSE`
 *   + 独立的 `package.json`、`tsconfig.json` 与发布 CI，**不含 `dist` 与 `node_modules`**；
 * - 生成物放在 `plugin-repos/` 下（已被根 `.gitignore` 忽略）：嵌套 `.git` 会让父仓库
 *   把它们当成 embedded repo，反而破坏 monorepo 的版本管理，所以两者必须物理分开。
 *
 * 用法：
 *   node scripts/split-plugin-repos.mjs                 # 生成/更新全部
 *   node scripts/split-plugin-repos.mjs --only=rice.posts
 *   node scripts/split-plugin-repos.mjs --no-commit      # 只落文件，不提交
 *   node scripts/split-plugin-repos.mjs --print-remotes  # 打印待推送的远端地址
 *
 * 幂等：重复执行只更新有变化的文件；已存在 `.git` 时提交增量，不重建历史。
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'plugin-repos');
const args = process.argv.slice(2);
const flags = {
  only: args.filter((item) => item.startsWith('--only=')).map((item) => item.slice(7)),
  commit: !args.includes('--no-commit'),
  printRemotes: args.includes('--print-remotes')
};

const catalog = JSON.parse(
  readFileSync(path.join(ROOT, 'packages/shared/manifests/plugin-catalog.json'), 'utf8')
);
const appVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const tsconfigBase = JSON.parse(readFileSync(path.join(ROOT, 'tsconfig.base.json'), 'utf8'));

/** 官方插件目录名 → 绝对路径（按 manifest.id 匹配）。 */
function pluginDirOf(id) {
  for (const entry of readdirSync(path.join(ROOT, 'plugins/official'), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(ROOT, 'plugins/official', entry.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    if (JSON.parse(readFileSync(manifestPath, 'utf8')).id === id) return dir;
  }
  throw new Error(`找不到官方插件目录：${id}`);
}

/** 镜像仓库的包名短名（`@ricenote/plugin-posts` → `posts`），用于目录与仓库名。 */
function shortNameOf(npm) {
  return npm.replace(/^@[^/]+\/plugin-/, '');
}

/** 自包含的 tsconfig：镜像仓库不能 extends 到仓库外的文件。 */
function buildTsconfig() {
  const base = { ...(tsconfigBase.compilerOptions ?? {}) };
  delete base.rootDir;
  delete base.outDir;
  return {
    // 与仓库内一致，但独立：镜像仓库不依赖单调仓库的 tsconfig.base.json
    compilerOptions: { ...base, rootDir: 'src', outDir: 'dist' },
    include: ['src/**/*.ts']
  };
}

/** 发布 CI：推 tag 时构建并发布（凭据走仓库 secret NPM_TOKEN）。 */
function buildReleaseWorkflow(npm, slug) {
  return `name: release

# 推 tag（如 v1.5.1）即发布到 npm；凭据取自仓库 secret NPM_TOKEN。
# 需要 @ricenote scope 的 publish 权限。
on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org

      - name: 校验 tag 与包版本一致
        run: |
          TAG="\${GITHUB_REF_NAME#v}"
          PKG="$(node -p "require('./package.json').version")"
          MANIFEST="$(node -p "require('./manifest.json').version")"
          if [ "$TAG" != "$PKG" ] || [ "$TAG" != "$MANIFEST" ]; then
            echo "tag=$TAG package=$PKG manifest=$MANIFEST 不一致，拒绝发布" >&2
            exit 1
          fi

      - run: pnpm install --no-frozen-lockfile
      - run: pnpm build

      - name: 发布
        run: pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;
}

function writeFileIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}

const targets = catalog.plugins.filter(
  (entry) => flags.only.length === 0 || flags.only.includes(entry.id) || flags.only.includes(entry.npm)
);

const remotes = [];

for (const entry of targets) {
  const source = pluginDirOf(entry.id);
  const shortName = shortNameOf(entry.npm);
  const target = path.join(OUT_DIR, shortName);
  const original = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const slug = `plugin-${shortName}`;

  // 1) 源码镜像：只带"人写的"东西，不带产物
  mkdirSync(target, { recursive: true });
  for (const item of ['src', 'admin', 'migrations']) {
    const from = path.join(source, item);
    if (existsSync(from)) {
      rmSync(path.join(target, item), { recursive: true, force: true });
      cpSync(from, path.join(target, item), { recursive: true });
    }
  }
  for (const item of ['manifest.json', 'README.md']) {
    const from = path.join(source, item);
    if (existsSync(from)) cpSync(from, path.join(target, item));
  }
  cpSync(path.join(ROOT, 'LICENSE'), path.join(target, 'LICENSE'));

  // 2) 自包含的 package.json：宿主提供的包走 peer（+optional），devDependencies 才能本地构建
  const hostProvided = ['@ricenote/plugin-sdk', '@ricenote/shared'];
  const devDependencies = {
    typescript: '^5.7.2',
    '@types/node': '^22.10.2'
  };
  for (const name of hostProvided) devDependencies[name] = `^${appVersion}`;

  const packageJson = {
    name: entry.npm,
    version: entry.version,
    type: 'module',
    description: original.description ?? entry.description,
    keywords: ['ricenote', 'plugin', shortName],
    homepage: entry.repository,
    repository: { type: 'git', url: `git+${entry.repository}.git` },
    license: entry.license,
    author: 'RiceNote',
    engines: { node: '>=20.11.0' },
    main: './dist/index.js',
    files: ['dist', 'admin', 'migrations', 'manifest.json', 'README.md'],
    publishConfig: { access: 'public' },
    scripts: {
      build: 'tsc -p tsconfig.json',
      typecheck: 'tsc -p tsconfig.json --noEmit',
      prepublishOnly: 'pnpm build'
    },
    ...(original.dependencies && Object.keys(original.dependencies).length > 0
      ? { dependencies: original.dependencies }
      : {}),
    peerDependencies: {
      '@ricenote/plugin-sdk': `^${appVersion}`,
      '@ricenote/shared': `^${appVersion}`
    },
    peerDependenciesMeta: {
      '@ricenote/plugin-sdk': { optional: true },
      '@ricenote/shared': { optional: true }
    },
    devDependencies
  };

  writeFileIfChanged(path.join(target, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileIfChanged(path.join(target, 'tsconfig.json'), `${JSON.stringify(buildTsconfig(), null, 2)}\n`);
  writeFileIfChanged(
    path.join(target, '.gitignore'),
    ['node_modules/', 'dist/', '*.log', '.DS_Store', 'coverage/', ''].join('\n')
  );
  writeFileIfChanged(
    path.join(target, '.github/workflows/release.yml'),
    buildReleaseWorkflow(entry.npm, slug)
  );

  // 3) git 仓库（幂等：已有 .git 就提交增量）
  let committed = '未提交';
  if (flags.commit) {
    const git = (...gitArgs) =>
      execFileSync('git', gitArgs, { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    if (!existsSync(path.join(target, '.git'))) {
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'RiceNote');
      git('config', 'user.email', 'dev@ricenote.local');
    }
    git('add', '-A');
    const status = git('status', '--porcelain').trim();
    if (status.length > 0) {
      git('commit', '-q', '-m', `chore: 同步自主仓库（${entry.id} v${entry.version}）`);
      committed = '已提交';
    } else {
      committed = '无变化';
    }
  }

  remotes.push({ id: entry.id, dir: target, remote: `${entry.repository}.git`, committed });
  console.log(`[${shortName}] v${entry.version} → ${path.relative(ROOT, target)}（${committed}）`);
}

if (flags.printRemotes) {
  console.log('\n推送命令：\n');
  for (const item of remotes) {
    console.log(
      `  cd ${path.relative(ROOT, item.dir)} && git remote add origin ${item.remote} && git push -u origin main`
    );
  }
}

console.log(
  `\n完成：${remotes.length} 个插件仓库位于 ${path.relative(ROOT, OUT_DIR)}/` +
    `（已被根 .gitignore 忽略，不会进入主仓库）\n` +
    '提示：这些是**源码镜像**；产物（dist）由各仓库的 CI 或本地 pnpm build 生成。'
);
