#!/usr/bin/env node
/**
 * 版本号统一入口：校验、同步、递增。
 *
 * 用法：
 *   node scripts/version.mjs --check                      # 只读校验（串在 build / validate / wiki 之前）
 *   node scripts/version.mjs --sync                       # 按单一来源写回全部派生处
 *   node scripts/version.mjs --bump patch                 # 递增应用版本（并写回派生处、收口 CHANGELOG）
 *   node scripts/version.mjs --bump minor --plugin=rice.media:patch
 *                                                         # 同时单独递增某个插件（插件是独立 semver）
 *   node scripts/version.mjs --bump patch --dry-run       # 只预览会改哪些文件
 *
 * 单一来源是 `packages/shared/manifests/plugin-catalog.json`；规则见 `scripts/lib/version-plan.mjs`。
 * 本脚本**不做隐式改写**：只有 `--sync` / `--bump` 会写盘。
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apply,
  hostRangeOf,
  nextVersion,
  plan,
  readSource,
  releaseChangelog,
  writeSource
} from './lib/version-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = {
  check: args.includes('--check'),
  sync: args.includes('--sync'),
  bump: (args.find((item) => item.startsWith('--bump='))?.slice(7) ??
    (args.includes('--bump') ? args[args.indexOf('--bump') + 1] : undefined)) || undefined,
  plugins: args.filter((item) => item.startsWith('--plugin=')).map((item) => item.slice(9)),
  allPlugins: args.find((item) => item.startsWith('--all-plugins='))?.slice(14),
  dryRun: args.includes('--dry-run'),
  json: args.includes('--json'),
  noVerify: args.includes('--no-verify'),
  root: args.find((item) => item.startsWith('--root='))?.slice(7) ?? ROOT,
  help: args.includes('--help') || args.includes('-h')
};

if (flags.help || (!flags.check && !flags.sync && !flags.bump)) {
  process.stdout.write(
    [
      '版本号统一入口（单一来源：packages/shared/manifests/plugin-catalog.json）',
      '',
      '  --check                    只读校验全部派生处，不一致即退出码 1',
      '  --sync                     按单一来源写回全部派生处',
      '  --bump <patch|minor|major> 递增应用版本（并收口 CHANGELOG）',
      '  --plugin=<id>:<level>      同时递增某个插件（可重复；插件版本相互独立）',
      '  --all-plugins=<level>      递增全部插件的版本',
      '  --dry-run                  只预览，不写盘',
      '  --json                     以 JSON 输出校验结果',
      '  --no-verify                bump 后跳过 install/build/validate',
      '  --root=<dir>               指定仓库根（供测试用 fixture 跑同一引擎）',
      ''
    ].join('\n')
  );
  process.exit(args.length === 0 ? 1 : 0);
}

const dim = (text) => `\u001b[2m${text}\u001b[0m`;

/** 打印校验结果；返回是否有问题。 */
function report(result, { quietWhenOk = false } = {}) {
  const failures = result.items.filter((entry) => !entry.ok);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: result.ok, appVersion: result.appVersion, hostRange: result.hostRange, items: result.items.map(({ locate, write, ...rest }) => rest), issues: result.issues, notes: result.notes }, null, 2)}\n`);
    return !result.ok;
  }

  for (const note of result.notes) process.stdout.write(`⚠ ${note}\n`);

  if (failures.length === 0 && result.issues.length === 0) {
    if (!quietWhenOk) {
      process.stdout.write(`✔ 版本号一致（应用 ${result.appVersion}，插件宿主区间 ${result.hostRange}，共 ${result.items.length} 项检查）\n`);
    }
    return false;
  }

  for (const entry of failures) {
    process.stdout.write(
      `✘ ${entry.file} · ${entry.label}：期望 ${entry.expected}，实际 ${entry.actual ?? '(无法定位)'}` +
        `${entry.hint ? dim(` — ${entry.hint}`) : ''}\n`
    );
  }
  for (const issue of result.issues) process.stdout.write(`✘ ${issue}\n`);
  process.stdout.write(
    `\n✘ 版本号不一致（${failures.length + result.issues.length} 项）：改动请只改 ${dim('packages/shared/manifests/plugin-catalog.json')}，` +
      `然后运行 ${dim('pnpm version:sync')}\n`
  );
  return true;
}

function run(command, commandArgs) {
  process.stdout.write(`▸ ${command} ${commandArgs.join(' ')}\n`);
  execFileSync(command, commandArgs, { cwd: flags.root, stdio: 'inherit', shell: process.platform === 'win32' });
}

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------
if (flags.check) {
  const result = plan(flags.root);
  if (report(result)) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// --sync
// ---------------------------------------------------------------------------
if (flags.sync) {
  const before = plan(flags.root);
  if (flags.dryRun) {
    process.stdout.write('（--dry-run：只预览，不写盘）\n');
    report(before);
  } else {
    const changed = apply(before);
    const after = plan(flags.root);
    if (changed.length === 0) {
      process.stdout.write('✔ 已是最新，无需改动\n');
    } else {
      process.stdout.write(`✔ 已按单一来源写回 ${changed.length} 个文件：\n`);
      for (const file of changed) process.stdout.write(`  · ${file}\n`);
    }
    if (report(after, { quietWhenOk: true })) process.exitCode = 1;
    else process.stdout.write(`✔ 复核通过（共 ${after.items.length} 项检查）\n`);
  }
}

// ---------------------------------------------------------------------------
// --bump
// ---------------------------------------------------------------------------
if (flags.bump) {
  const source = readSource(flags.root);
  const levels = ['patch', 'minor', 'major'];
  if (!levels.includes(flags.bump)) {
    process.stderr.write(`✘ 未知的递增级别：${flags.bump}（可选 ${levels.join(' / ')}）\n`);
    process.exit(1);
  }

  const newAppVersion = nextVersion(source.appVersion, flags.bump);
  const pluginVersions = {};
  const catalogById = new Map((source.catalog.plugins ?? []).map((entry) => [entry.id, entry]));

  const pluginTargets = new Map();
  for (const spec of flags.plugins) {
    const [id, level] = spec.split(':');
    if (!id || !levels.includes(level)) {
      process.stderr.write(`✘ --plugin 需要写成 <id>:<patch|minor|major>，收到：${spec}\n`);
      process.exit(1);
    }
    pluginTargets.set(id, level);
  }
  if (flags.allPlugins) {
    if (!levels.includes(flags.allPlugins)) {
      process.stderr.write(`✘ --all-plugins 需要 patch|minor|major，收到：${flags.allPlugins}\n`);
      process.exit(1);
    }
    for (const entry of source.catalog.plugins ?? []) pluginTargets.set(entry.id, flags.allPlugins);
  }

  for (const [id, level] of pluginTargets) {
    const entry = catalogById.get(id);
    if (!entry) {
      process.stderr.write(`✘ 目录里没有插件 ${id}\n`);
      process.exit(1);
    }
    pluginVersions[id] = nextVersion(entry.version, level);
  }

  process.stdout.write(
    `应用版本 ${source.appVersion} → ${newAppVersion}（插件宿主区间 ${source.hostRange} → ${hostRangeOf(newAppVersion)}）\n`
  );
  for (const [id, version] of Object.entries(pluginVersions)) {
    process.stdout.write(`插件 ${id} ${catalogById.get(id).version} → ${version}\n`);
  }

  if (flags.dryRun) {
    process.stdout.write('（--dry-run：只预览，不写盘）\n');
    const preview = plan(flags.root);
    process.stdout.write(`将写入：${path.relative(flags.root, path.join(flags.root, 'packages/shared/manifests/plugin-catalog.json'))}、CHANGELOG.md 以及 ${preview.items.length} 项派生检查涉及的 ${new Set(preview.items.map((item) => item.file)).size} 个文件\n`);
    process.exit(0);
  }

  const touched = [];
  touched.push(writeSource(flags.root, { appVersion: newAppVersion, pluginVersions }));
  touched.push(releaseChangelog(flags.root, newAppVersion));
  const derived = apply(plan(flags.root));
  touched.push(...derived);

  process.stdout.write(`✔ 已改写 ${new Set(touched).size} 个文件：\n`);
  for (const file of [...new Set(touched)].sort()) process.stdout.write(`  · ${file}\n`);
  process.stdout.write(
    `\n下一步：在 CHANGELOG.md 的 [${newAppVersion}] 段下补写变更条目（本脚本不代写正文）。\n`
  );

  const after = plan(flags.root);
  if (!after.ok) {
    process.stderr.write('✘ 写回后仍不一致，请检查：\n');
    report(after);
    process.exit(1);
  }

  if (!flags.noVerify) {
    try {
      run('pnpm', ['install']);
      run('pnpm', ['build']);
      run('pnpm', ['validate']);
    } catch {
      process.stderr.write(
        `\n✘ 验证步骤失败。改动已落盘，可用以下命令回滚：\n  git checkout -- ${[...new Set(touched)].join(' ')}\n`
      );
      process.exit(1);
    }
    process.stdout.write('✔ install / build / validate 全部通过\n');
  }
}
