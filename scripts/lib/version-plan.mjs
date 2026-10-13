/**
 * 版本号派生规则引擎 —— **全仓唯一实现**。
 *
 * 单一来源：`packages/shared/manifests/plugin-catalog.json`
 *   - `appVersion`        → 应用版本（根 `package.json`、`packages/core/src/version.ts`、
 *                           四个 SDK 包与私有工作区包、插件的宿主区间、wiki 的版本字样）
 *   - `plugins[].version` → 各插件版本（`manifest.json`、`package.json`、
 *                           `README.md` 的版本行、wiki「官方插件一览」的版本列）
 *
 * 为什么必须是无构建的 `.mjs`：
 *   1. `pnpm version:check` 要挡在 `pnpm build` **之前**，不能依赖任何 `dist/` 产物；
 *   2. `packages/admin-sdk` 是浏览器产物，规则引擎绝不能被打进前端 bundle；
 *   3. `scripts/release-plugins.mjs` 直接 import 本模块，与 CLI、单测共用同一份规则，
 *      避免"校验逻辑两套、各自漂移"（这正是 0.6.x 里 README 版本行悄悄失真的成因）。
 *
 * 读写分离：`plan()` 只读盘、只报告；`apply()` 才写盘。
 *
 * 写入方式刻意**不用 `String.replace`**：规则在定位时就记录待替换片段的
 * `[start, end)`（正则带 `d` 标志，取捕获组的下标），`apply()` 按位置**倒序**拼接。
 * 这样既不受替换串里 `$` 语义影响，也不会因为同一文件上有多条规则而互相覆盖
 * （早先"闭包捕获旧文本 + 顺序 replace"的写法会把前一次改动丢掉，并把整段内容插错位置）。
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 宿主提供的包（写在插件的 peerDependencies 里）。 */
export const HOST_PACKAGES = ['@ricenote/plugin-sdk', '@ricenote/shared'];

/** 四个对外发布的 SDK 包（版本 = 应用版本）。 */
const SDK_PACKAGES = [
  'packages/shared/package.json',
  'packages/plugin-sdk/package.json',
  'packages/theme-sdk/package.json',
  'packages/admin-sdk/package.json'
];

/** 私有工作区包（不发布，但版本同样跟随应用版本，避免"0.1.0"式的误读）。 */
const PRIVATE_WORKSPACE_PACKAGES = [
  'packages/core/package.json',
  'apps/server/package.json',
  'apps/admin/package.json',
  'tests/package.json'
];

const CATALOG_PATH = 'packages/shared/manifests/plugin-catalog.json';
const CORE_VERSION_PATH = 'packages/core/src/version.ts';
const CHANGELOG_PATH = 'CHANGELOG.md';
const OFFICIAL_DIR = 'plugins/official';
const THIRD_PARTY_DIR = 'plugins/third-party';

/** `packages/core/src/version.ts` 里由本引擎维护的提示行（也由写入流程保证存在，从而幂等）。 */
const APP_VERSION_NOTICE = '// 本行由 `pnpm version:sync` 从 plugin-catalog.json 派生，请勿手改。';

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

/**
 * 插件声明的宿主区间：跟随宿主的**次版本**（`0.6.1` → `^0.6.0`）。
 *
 * 与 `wiki/Upgrading.md` 的既有约定一致：`0.x` 阶段只有次版本跃迁才跨出区间，
 * 因此补丁升级不需要动插件声明。
 */
export function hostRangeOf(appVersion) {
  const [major, minor] = String(appVersion).split('.');
  return `^${major}.${minor}.0`;
}

/** 语义化版本递增：`nextVersion('0.6.1', 'minor')` → `'0.7.0'`。 */
export function nextVersion(current, level) {
  const matched = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(current));
  if (!matched) throw new Error(`非法版本号：${current}`);
  let [major, minor, patch] = matched.slice(1).map(Number);

  if (level === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (level === 'minor') [minor, patch] = [minor + 1, 0];
  else if (level === 'patch') patch += 1;
  else throw new Error(`未知的递增级别：${level}（可选 patch / minor / major）`);

  return `${major}.${minor}.${patch}`;
}

function escapeRegExp(text) {
  return text.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// 读来源
// ---------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 扫描一个插件父目录，按 `manifest.id` 建索引（不假设目录名等于 ID）。 */
function scanPlugins(rootDir, parent) {
  const dir = path.join(rootDir, parent);
  if (!existsSync(dir)) return [];

  const plugins = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const base = path.join(dir, entry.name);
    const manifestFile = path.join(base, 'manifest.json');
    if (!existsSync(manifestFile)) continue;

    let manifest;
    try {
      manifest = readJson(manifestFile);
    } catch {
      continue;
    }
    const pkgFile = path.join(base, 'package.json');
    plugins.push({
      id: manifest.id,
      dir: path.posix.join(parent, entry.name),
      version: manifest.version,
      manifestFile: path.posix.join(parent, entry.name, 'manifest.json'),
      pkgFile: path.posix.join(parent, entry.name, 'package.json'),
      readmeFile: path.posix.join(parent, entry.name, 'README.md'),
      manifest,
      pkg: existsSync(pkgFile) ? readJson(pkgFile) : {}
    });
  }
  return plugins;
}

/**
 * 读单一来源并汇总。
 *
 * @returns {{
 *   rootDir: string, appVersion: string, hostRange: string,
 *   catalog: { appVersion: string, plugins: Array<{id: string, npm: string, version: string}> },
 *   official: ReturnType<typeof scanPlugins>, thirdParty: ReturnType<typeof scanPlugins>
 * }}
 */
export function readSource(rootDir) {
  const catalog = readJson(path.join(rootDir, CATALOG_PATH));
  return {
    rootDir,
    appVersion: catalog.appVersion,
    hostRange: hostRangeOf(catalog.appVersion),
    catalog,
    official: scanPlugins(rootDir, OFFICIAL_DIR),
    thirdParty: scanPlugins(rootDir, THIRD_PARTY_DIR)
  };
}

// ---------------------------------------------------------------------------
// 规则：`locate(text)` → `{ actual, hint, spans }`
//   - `actual`：当前值；`null` 表示**定位失败**（文件缺失 / 命中数 ≠ 1），`--check` 必须报错
//   - `spans`：待替换片段 `[{ start, end, value? }]`；`value` 缺省取该规则的 `expected`
// ---------------------------------------------------------------------------

const fail = (hint) => ({ actual: null, hint, spans: [] });

function rule({ file, label, expected, locate }) {
  return { file, label, expected, locate };
}

/** JSON 里顶层的 `"version": "x.y.z"` 行。 */
function jsonVersionRule(file, expected, label) {
  return rule({
    file,
    label,
    expected,
    locate(text) {
      // 这些文件里 `"version"` 恰好出现一次（plugins/official 全目录实测 26 处 = 13 manifest + 13 package）
      const hits = [...text.matchAll(/^(\s*"version":\s*")([^"]+)(")/dgm)];
      if (hits.length !== 1) {
        return fail(`\`"version"\` 命中 ${hits.length} 处，期望恰好 1 处（规则失效，请人工确认文件格式）`);
      }
      const actual = hits[0][2];
      const [start, end] = hits[0].indices[2];
      // 只有真的不同才产出待写片段（相同即视为已一致，避免"值相等却报不一致"）
      return { actual, spans: actual === expected ? [] : [{ start, end }] };
    }
  });
}

/** 插件 `package.json` 里某个宿主包的 peer 区间（只处理源码里**实际声明过**的宿主包）。 */
function jsonPeerRule(file, hostPackage, expected) {
  return rule({
    file,
    label: `peerDependencies.${hostPackage}`,
    expected,
    locate(text) {
      /*
       * 只匹配带 `^` 的那一处：peerDependencies 写 `^x.y.0`，
       * devDependencies 写 `workspace:^`（不匹配），peerDependenciesMeta 没有版本字符串。
       */
      const pattern = new RegExp(`"${escapeRegExp(hostPackage)}": "(\\^[^"]*)"`, 'dg');
      const hits = [...text.matchAll(pattern)];
      if (hits.length !== 1) return fail(`peer 区间命中 ${hits.length} 处，期望恰好 1 处`);
      const actual = hits[0][1];
      const [start, end] = hits[0].indices[1];
      return { actual, spans: actual === expected ? [] : [{ start, end }] };
    }
  });
}

/** 按单行正则定位（`pattern` 必须自带 `d`/`m` 标志，且恰好命中 1 行）。 */
function lineRule({ file, label, expected, pattern, group }) {
  return rule({
    file,
    label,
    expected,
    locate(text) {
      const hits = [...text.matchAll(pattern)];
      if (hits.length !== 1) return fail(`匹配 ${hits.length} 行，期望恰好 1 行`);
      const actual = hits[0][group];
      const [start, end] = hits[0].indices[group];
      return { actual, spans: actual === expected ? [] : [{ start, end }] };
    }
  });
}

/**
 * `wiki/Plugins-Overview.md` 全景表的版本单元格：按`` `id` `` 定位该行，只替换版本单元格。
 *
 * 刻意**不整表重生成**：该表的「提供的能力契约」「依赖」两列是人工叙述
 * （`——（消费 content.posts@1）` 之类，以及能力级依赖而非插件 ID），无法从清单派生。
 */
function overviewRowRule(file, id, expected, label) {
  return lineRule({
    file,
    label,
    expected: ` ${expected} `,
    pattern: new RegExp(`^(\\| [^|\\n]*\\| \`${escapeRegExp(id)}\` \\|)([^|]*)(\\|)`, 'dgm'),
    group: 2
  });
}

/** `packages/core/src/version.ts`：APP_VERSION 值 + 由引擎维护的提示行。 */
function coreVersionRule(expected) {
  return rule({
    file: CORE_VERSION_PATH,
    label: 'APP_VERSION',
    expected,
    locate(text) {
      const hits = [...text.matchAll(/^export const APP_VERSION = '([^']+)';$/dgm)];
      if (hits.length !== 1) return fail(`APP_VERSION 命中 ${hits.length} 处，期望恰好 1 处`);

      const actual = hits[0][1];
      const hasNotice = text.includes(APP_VERSION_NOTICE);
      const spans = [];
      if (!hasNotice) {
        // 首次 sync 时补上"由 version:sync 派生"的提示行（写入后即满足，保证幂等）
        spans.push({ start: hits[0].indices[0][0], end: hits[0].indices[0][0], value: `${APP_VERSION_NOTICE}\n` });
      }
      if (actual !== expected) {
        const [start, end] = hits[0].indices[1];
        spans.push({ start, end });
      }

      return {
        actual: hasNotice ? actual : null,
        hint: hasNotice ? null : '缺少"由 version:sync 派生"提示行（本次会补上）',
        spans
      };
    }
  });
}

/** 跑一遍规则：读文件 → 定位 → 与期望比较。 */
function evaluate(rootDir, rules) {
  const cache = new Map();

  return rules.map((item) => {
    const absolute = path.join(rootDir, item.file);
    let text = cache.get(item.file);
    if (text === undefined) {
      text = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
      cache.set(item.file, text);
    }
    if (text === null) return { ...item, actual: null, hint: '文件不存在', spans: [], ok: false };

    const located = item.locate(text);
    const actual = located.actual ?? null;
    const spans = (located.spans ?? []).map((span) => ({ ...span, value: span.value ?? item.expected }));

    return {
      ...item,
      actual,
      hint: located.hint ?? null,
      spans,
      ok: actual !== null && actual === item.expected && spans.length === 0
    };
  });
}

// ---------------------------------------------------------------------------
// plan / apply
// ---------------------------------------------------------------------------

/**
 * 产出期望清单（**只读盘**）。
 *
 * @returns {{
 *   rootDir: string, appVersion: string, hostRange: string,
 *   items: Array<{file: string, label: string, expected: string, actual: string|null, ok: boolean, hint: string|null, spans: Array<{start: number, end: number, value: string}>}>,
 *   issues: string[], notes: string[], ok: boolean
 * }}
 */
export function plan(rootDir) {
  const source = readSource(rootDir);
  const { appVersion, hostRange } = source;
  const rules = [];
  const issues = [];
  const notes = [];

  // 1. 应用版本
  rules.push(jsonVersionRule('package.json', appVersion, '应用版本'));
  rules.push(coreVersionRule(appVersion));
  for (const file of SDK_PACKAGES) rules.push(jsonVersionRule(file, appVersion, 'SDK 包版本'));
  for (const file of PRIVATE_WORKSPACE_PACKAGES) {
    rules.push(jsonVersionRule(file, appVersion, '私有工作区包版本'));
  }

  // 2. 官方插件：版本三处一致 + README 版本行 + 宿主区间
  const catalogById = new Map((source.catalog.plugins ?? []).map((entry) => [entry.id, entry]));
  for (const plugin of source.official) {
    const entry = catalogById.get(plugin.id);
    if (!entry) {
      issues.push(`${plugin.manifestFile} 的插件 ${plugin.id} 未登记在 ${CATALOG_PATH}（不会被发布，请先补条目）`);
      continue;
    }

    const pkgText = existsSync(path.join(rootDir, plugin.pkgFile)) ? readFileSync(path.join(rootDir, plugin.pkgFile), 'utf8') : '';
    rules.push(jsonVersionRule(plugin.manifestFile, entry.version, `${plugin.id} manifest.version`));
    rules.push(jsonVersionRule(plugin.pkgFile, entry.version, `${plugin.id} package.json version`));
    rules.push(
      lineRule({
        file: plugin.readmeFile,
        label: `${plugin.id} README 版本行`,
        expected: entry.version,
        pattern: /^\| version \| `([^`]+)` \|$/dgm,
        group: 1
      })
    );
    for (const hostPackage of HOST_PACKAGES) {
      // 只处理源码里实际声明过的宿主包（例如 rice.editor-enhance 不依赖 shared）
      if (!pkgText.includes(`"${hostPackage}"`)) continue;
      rules.push(jsonPeerRule(plugin.pkgFile, hostPackage, hostRange));
    }
  }

  // 3. 目录里有条目、磁盘上却没有插件目录
  const officialIds = new Set(source.official.map((plugin) => plugin.id));
  for (const entry of source.catalog.plugins ?? []) {
    if (!officialIds.has(entry.id)) {
      issues.push(`${CATALOG_PATH} 里的 ${entry.id} 在 ${OFFICIAL_DIR}/ 下找不到插件目录（manifest.id 不匹配）`);
    }
  }

  // 4. wiki 的版本字样
  rules.push(
    lineRule({
      file: 'wiki/Home.md',
      label: 'wiki 首页当前版本',
      expected: appVersion,
      pattern: /^(当前版本：\*\*)([^*]+)(\*\*)/dgm,
      group: 2
    })
  );
  rules.push(
    lineRule({
      file: 'wiki/_Footer.md',
      label: 'wiki 页脚版本',
      expected: appVersion,
      pattern: /^(RiceNote )([0-9][^\s｜]*)( ｜)/dgm,
      group: 2
    })
  );

  // 5. wiki「官方插件一览」的版本列：官方行取目录、第三方行取自身 manifest
  const overviewFile = 'wiki/Plugins-Overview.md';
  for (const plugin of source.official) {
    const entry = catalogById.get(plugin.id);
    if (entry) rules.push(overviewRowRule(overviewFile, plugin.id, entry.version, `${plugin.id} 版本列`));
  }
  for (const plugin of source.thirdParty) {
    rules.push(overviewRowRule(overviewFile, plugin.id, plugin.version, `${plugin.id} 版本列`));
  }

  // 6. 只报告、不派生：目录外的第三方示例
  for (const plugin of source.thirdParty) {
    if (plugin.pkg.version && plugin.pkg.version !== plugin.version) {
      notes.push(
        `${plugin.dir}：package.json ${plugin.pkg.version} ≠ manifest.json ${plugin.version}` +
          '（第三方示例不在官方目录内、不参与发布，需人工对齐）'
      );
    }
  }

  const items = evaluate(rootDir, rules);
  return {
    rootDir,
    appVersion,
    hostRange,
    items,
    issues,
    notes,
    ok: issues.length === 0 && items.every((entry) => entry.ok)
  };
}

/**
 * 按清单写回（**只有显式 `version:sync` / `version:bump` 会调用**）。
 *
 * 同一文件上的多个片段按 `start` **倒序**拼接：先改后面的偏移，前面的偏移才仍然有效。
 *
 * @returns {string[]} 实际改动的文件（相对路径）
 */
export function apply(planResult) {
  const byFile = new Map();
  for (const entry of planResult.items) {
    if (entry.ok || entry.spans.length === 0) continue;
    byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), ...entry.spans]);
  }

  const changed = [];
  for (const [file, spans] of byFile) {
    const absolute = path.join(planResult.rootDir, file);
    let text = readFileSync(absolute, 'utf8');
    for (const span of [...spans].sort((a, b) => b.start - a.start)) {
      text = `${text.slice(0, span.start)}${span.value}${text.slice(span.end)}`;
    }
    writeFileSync(absolute, text);
    changed.push(file);
  }

  return changed.sort();
}

/** 只写单一来源（`--bump` 用）：`appVersion` 与（可选的）若干插件版本。 */
export function writeSource(rootDir, { appVersion, pluginVersions = {} }) {
  const file = path.join(rootDir, CATALOG_PATH);
  let text = readFileSync(file, 'utf8');

  if (appVersion) {
    const hits = [...text.matchAll(/^(\s*"appVersion": ")([^"]+)(")/dgm)];
    if (hits.length !== 1) throw new Error(`${CATALOG_PATH}: appVersion 命中 ${hits.length} 处`);
    const [start, end] = hits[0].indices[2];
    text = `${text.slice(0, start)}${appVersion}${text.slice(end)}`;
  }

  for (const [id, version] of Object.entries(pluginVersions)) {
    const pattern = new RegExp(
      `("id": "${escapeRegExp(id)}",\\s*\\n\\s*"npm": "[^"]+",\\s*\\n\\s*"version": ")([^"]+)(")`,
      'd'
    );
    const hit = pattern.exec(text);
    if (!hit) throw new Error(`目录里找不到插件 ${id} 的版本行`);
    const [start, end] = hit.indices[2];
    text = `${text.slice(0, start)}${version}${text.slice(end)}`;
  }

  writeFileSync(file, text);
  return CATALOG_PATH;
}

/** 今日日期（本地时区），用于 CHANGELOG 段落标题。 */
export function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 收口 CHANGELOG（仅 `--bump` 调用）。
 *
 *   - `## [Unreleased]` 里若已有内容，整体搬进新版本段落；为空则只插入新段落标题；
 *   - 底部链接引用块：`[Unreleased]` 的比较基准指向新版本，并补一行新版本的 tag 链接。
 *
 * **不生成变更条目正文**（条目由人写，keepachangelog 1.1.0）。
 */
export function releaseChangelog(rootDir, version, date = today()) {
  const file = path.join(rootDir, CHANGELOG_PATH);
  if (!existsSync(file)) {
    throw new Error(`${CHANGELOG_PATH} 不存在 —— 发版前请先建好（含 \`## [Unreleased]\` 段与底部链接引用）`);
  }
  let text = readFileSync(file, 'utf8');

  const unreleased = /^## \[Unreleased\][ \t]*\n/m.exec(text);
  if (!unreleased) throw new Error(`${CHANGELOG_PATH} 里找不到 \`## [Unreleased]\` 段`);

  const head = text.slice(0, unreleased.index + unreleased[0].length);
  const rest = text.slice(unreleased.index + unreleased[0].length);
  const nextHeading = /^## \[/m.exec(rest);
  const body = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const tail = nextHeading ? rest.slice(nextHeading.index) : '';

  const moved = body.trim().length > 0 ? `\n${body.trim()}\n` : '';
  text = `${head}\n## [${version}] - ${date}\n${moved}\n${tail}`;

  // 链接引用：比较基准指向新版本
  text = text.replace(
    /^\[Unreleased\]: (\S+)\/compare\/v[\d.]+\.\.\.HEAD$/m,
    `[Unreleased]: $1/compare/v${version}...HEAD`
  );
  // 补一行新版本的 tag 链接（若还没有）
  if (!new RegExp(`^\\[${escapeRegExp(version)}\\]:`, 'm').test(text)) {
    text = text.replace(
      /^(\[Unreleased\]: \S+\/compare\/v[\d.]+\.\.\.HEAD)$/m,
      `$1\n[${version}]: https://github.com/ricenote/ricenote/releases/tag/v${version}`
    );
  }

  writeFileSync(file, text);
  return CHANGELOG_PATH;
}
