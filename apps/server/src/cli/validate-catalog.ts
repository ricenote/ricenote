/**
 * `ricenote validate` 的「官方插件目录」一致性校验。
 *
 * 为什么单独一块：官方插件一旦发布到 npm 就**收不回**，因此所有会导致
 * "发出去一个坏包"的漂移都必须在提交前拦住：
 * - manifest 版本 / package.json 版本 / 目录推荐版本三处不一致；
 * - 包名与目录不一致（装出来的插件与清单对不上）；
 * - `private: true`（根本发不出去）或缺少 `publishConfig.access=public`；
 * - `files` 没带 `dist` / `manifest.json`（装出来没有入口或无法被识别）；
 * - 把「宿主提供的包」写成普通依赖（会在插件目录内生成第二份实例）。
 *
 * 方向性：**目录 → 仓库** 不一致算错误；**仓库 → 目录** 的孤立插件只提示
 * （允许在 `plugins/official` 下放开发中的插件，不强制它立刻进发布清单）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  getPluginCatalog,
  isHostProvidedPackage,
  type PluginCatalog,
  type PluginCatalogEntry
} from '@ricenote/shared';

export interface CatalogIssue {
  path: string;
  message: string;
  keyword: string;
}

export interface CatalogValidation {
  ok: boolean;
  total: number;
  valid: number;
  invalid: { id: string; label: string; issues: CatalogIssue[] }[];
  /** 不阻塞提交的提示（例如开发中的插件未进目录、清单 appVersion 未同步）。 */
  notes: string[];
  appVersion: string;
  catalogAppVersion: string;
}

interface PackageJsonShape {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  publishConfig?: { access?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function validateCatalog(input: {
  officialDir: string | undefined;
  appVersion: string;
}): CatalogValidation {
  let catalog: PluginCatalog;
  try {
    catalog = getPluginCatalog();
  } catch (error) {
    return {
      ok: false,
      total: 0,
      valid: 0,
      invalid: [
        {
          id: '(catalog)',
          label: '官方插件目录',
          issues: [
            {
              path: '/',
              message: error instanceof Error ? error.message : String(error),
              keyword: 'catalog'
            }
          ]
        }
      ],
      notes: [],
      appVersion: input.appVersion,
      catalogAppVersion: '-'
    };
  }

  const invalid: CatalogValidation['invalid'] = [];
  const notes: string[] = [];

  if (catalog.appVersion !== input.appVersion) {
    /*
     * 这里只提示、不自己实现全量比对：版本号的一致性由 `scripts/lib/version-plan.mjs`
     * 统一负责（单一来源 = plugin-catalog.json），根 `pnpm validate` 已先串 `pnpm version:check`。
     */
    notes.push(
      `官方插件目录的 appVersion=${catalog.appVersion} 与当前应用版本 ${input.appVersion} 不一致` +
        `（运行 pnpm version:check 可看到全部不同步项，pnpm version:sync 按目录清单写回）`
    );
  }

  const seenIds = new Set<string>();
  for (const entry of catalog.plugins) {
    const issues: CatalogIssue[] = [];
    if (seenIds.has(entry.id)) {
      issues.push({ path: '/id', message: `目录中存在重复的插件 ID：${entry.id}`, keyword: 'duplicate' });
    }
    seenIds.add(entry.id);

    for (const dependency of entry.requires) {
      if (!catalog.plugins.some((item) => item.id === dependency)) {
        issues.push({
          path: '/requires',
          message: `依赖的插件不在目录中：${dependency}`,
          keyword: 'requires'
        });
      }
    }

    if (input.officialDir) {
      collectPluginIssues(entry, input.officialDir, issues);
    }

    if (issues.length > 0) invalid.push({ id: entry.id, label: entry.label, issues });
  }

  // 反向：仓库里有、目录里没有（允许存在，但提示一句，避免"以为它会被发布"）
  if (input.officialDir && existsSync(input.officialDir)) {
    for (const dirName of readdirSync(input.officialDir, { withFileTypes: true })) {
      if (!dirName.isDirectory() || dirName.name.startsWith('.')) continue;
      const manifestPath = path.join(input.officialDir, dirName.name, 'manifest.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath) as { id?: string };
      if (manifest.id && !catalog.plugins.some((item) => item.id === manifest.id)) {
        notes.push(`${manifest.id} 位于 plugins/official 但不在官方插件目录中，不会被发布`);
      }
    }
  }

  return {
    ok: invalid.length === 0,
    total: catalog.plugins.length,
    valid: catalog.plugins.length - invalid.length,
    invalid,
    notes,
    appVersion: input.appVersion,
    catalogAppVersion: catalog.appVersion
  };
}

/** 单个目录条目与仓库中插件实际形态的对照。 */
function collectPluginIssues(
  entry: PluginCatalogEntry,
  officialDir: string,
  issues: CatalogIssue[]
): void {
  const dir = findPluginDir(officialDir, entry);
  if (!dir) {
    issues.push({
      path: '/npm',
      message: `在 plugins/official 下找不到该插件的目录（应包含 manifest.json 且 id 为 ${entry.id}）`,
      keyword: 'missing'
    });
    return;
  }

  const manifest = readJson(path.join(dir, 'manifest.json')) as {
    id?: string;
    version?: string;
    license?: string;
    capabilities?: string[];
  };
  const pkgPath = path.join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    issues.push({ path: '/package.json', message: '缺少 package.json，无法发布到 npm', keyword: 'missing' });
    return;
  }
  const pkg = readJson(pkgPath) as PackageJsonShape;

  if (manifest.id !== entry.id) {
    issues.push({
      path: '/id',
      message: `manifest.id=${manifest.id} 与目录条目 ${entry.id} 不一致`,
      keyword: 'id'
    });
  }
  if (manifest.version !== entry.version) {
    issues.push({
      path: '/version',
      message: `manifest 版本 ${manifest.version} 与推荐版本 ${entry.version} 不一致`,
      keyword: 'version'
    });
  }
  if (pkg.version !== entry.version) {
    issues.push({
      path: '/package.json:version',
      message: `package.json 版本 ${pkg.version} 与推荐版本 ${entry.version} 不一致`,
      keyword: 'version'
    });
  }
  if (pkg.name !== entry.npm) {
    issues.push({
      path: '/package.json:name',
      message: `包名 ${pkg.name} 与目录条目 ${entry.npm} 不一致`,
      keyword: 'name'
    });
  }
  if (pkg.private === true) {
    issues.push({
      path: '/package.json:private',
      message: '仍标记 private，无法发布',
      keyword: 'private'
    });
  }
  if (pkg.publishConfig?.access !== 'public') {
    issues.push({
      path: '/package.json:publishConfig',
      message: '缺少 publishConfig.access=public（作用域包必须显式声明公开）',
      keyword: 'publishConfig'
    });
  }
  for (const required of ['dist', 'manifest.json']) {
    if (!pkg.files || !pkg.files.includes(required)) {
      issues.push({
        path: '/package.json:files',
        message: `files 必须包含 ${required}（否则发布包缺少产物或无法被安装器识别）`,
        keyword: 'files'
      });
    }
  }
  for (const group of [pkg.dependencies, pkg.optionalDependencies]) {
    for (const name of Object.keys(group ?? {})) {
      if (isHostProvidedPackage(name)) {
        issues.push({
          path: '/package.json:dependencies',
          message: `${name} 是宿主提供的包，不能写成普通依赖（会在插件目录内生成第二份实例）；请改为 peerDependencies + peerDependenciesMeta.optional`,
          keyword: 'dependencies'
        });
      }
    }
  }

  const capabilityDiff = diffCapabilities(entry.capabilities, manifest.capabilities ?? []);
  if (capabilityDiff.length > 0) {
    issues.push({
      path: '/capabilities',
      message: `与 manifest.capabilities 不一致：${capabilityDiff.join('、')}`,
      keyword: 'capabilities'
    });
  }
}

/** 在官方目录里按 id 找到插件目录（避免依赖目录名与 ID 同名的假设）。 */
function findPluginDir(officialDir: string, entry: PluginCatalogEntry): string | undefined {
  for (const dirName of readdirSync(officialDir, { withFileTypes: true })) {
    if (!dirName.isDirectory() || dirName.name.startsWith('.')) continue;
    const dir = path.join(officialDir, dirName.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath) as { id?: string };
    if (manifest.id === entry.id) return dir;
  }
  return undefined;
}

/** 比较能力白名单（双向差集，任一方向不一致都报出来）。 */
function diffCapabilities(expected: string[], actual: string[]): string[] {
  const left = new Set(expected);
  const right = new Set(actual);
  const diff = [
    ...expected.filter((item) => !right.has(item)),
    ...actual.filter((item) => !left.has(item))
  ];
  return [...new Set(diff)];
}
