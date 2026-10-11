/**
 * 插件包安装（后台 ZIP 上传安装）。
 *
 * 与主题安装**同构**：两阶段「先全量校验、再落盘」，并复用
 * `extractZipSafely` 的全部安全防护（Zip Slip、绝对路径、Windows 盘符、
 * 反斜杠绕过、符号链接穿越、体积与条目限额、扩展名白名单），
 * 差别只在错误码与扩展名白名单（插件包额外允许 `.sql` 迁移文件）。
 *
 * 安全说明（说明书第 10 章）：v1 插件在进程内运行、**没有真实沙箱**，
 * 因此安装动作本身只允许受信任管理员执行，且前端必须显示高风险提示。
 */

import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ErrorCode,
  RiceNoteError,
  createManifestValidator,
  type PluginInstallResult,
  type PluginManifest
} from '@ricenote/shared';
import type { Logger } from '../logger.js';
import { DEFAULT_ZIP_GUARD, extractZipSafely, type ZipGuardOptions } from '../themes/zip-guard.js';
import { shortName } from './manager.js';

const manifestValidator = createManifestValidator();

/**
 * 插件包允许的文件类型。
 *
 * 刻意比主题包更窄：插件只应包含产物与迁移，不含模板与字体等渲染资源。
 */
const PLUGIN_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.sql', '.md', '.txt', '.map'];

/** 插件包安全限额：插件体积远小于主题，限额相应收紧。 */
export const PLUGIN_ZIP_GUARD: ZipGuardOptions = {
  ...DEFAULT_ZIP_GUARD,
  maxArchiveBytes: 16 * 1024 * 1024,
  maxEntries: 2000,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxEntryUncompressedBytes: 16 * 1024 * 1024,
  allowedExtensions: PLUGIN_EXTENSIONS,
  errorCode: ErrorCode.PLUGIN_ARCHIVE_UNSAFE
};

export interface InstallPluginInput {
  archive: Buffer;
  /** 安装目标根目录（通常为 `config.paths.pluginsInstallDir`）。 */
  installDir: string;
  /** 临时工作目录（通常为 `config.paths.cacheDir`）。 */
  cacheDir: string;
  logger: Logger;
  /** 覆盖默认安全限额（测试用）。 */
  guard?: ZipGuardOptions;
}

/**
 * 从 ZIP 安装或升级一个插件。
 *
 * 流程：staging 解压 → 定位插件根 → 校验清单与入口 → 目录换名落盘。
 * 任何一步失败都不会留下半成品目录。
 */
export async function installPluginFromZip(input: InstallPluginInput): Promise<PluginInstallResult> {
  const guard = input.guard ?? PLUGIN_ZIP_GUARD;
  const stagingDir = path.join(input.cacheDir, `plugin-install-${Date.now()}-${randomSuffix()}`);
  mkdirSync(stagingDir, { recursive: true });

  let tempTarget: string | undefined;

  try {
    // 阶段一：全部安全校验在 extractZipSafely 内部完成（写盘前拒绝恶意条目）
    extractZipSafely(input.archive, stagingDir, guard);

    // 阶段二：结构校验
    const root = locatePluginRoot(stagingDir);
    const manifest = readManifest(root);
    assertEntryAndMigrations(root, manifest);

    const targetDir = path.join(input.installDir, shortName(manifest.id));
    const upgraded = detectUpgrade(targetDir, manifest);

    // 阶段三：先在临时目录完成复制，再换名，尽量缩短"无可用版本"的窗口
    tempTarget = `${targetDir}.incoming-${randomSuffix()}`;
    mkdirSync(path.dirname(targetDir), { recursive: true });
    cpSync(root, tempTarget, { recursive: true });

    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    renameSync(tempTarget, targetDir);
    tempTarget = undefined;

    input.logger.info(upgraded ? '插件已升级' : '插件已安装', {
      pluginId: manifest.id,
      version: manifest.version,
      dir: targetDir,
      upgraded
    });

    return {
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      dir: shortName(manifest.id),
      upgraded,
      restartRequired: true
    };
  } finally {
    if (tempTarget) rmSync(tempTarget, { recursive: true, force: true });
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function randomSuffix(): string {
  return randomBytes(4).toString('hex');
}

function fail(message: string, status = 400, details?: Record<string, unknown>): never {
  throw new RiceNoteError(ErrorCode.PLUGIN_INSTALL_FAILED, message, { status, details });
}

/** 兼容「压缩包内多包一层目录」的打包方式。 */
function locatePluginRoot(stagingDir: string): string {
  if (existsSync(path.join(stagingDir, 'manifest.json'))) return stagingDir;

  const candidates = readdirSync(stagingDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(stagingDir, entry.name))
    .filter((dir) => existsSync(path.join(dir, 'manifest.json')));

  // 多于一个候选时交由 readManifest 报出"缺少 manifest.json"，避免猜测
  return candidates.length === 1 ? candidates[0]! : stagingDir;
}

function readManifest(root: string): PluginManifest {
  const manifestPath = path.join(root, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail('插件包缺少 manifest.json（应位于压缩包根目录或唯一的顶层子目录下）');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`manifest.json 不是合法 JSON：${String(error)}`);
  }

  const result = manifestValidator.validatePlugin(parsed);
  if (!result.valid) {
    fail('插件清单未通过校验', 400, { issues: result.issues });
  }

  return parsed as PluginManifest;
}

/** 校验入口与迁移目录存在且未越出插件目录。 */
function assertEntryAndMigrations(root: string, manifest: PluginManifest): void {
  const absoluteRoot = path.resolve(root);
  const entryPath = path.resolve(absoluteRoot, manifest.entry);
  if (entryPath !== absoluteRoot && !entryPath.startsWith(`${absoluteRoot}${path.sep}`)) {
    fail(`清单中的入口路径越出插件目录：${manifest.entry}`);
  }
  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) {
    fail(`插件包缺少入口文件：${manifest.entry}（请先构建产物再打包）`);
  }

  if (manifest.migrations) {
    const migrationsDir = path.resolve(absoluteRoot, manifest.migrations);
    if (!migrationsDir.startsWith(`${absoluteRoot}${path.sep}`)) {
      fail(`清单中的迁移目录越出插件目录：${manifest.migrations}`);
    }
    if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) {
      fail(`清单声明的迁移目录不存在：${manifest.migrations}`);
    }
  }
}

/**
 * 判断是升级还是新装。
 *
 * 目标目录由插件 ID 的短名决定（`acme.notes` → `notes`）。若该目录已被
 * **另一个插件 ID** 占用则拒绝安装，避免不同厂商的同名插件互相覆盖。
 */
function detectUpgrade(targetDir: string, manifest: PluginManifest): boolean {
  const existingManifest = path.join(targetDir, 'manifest.json');
  if (!existsSync(existingManifest)) return false;

  let existingId: string | undefined;
  try {
    existingId = (JSON.parse(readFileSync(existingManifest, 'utf8')) as { id?: string }).id;
  } catch {
    existingId = undefined;
  }

  if (existingId === manifest.id) return true;

  fail(
    `安装目录 ${path.basename(targetDir)} 已被其他插件占用（现有 ${existingId ?? '未知 ID'}，待安装 ${manifest.id}）`,
    409,
    { dir: path.basename(targetDir), existingId, incomingId: manifest.id }
  );
}
