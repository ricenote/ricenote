#!/usr/bin/env node
/**
 * 把仓库 `wiki/` 目录（文档内容源）同步发布到 GitHub Wiki 仓库。
 *
 * 设计原则：
 * - **`wiki/` 是唯一事实来源**。发布是"镜像同步"：以 `wiki/` 为准增删页面，
 *   因此"删除一个页面"也能生效（而不是只增不减）。
 * - **离线可自查**。`--check` 完全不联网，校验源目录的结构与链接写法，适合接入 CI。
 * - **不硬编码默认分支**。Wiki 仓库的默认分支历史上可能是 `master`，
 *   这里用 `git symbolic-ref` 探测（同时能处理"空仓库、HEAD 尚未诞生"的首次推送）。
 * - **失败给中文指引**。Wiki 未启用、认证失败、缺少 git 身份等都会转成"怎么修"，
 *   而不是把原始 git 报错丢给用户；打印远端地址时对凭据段做掩码。
 *
 * 用法：
 *   node scripts/publish-wiki.mjs --check               # 只校验 wiki/（不联网）
 *   node scripts/publish-wiki.mjs --dry-run             # 同步到临时目录并打印差异，不提交
 *   node scripts/publish-wiki.mjs                       # 正式发布
 *   node scripts/publish-wiki.mjs --message="docs: ..."  # 自定义提交信息
 *   node scripts/publish-wiki.mjs --remote=<url>         # 覆盖远端地址
 *
 * 前置条件（只需做一次）：在 GitHub 仓库的 Settings → Features 勾选 Wikis，
 * 并在 wiki 首页创建第一个页面 —— 否则 `ricenote.wiki.git` 不可 clone / push。
 *
 * 凭据：沿用本机 git 凭据（凭据助手 / SSH / token 化的远端地址）。
 * 脚本本身不接触 token，日志里也会把它掩码掉。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIKI_DIR = path.join(ROOT, 'wiki');
const DEFAULT_MESSAGE = 'docs(wiki): 同步自仓库 wiki/ 源目录';
const HOME_PAGE = 'Home.md';

/** 内部链接语法：`[[页面名]]` 或 `[[显示文本|页面名]]`（表格里写作 `\|`）。 */
const WIKI_LINK = /\[\[([^\]|\\]+?)(\\?\|)([^\]]+?)\]\]|\[\[([^\]|\\]+?)\]\]/g;

/** 禁止出现在 wiki 正文里的"仓库相对链接"（wiki 是独立仓库，相对路径必然失效）。 */
const FORBIDDEN_RELATIVE = [
  { pattern: /\]\(\.\.\//, hint: '上跳相对路径（../）' },
  { pattern: /\]\(\.\//, hint: '当前目录相对路径（./）' },
  { pattern: /\]\(docs\//, hint: '指向仓库 docs/ 的相对路径' },
  { pattern: /\]\(wiki\//, hint: '指向仓库 wiki/ 的相对路径' },
  { pattern: /\]\(\.github\//, hint: '指向仓库 .github/ 的相对路径' }
];

const args = process.argv.slice(2);
const flags = {
  check: args.includes('--check'),
  dryRun: args.includes('--dry-run'),
  help: args.includes('--help') || args.includes('-h'),
  quiet: args.includes('--quiet'),
  message: args.find((item) => item.startsWith('--message='))?.slice('--message='.length) ?? DEFAULT_MESSAGE,
  remote: args.find((item) => item.startsWith('--remote='))?.slice('--remote='.length)
};

function log(message) {
  if (!flags.quiet) console.log(message);
}

function printUsage() {
  console.log(`用法：node scripts/publish-wiki.mjs [选项]

  --check             只校验 wiki/ 源目录（必须有 Home.md、不得有仓库相对链接），不联网
  --dry-run           同步到临时目录并打印将新增/修改/删除的页面，不提交、不推送
  --message=<文本>    自定义提交信息（默认 "${DEFAULT_MESSAGE}"）
  --remote=<url>      覆盖远端地址（默认由 origin 派生为 <repo>.wiki.git）
  --quiet             只输出错误与结果摘要
  --help              显示本帮助

退出码：0 成功（含「没有变化」）；非 0 表示校验失败或推送失败。`);
}

/** 掩码远端地址里的凭据段，避免 token 进入终端或 CI 日志。 */
function maskUrl(url) {
  return String(url).replace(/\/\/[^/@]+@/, '//***@');
}

function runGit(gitArgs, options = {}) {
  try {
    return execFileSync('git', gitArgs, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // 非交互环境（CI / 无 TTY）里绝不能让 git 停下来等输入，
        // 否则一次凭据提示就会把整条流水线挂死
        GIT_TERMINAL_PROMPT: '0'
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('未找到 git 命令。请先安装 Git 并确保它在本机 PATH 中。');
    }
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(stderr || error.message);
  }
}

function fail(message) {
  console.error(`✘ ${message}`);
  process.exitCode = 1;
}

/* ------------------------------------------------------------------ *
 * 源目录
 * ------------------------------------------------------------------ */

/** 递归列出源目录下的相对路径（POSIX 分隔符）。 */
function listSourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(WIKI_DIR, full).split(path.sep).join('/'));
    }
  })(WIKI_DIR);
  return out.sort();
}

/** 递归列出目标目录（clone 出来的 wiki 仓库）下的相对路径，跳过 .git。 */
function listTargetFiles(dir) {
  const out = [];
  (function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  })(dir);
  return out.sort();
}

/**
 * 静态校验（离线）。返回问题数组，空数组表示通过。
 */
function checkSource() {
  const problems = [];

  if (!existsSync(WIKI_DIR) || !statSync(WIKI_DIR).isDirectory()) {
    problems.push(`未找到源目录：${WIKI_DIR}`);
    return problems;
  }

  const files = listSourceFiles();
  const mdFiles = files.filter((file) => file.endsWith('.md'));

  if (mdFiles.length === 0) problems.push('源目录里没有任何 .md 页面。');

  if (!mdFiles.includes(HOME_PAGE)) {
    problems.push(`缺少首页 ${HOME_PAGE}（GitHub Wiki 要求首页必须叫这个名字）。`);
  }

  // 页面名集合：去掉 .md 后缀；_Sidebar / _Footer 是特殊页面，不参与互链校验。
  const pageNames = new Set(
    mdFiles.filter((file) => !path.basename(file).startsWith('_')).map((file) => file.slice(0, -3))
  );

  for (const file of mdFiles) {
    const content = readFileSync(path.join(WIKI_DIR, file), 'utf8');
    const lines = content.split(/\r?\n/);
    let inFence = false;

    lines.forEach((rawLine, index) => {
      const where = `${file}:${index + 1}`;

      // 围栏代码块里的内容是示例，不参与链接校验
      if (/^\s*(```|~~~)/.test(rawLine)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;

      // 行内代码同理（文档里常需要直接写出链接语法本身）
      const line = rawLine.replace(/`[^`]*`/g, '');

      for (const rule of FORBIDDEN_RELATIVE) {
        if (rule.pattern.test(line)) {
          problems.push(`${where} 出现${rule.hint}；wiki 是独立仓库，请改用绝对 URL。`);
        }
      }

      for (const match of line.matchAll(WIKI_LINK)) {
        // 分支一：[[显示文本|页面名]] → 第 3 组是页面名
        // 分支二：[[页面名]]         → 第 4 组是页面名
        const target = (match[3] ?? match[4] ?? '').trim();
        if (target === '') continue;
        if (!pageNames.has(target)) {
          problems.push(`${where} 内部链接指向不存在的页面：[[...|${target}]]`);
        }
      }
    });
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * 远端
 * ------------------------------------------------------------------ */

function deriveRemote() {
  if (flags.remote) return flags.remote;
  const origin = runGit(['remote', 'get-url', 'origin'], { cwd: ROOT }).trim();
  if (origin === '') {
    throw new Error('仓库没有配置 origin 远端，无法派生 wiki 地址。请用 --remote=<url> 显式指定。');
  }
  return `${origin.replace(/\.git$/, '')}.wiki.git`;
}

function detectBranch(dir) {
  // symbolic-ref 在没有提交的空仓库里也能给出分支名
  try {
    const name = runGit(['symbolic-ref', '--short', 'HEAD'], { cwd: dir }).trim();
    if (name !== '') return name;
  } catch {
    /* 继续尝试下一种方式 */
  }
  try {
    const name = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).trim();
    if (name !== '' && name !== 'HEAD') return name;
  } catch {
    /* 空仓库没有 HEAD */
  }
  return 'master';
}

function cloneWiki(remote, targetDir) {
  try {
    runGit(['clone', '--quiet', remote, targetDir], { cwd: ROOT });
  } catch (error) {
    throw new Error(
      `${error.message}\n\n` +
        `无法 clone wiki 仓库（${maskUrl(remote)}）。请确认：\n` +
        '  1. 已在 GitHub 仓库 Settings → Features 中勾选 Wikis；\n' +
        '  2. 已打开 wiki 页面并创建第一个页面（否则该仓库不存在）；\n' +
        '  3. 本机 git 凭据可用（试着手工 git clone 一次）。'
    );
  }
}

/* ------------------------------------------------------------------ *
 * 镜像同步
 * ------------------------------------------------------------------ */

function syncInto(targetDir) {
  const sourceFiles = listSourceFiles();
  const sourceSet = new Set(sourceFiles);
  const targetFiles = listTargetFiles(targetDir);

  const added = [];
  const updated = [];
  const removed = [];

  for (const file of sourceFiles) {
    const from = path.join(WIKI_DIR, file);
    const to = path.join(targetDir, file);
    const existed = existsSync(to);
    mkdirSync(path.dirname(to), { recursive: true });
    const before = existed ? readFileSync(to) : null;
    const after = readFileSync(from);
    writeFileSync(to, after);
    if (!existed) added.push(file);
    else if (before === null || !before.equals(after)) updated.push(file);
  }

  // 以源目录为准删除多余文件（镜像语义），但绝不触碰 .git
  for (const file of targetFiles) {
    if (sourceSet.has(file)) continue;
    rmSync(path.join(targetDir, file), { force: true });
    removed.push(file);
  }

  return { added, updated, removed };
}

function reportDiff({ added, updated, removed }) {
  if (added.length === 0 && updated.length === 0 && removed.length === 0) {
    log('没有变化，跳过推送。');
    return false;
  }
  if (added.length > 0) {
    log(`\n新增 ${added.length} 个页面：`);
    for (const file of added) log(`  + ${file}`);
  }
  if (updated.length > 0) {
    log(`\n更新 ${updated.length} 个页面：`);
    for (const file of updated) log(`  ~ ${file}`);
  }
  if (removed.length > 0) {
    log(`\n删除 ${removed.length} 个页面：`);
    for (const file of removed) log(`  - ${file}`);
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

function main() {
  if (flags.help) {
    printUsage();
    return;
  }

  // 1. 静态校验（两种模式都先做，尽早失败）
  const problems = checkSource();
  if (problems.length > 0) {
    console.error(`✘ 源目录校验未通过（${problems.length} 项）：`);
    for (const problem of problems) console.error(`  · ${problem}`);
    process.exitCode = 1;
    return;
  }

  const sourceFiles = listSourceFiles();
  log(`✔ 源目录校验通过：${sourceFiles.length} 个文件（含 ${HOME_PAGE}）`);

  if (flags.check) {
    log('（--check 模式：不联网、不发布）');
    return;
  }

  // 2. 克隆远端 wiki 仓库到临时目录
  const remote = deriveRemote();
  log(`远端：${maskUrl(remote)}`);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'ricenote-wiki-'));
  const cloneDir = path.join(tempRoot, 'repo');

  try {
    log('正在克隆 wiki 仓库…');
    cloneWiki(remote, cloneDir);

    const branch = detectBranch(cloneDir);
    log(`目标分支：${branch}`);

    // 3. 镜像同步
    const diff = syncInto(cloneDir);
    const changed = reportDiff(diff);

    if (!changed) return;

    if (flags.dryRun) {
      log('\n（--dry-run 模式：未提交、未推送。确认无误后去掉 --dry-run 再跑一次）');
      return;
    }

    // 4. 提交并推送
    runGit(['add', '-A'], { cwd: cloneDir });
    try {
      runGit(['commit', '-m', flags.message], { cwd: cloneDir });
    } catch (error) {
      throw new Error(
        `${error.message}\n\n` +
          '提交失败。若提示缺少身份信息，请先配置：\n' +
          '  git config --global user.name "你的名字"\n' +
          '  git config --global user.email "你的邮箱"'
      );
    }

    try {
      runGit(['push', 'origin', branch], { cwd: cloneDir, stdio: ['ignore', 'inherit', 'pipe'] });
    } catch (error) {
      throw new Error(
        `${error.message}\n\n` +
          '推送失败。常见原因：\n' +
          '  1. 本机 git 无该仓库的写权限（配置凭据助手或使用 token 化的远端地址）；\n' +
          '  2. 远端分支被保护或存在他人提交（先手工 clone 检查一次）；\n' +
          '  3. 网络不可达。'
      );
    }

    log(`\n✔ 已发布到 ${maskUrl(remote)}（分支 ${branch}）`);
    log(`  新增 ${diff.added.length} · 更新 ${diff.updated.length} · 删除 ${diff.removed.length}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
