/**
 * 插件包安装（压缩包上传路径）。
 *
 * 与主题安装**同构**：两阶段「先全量校验、再落盘」，并复用
 * `extractZipSafely` 的全部安全防护（Zip Slip、绝对路径、Windows 盘符、
 * 反斜杠绕过、符号链接穿越、体积与条目限额、扩展名白名单）。
 *
 * v0.4.0 起，压缩包上传只是**本地目录来源的一种投放方式**（`via: 'zip'`），
 * 完整的三种来源（npm Registry / Git 仓库 / 本地目录）统一走
 * `install/orchestrator.ts`；本文件保留为"把 ZIP 解出来并落盘"的专用实现，
 * 结构校验逻辑已抽到 `install/package-validation.ts` 供两者共用。
 *
 * 安全说明（说明书第 10 章）：v1 插件在进程内运行、**没有真实沙箱**，
 * 因此安装动作本身只允许受信任管理员执行，且前端必须显示高风险提示。
 */

import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { PluginInstallResult } from '@ricenote/shared';
import type { Logger } from '../logger.js';
import { extractZipSafely, type ZipGuardOptions } from '../themes/zip-guard.js';
import { shortName } from './manager.js';
import {
  PLUGIN_ZIP_GUARD,
  assertPackageLayout,
  detectUpgrade,
  locatePluginRoot,
  readPackageManifest
} from './install/package-validation.js';

export { PLUGIN_ZIP_GUARD };

export interface InstallPluginInput {
  archive: Buffer;
  /** 安装目标根目录（通常为 `config.paths.pluginsInstallDir`）。 */
  installDir: string;
  /** 临时工作目录（通常为 `config.paths.cacheDir`）。 */
  cacheDir: string;
  logger: Logger;
  /** 覆盖默认安全限额（测试用）。 */
  guard?: ZipGuardOptions;
  /** 进度/日志回调（后台任务日志用）。 */
  onLog?: (line: string) => void;
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
    const manifest = readPackageManifest(root);
    assertPackageLayout(root, manifest);

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
      restartRequired: true,
      source: { type: 'local', spec: '', via: 'zip' }
    };
  } finally {
    if (tempTarget) rmSync(tempTarget, { recursive: true, force: true });
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function randomSuffix(): string {
  return randomBytes(4).toString('hex');
}
