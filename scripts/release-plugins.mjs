#!/usr/bin/env node
/**
 * 官方插件与基础包的发布脚本。
 *
 * 设计原则：**先校验、后发布**。所有会"发出去就收不回"的错误
 * （版本与清单不一致、忘了去掉 private、宿主包被写成普通依赖、
 * 产物没构建）都在联网之前拦住，并且错误信息直接说明怎么修。
 *
 * 用法：
 *   node scripts/release-plugins.mjs --dry-run          # 只校验并打印将发布的内容
 *   node scripts/release-plugins.mjs                     # 校验后真实发布
 *   node scripts/release-plugins.mjs --only=rice.posts    # 只发布一个（可重复）
 *   node scripts/release-plugins.mjs --skip-sdks          # 只发布插件
 *   node scripts/release-plugins.mjs --tag=next           # 指定 dist-tag
 *   node scripts/release-plugins.mjs --skip-published     # 已存在于 registry 的版本自动跳过
 *
 * `--skip-published` 建议常开：npm 不允许覆盖已发布的版本号，
 * 而全量发布会一次尝试 15 个包 —— 只要有**一个**版本没变就会以 EPUBLISHCONFLICT 中断整轮。
 * 开启后"只改了插件 X"也能直接跑全量，脚本会跳过没变的那些。
 *
 * 凭据：**只从环境变量读取**（NPM_TOKEN / NODE_AUTH_TOKEN 由调用方放进
 * 临时 .npmrc），脚本本身不接触 token，也不把它写进任何文件或日志。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 发布顺序：被依赖的先发（shared → SDK → 插件）。 */
const SDK_PACKAGES = [
  'packages/shared',
  'packages/plugin-sdk',
  'packages/theme-sdk',
  'packages/admin-sdk'
];

/**
 * 由宿主提供、插件不得写成普通依赖的包。
 *
 * 与 `@ricenote/shared` 导出的 `HOST_PROVIDED_PACKAGES` 保持一致：
 * 这里用字面量是因为发布脚本要能在**未构建**的仓库里直接跑。
 */
const HOST_PROVIDED = ['@ricenote/plugin-sdk', '@ricenote/shared'];

const args = process.argv.slice(2);
const flags = {
  dryRun: args.includes('--dry-run'),
  skipSdks: args.includes('--skip-sdks'),
  skipPublished: args.includes('--skip-published'),
  only: args.filter((item) => item.startsWith('--only=')).map((item) => item.slice(7)),
  tag: args.find((item) => item.startsWith('--tag='))?.slice(6) ?? 'latest'
};

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * 查询某个 `包名@版本` 是否已存在于 registry。
 *
 * 返回值刻意分三种：
 * - `true`：确认已存在（`npm view` 打印出了版本号）；
 * - `false`：确认不存在（registry 明确回 404）；
 * - `undefined`：**无法确认**（网络失败、npm 不可用、私有源未登录等）。
 *
 * 只有 `true` 才跳过发布：把"查不到"当作"已存在"会**静默漏发**，
 * 而把它当作"不存在"最多让 npm 自己拒绝一次 —— 后者安全得多，符合"不假装成功"的口径。
 * 查询不带 `--registry`，与发布使用同一套配置（npmrc / 环境变量），避免查一处、发另一处。
 */
function publishedState(name, version) {
  try {
    const output = execFileSync('npm', ['view', `${name}@${version}`, 'version', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      timeout: 30_000
    }).trim();
    return output.length > 0;
  } catch (error) {
    const text = [error?.stderr, error?.stdout, error instanceof Error ? error.message : String(error)]
      .filter((part) => typeof part === 'string')
      .join(' ');
    return /E404|404 Not Found|is not in this registry/i.test(text) ? false : undefined;
  }
}

/** 跳过的目录名（与发现机制一致：瞬时目录与点开头目录）。 */
function officialPluginDirs() {
  return readdirSync(path.join(ROOT, 'plugins/official'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

const catalog = readJson(path.join(ROOT, 'packages/shared/manifests/plugin-catalog.json'));
const appVersion = readJson(path.join(ROOT, 'package.json')).version;

if (catalog.appVersion !== appVersion) {
  warn(
    `插件目录的 appVersion=${catalog.appVersion} 与根 package.json 的 ${appVersion} 不一致：` +
      `升级主程序时请同步更新 packages/shared/manifests/plugin-catalog.json`
  );
}

/* ------------------------------ 校验：基础包 ------------------------------ */

function validateSdkPackage(dir) {
  const pkgFile = path.join(ROOT, dir, 'package.json');
  if (!existsSync(pkgFile)) {
    fail(`${dir} 缺少 package.json`);
    return undefined;
  }
  const pkg = readJson(pkgFile);

  if (pkg.private === true) fail(`${pkg.name} 仍标记 private，无法发布`);
  if (!pkg.publishConfig || pkg.publishConfig.access !== 'public') {
    fail(`${pkg.name} 缺少 publishConfig.access=public（作用域包必须显式声明公开）`);
  }
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    fail(`${pkg.name} 缺少 files 字段：不声明会把整个目录（含 src/测试）发出去`);
  }
  // admin-sdk 对消费者暴露 TS 源码（需 Vite/Vue 工具链），其余包必须指向 dist
  if (pkg.name !== '@ricenote/admin-sdk' && !existsSync(path.join(ROOT, dir, 'dist', 'index.js'))) {
    fail(`${pkg.name} 缺少构建产物 dist/index.js，请先执行 pnpm build`);
  }
  if (pkg.name === '@ricenote/admin-sdk' && !existsSync(path.join(ROOT, dir, 'dist', 'browser'))) {
    fail(`${pkg.name} 缺少浏览器产物 dist/browser/，请先执行 pnpm build`);
  }

  return pkg;
}

/* ------------------------------ 校验：插件 ------------------------------ */

function validatePluginDir(dirName) {
  const dir = path.join(ROOT, 'plugins/official', dirName);
  const manifestFile = path.join(dir, 'manifest.json');
  const pkgFile = path.join(dir, 'package.json');
  if (!existsSync(manifestFile) || !existsSync(pkgFile)) {
    fail(`plugins/official/${dirName} 缺少 manifest.json 或 package.json`);
    return undefined;
  }

  const manifest = readJson(manifestFile);
  const pkg = readJson(pkgFile);
  const entry = catalog.plugins.find((item) => item.id === manifest.id);

  if (!entry) {
    warn(`${manifest.id}（plugins/official/${dirName}）不在官方插件目录中，本次跳过发布`);
    return undefined;
  }

  if (manifest.version !== entry.version) {
    fail(
      `${manifest.id} 的 manifest 版本 ${manifest.version} 与插件目录的推荐版本 ${entry.version} 不一致`
    );
  }
  if (pkg.version !== entry.version) {
    fail(`${pkg.name} 的 package.json 版本 ${pkg.version} 与推荐版本 ${entry.version} 不一致`);
  }
  if (pkg.name !== entry.npm) {
    fail(`${manifest.id} 的包名 ${pkg.name} 与插件目录的 ${entry.npm} 不一致`);
  }
  if (pkg.private === true) fail(`${pkg.name} 仍标记 private，无法发布`);
  if (!pkg.publishConfig || pkg.publishConfig.access !== 'public') {
    fail(`${pkg.name} 缺少 publishConfig.access=public`);
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes('dist')) {
    fail(`${pkg.name} 的 files 必须包含 dist（否则装出来的插件没有可执行入口）`);
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes('manifest.json')) {
    fail(`${pkg.name} 的 files 必须包含 manifest.json（安装器靠它识别插件）`);
  }

  for (const name of HOST_PROVIDED) {
    if (pkg.dependencies && pkg.dependencies[name]) {
      fail(
        `${pkg.name} 把宿主提供的包 ${name} 写成了 dependencies：安装时会在插件目录内生成第二份实例` +
          `（应改为 peerDependencies + peerDependenciesMeta.optional，并放到 devDependencies 供本地构建）`
      );
    }
    if (!pkg.peerDependencies || !pkg.peerDependencies[name]) {
      warn(`${pkg.name} 未声明 peerDependencies.${name}（宿主提供这些包，声明它有助于消费者理解契约）`);
    }
    if (!pkg.peerDependenciesMeta || pkg.peerDependenciesMeta[name]?.optional !== true) {
      warn(`${pkg.name} 的 peerDependencies.${name} 未标记 optional，部分包管理器会尝试自动安装`);
    }
  }

  if (!existsSync(path.join(dir, 'dist', 'index.js'))) {
    fail(`${pkg.name} 缺少构建产物 dist/index.js，请先执行 pnpm build`);
  }
  for (const page of manifest.admin?.pages ?? []) {
    const entryFile = path.join(dir, page.entry);
    if (!existsSync(entryFile)) {
      fail(`${manifest.id} 声明了后台界面 ${page.entry}，但文件不存在（会被发布成一个坏包）`);
    }
  }

  return { pkg, entry };
}

/* --------------------------------- 执行 --------------------------------- */

const targets = [];

if (!flags.skipSdks) {
  for (const dir of SDK_PACKAGES) {
    const pkg = validateSdkPackage(dir);
    if (pkg) targets.push({ dir, name: pkg.name, version: pkg.version });
  }
}

const pluginDirs = officialPluginDirs();
const pluginTargets = [];
for (const dirName of pluginDirs) {
  const result = validatePluginDir(dirName);
  if (result) {
    pluginTargets.push({
      dir: path.join('plugins/official', dirName),
      name: result.pkg.name,
      version: result.pkg.version,
      id: result.entry.id
    });
  }
}
targets.push(...pluginTargets);

const selected = targets.filter((target) => {
  if (flags.only.length === 0) return true;
  return flags.only.some((value) => value === target.name || value === target.id || value === target.dir);
});

if (selected.length === 0) {
  fail('没有匹配到要发布的包（检查 --only 的取值）');
}

for (const message of warnings) process.stdout.write(`⚠ ${message}\n`);

if (errors.length > 0) {
  process.stderr.write(`\n✖ 发布前校验未通过（${errors.length} 项）：\n`);
  for (const message of errors) process.stderr.write(`  · ${message}\n`);
  process.exit(1);
}

process.stdout.write(`\n将按顺序发布 ${selected.length} 个包${flags.dryRun ? '（dry-run）' : ''}：\n`);

let published = 0;
let skipped = 0;
for (const target of selected) {
  const label = `${target.name}@${target.version}`;
  const common = ['publish', '--access', 'public', '--no-git-checks', `--tag=${flags.tag}`];
  if (flags.dryRun) common.push('--dry-run');

  /*
   * 已发布的版本无法覆盖：npm 以 EPUBLISHCONFLICT 拒绝，而全量发布会一次尝试 15 个包，
   * 只要有**一个**没变就会中断整轮。因此在发布之前先做存在性检查。
   *
   * 只在真实发布时查：`--dry-run` 保持完全离线（它的职责是校验与预览，不该依赖网络）。
   */
  if (!flags.dryRun && flags.skipPublished) {
    const state = publishedState(target.name, target.version);
    if (state === true) {
      skipped += 1;
      process.stdout.write(`\n⏭ ${label} 已存在于 registry，跳过（--skip-published）\n`);
      continue;
    }
    if (state === undefined) {
      process.stdout.write(
        `\n⚠ ${label} 无法确认是否已发布（registry 查询失败），仍尝试发布\n` +
          '  （若报 EPUBLISHCONFLICT，说明该版本已存在：请升级版本号后再发）\n'
      );
    }
  }

  process.stdout.write(`\n▸ ${label}  (${target.dir})\n`);
  try {
    execFileSync('pnpm', common, {
      cwd: path.join(ROOT, target.dir),
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32'
    });
    published += 1;
    if (!flags.dryRun) process.stdout.write(`✔ 已发布 ${label}\n`);
  } catch (error) {
    process.stderr.write(
      `\n✖ ${label} 发布失败：${error instanceof Error ? error.message : String(error)}\n` +
        `  已发布 ${published} 个、跳过 ${skipped} 个；修复后可重跑本命令` +
        `（配合 --skip-published 时已发布的版本会自动跳过，不会被重复发布挡住）\n`
    );
    process.exit(1);
  }
}

process.stdout.write(
  `\n${flags.dryRun ? '✔ dry-run 完成' : '✔ 发布完成'}：${published}/${selected.length}` +
    (skipped > 0 ? `（跳过 ${skipped} 个已存在的版本）` : '') +
    '\n' +
    (flags.dryRun
      ? '  确认无误后去掉 --dry-run 即可真实发布（需要 NPM_TOKEN 具备 @ricenote scope 的发布权限）\n'
      : '  提示：发布后请更新 packages/shared/manifests/plugin-catalog.json 中的推荐版本\n')
);
