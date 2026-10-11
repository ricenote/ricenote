/**
 * 插件包的结构校验（ZIP 上传与三种安装来源共用）。
 *
 * 抽出来的原因：无论插件从哪来（npm tarball / git 仓库 / 本地目录 / 压缩包），
 * "它是不是一个合法的 RiceNote 插件、能不能安全落盘"的判定必须**完全相同** ——
 * 否则会演化出"ZIP 装不了但 npm 能装某个坏包"这类缺口。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ErrorCode,
  RiceNoteError,
  createManifestValidator,
  type PluginManifest
} from '@ricenote/shared';
import { DEFAULT_ZIP_GUARD, type ZipGuardOptions } from '../../themes/zip-guard.js';

const manifestValidator = createManifestValidator();

/**
 * 插件包允许的文件类型。
 *
 * 比主题包更窄（插件不应包含模板与字体等渲染资源），但必须容纳两类新增内容：
 * - 插件自带后台界面：`admin/*.js` 与可选 `admin/*.css`；
 * - 依赖安装产物：`package.json` / `package-lock.json` / `*.wasm` 等。
 *
 * 仍然**不允许** `.node` 原生模块：它们无法跨平台分发，且加载时无需任何检查，
 * 与"安装即可见"的审计目标冲突（需要时请改用纯 JS 实现或 WASM）。
 */
export const PLUGIN_EXTENSIONS = [
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.sql',
  '.md',
  '.txt',
  '.map',
  '.css',
  '.html',
  '.wasm',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.woff',
  '.woff2'
];

/**
 * 插件包安全限额。
 *
 * v0.4.0 放宽了 `allowedExtensions` 与总体积：插件现在可以自带后台界面样式与
 * 依赖产物。条目上限保持不变（2000）—— 依赖树再大也不该有上万个文件，
 * 超过这个数量通常意味着打包方式有问题（例如把整个仓库打了进去）。
 */
export const PLUGIN_ZIP_GUARD: ZipGuardOptions = {
  ...DEFAULT_ZIP_GUARD,
  maxArchiveBytes: 32 * 1024 * 1024,
  maxEntries: 2000,
  maxTotalUncompressedBytes: 96 * 1024 * 1024,
  maxEntryUncompressedBytes: 16 * 1024 * 1024,
  allowedExtensions: PLUGIN_EXTENSIONS,
  errorCode: ErrorCode.PLUGIN_ARCHIVE_UNSAFE
};

export function failInstall(message: string, status = 400, details?: Record<string, unknown>): never {
  throw new RiceNoteError(ErrorCode.PLUGIN_INSTALL_FAILED, message, { status, details });
}

/**
 * 兼容「压缩包内多包一层目录」的打包方式。
 *
 * npm tarball 一定是 `package/` 前缀，git 仓库则通常直接在根目录，
 * 这里统一处理：根目录有 manifest 就用根目录，否则看唯一的顶层子目录。
 */
export function locatePluginRoot(stagingDir: string): string {
  if (existsSync(path.join(stagingDir, 'manifest.json'))) return stagingDir;

  const candidates = readDirNames(stagingDir)
    .map((name) => path.join(stagingDir, name))
    .filter((dir) => existsSync(path.join(dir, 'manifest.json')));

  // 多于一个候选时交由 readManifest 报出"缺少 manifest.json"，避免猜测
  return candidates.length === 1 ? candidates[0]! : stagingDir;
}

function readDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 读取并校验 `manifest.json`。 */
export function readPackageManifest(root: string): PluginManifest {
  const manifestPath = path.join(root, 'manifest.json');
  if (!existsSync(manifestPath)) {
    failInstall('插件包缺少 manifest.json（应位于根目录或唯一的顶层子目录下）');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failInstall(`manifest.json 不是合法 JSON：${String(error)}`);
  }

  const result = manifestValidator.validatePlugin(parsed);
  if (!result.valid) {
    failInstall('插件清单未通过校验', 400, { issues: result.issues });
  }

  return parsed as PluginManifest;
}

/**
 * 校验入口、迁移目录与后台界面入口存在且未越出插件目录。
 *
 * 越界检查是必须的：`entry` 来自待安装的包本身，若允许 `../../`，
 * 一个插件就能让内核去加载插件目录之外的任意文件。
 */
export function assertPackageLayout(root: string, manifest: PluginManifest): void {
  const absoluteRoot = path.resolve(root);

  assertInside(absoluteRoot, manifest.entry, '入口');
  const entryPath = path.resolve(absoluteRoot, manifest.entry);
  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) {
    failInstall(`插件包缺少入口文件：${manifest.entry}（请先构建产物再打包）`);
  }

  if (manifest.migrations) {
    assertInside(absoluteRoot, manifest.migrations, '迁移目录');
    const migrationsDir = path.resolve(absoluteRoot, manifest.migrations);
    if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) {
      failInstall(`清单声明的迁移目录不存在：${manifest.migrations}`);
    }
  }

  for (const page of manifest.admin?.pages ?? []) {
    // 后台界面入口可选存在（未构建时后台会给出"界面加载失败"提示），
    // 但一旦声明就绝不能越出插件目录。
    assertInside(absoluteRoot, page.entry, '后台界面入口');
    if (page.style) assertInside(absoluteRoot, page.style, '后台界面样式');
  }
}

function assertInside(root: string, relative: string, label: string): void {
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    failInstall(`清单中的${label}路径越出插件目录：${relative}`);
  }
}

/**
 * 判断是升级还是新装，并阻止"不同插件 ID 抢同一个目录"。
 *
 * 目标目录由插件 ID 的短名决定（`acme.notes` → `notes`）。若该目录已被
 * **另一个插件 ID** 占用则拒绝安装，避免不同厂商的同名插件互相覆盖。
 */
export function detectUpgrade(targetDir: string, manifest: PluginManifest): boolean {
  const existingManifest = path.join(targetDir, 'manifest.json');
  if (!existsSync(existingManifest)) return false;

  let existingId: string | undefined;
  try {
    existingId = (JSON.parse(readFileSync(existingManifest, 'utf8')) as { id?: string }).id;
  } catch {
    existingId = undefined;
  }

  if (existingId === manifest.id) return true;

  failInstall(
    `安装目录 ${path.basename(targetDir)} 已被其他插件占用（现有 ${existingId ?? '未知 ID'}，待安装 ${manifest.id}）`,
    409,
    { dir: path.basename(targetDir), existingId, incomingId: manifest.id }
  );
}
