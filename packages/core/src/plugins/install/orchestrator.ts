/**
 * 插件安装编排：resolve → prepare → commit（失败即回滚）。
 *
 * 三段式的意义在于**把不可逆动作压到最后一刻**：
 * - `resolve`：把来源变成工作区里的一个目录（网络/磁盘出错都在这里）；
 * - `prepare`：校验清单与入口、装依赖、执行构建（最容易失败，且都在工作区里，不影响现有版本）；
 * - `commit`：换名落盘（旧版本先备份，成功后删除，失败则还原）。
 *
 * 因此"升级失败"不会留下半成品目录，也不会让现有版本消失。
 *
 * 安全说明（说明书第 10 章）：插件在进程内运行、没有真实沙箱；
 * 安装第三方插件等同授予其服务器代码执行权限 —— 因此依赖安装与构建脚本
 * **默认允许执行**（用户决策），但必须由后台高风险确认与审计承担这份明示责任。
 */

import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { isHostProvidedPackage } from '@ricenote/shared';
import type { PluginInstallResult, PluginSourceInfo } from '@ricenote/shared';
import type { Logger } from '../../logger.js';
import { shortName } from '../manager.js';
import {
  assertPackageLayout,
  detectUpgrade,
  readPackageManifest
} from './package-validation.js';
import { resolveSource, type InstallSourceInput } from './sources.js';
import { detectToolchain, requirePackageManager, runCommand, type ToolchainInfo } from './toolchain.js';

export type InstallStep = 'resolve' | 'prepare' | 'commit';

export interface InstallProgress {
  step: InstallStep;
  /** 0–100，供后台进度条使用。 */
  progress: number;
  /** 人类可读的当前动作（会写进任务日志）。 */
  log?: string;
}

export interface InstallPluginRequest {
  source: InstallSourceInput;
  /** 安装目标根目录（通常为 `config.paths.pluginsInstallDir`）。 */
  installDir: string;
  /** 临时工作目录（通常为 `config.paths.cacheDir`）。 */
  cacheDir: string;
  logger: Logger;
  /** 已探测的工具链；未提供时自行探测。 */
  toolchain?: ToolchainInfo;
  /** 是否允许依赖安装脚本与构建脚本执行（见文件头说明）。 */
  allowScripts?: boolean;
  /** npm 私有源配置（只从环境变量读取，不落库、不进日志）。 */
  npm?: { registry?: string; token?: string };
  onProgress?: (update: InstallProgress) => void;
  signal?: AbortSignal;
  /** 单条命令超时（毫秒），默认 10 分钟。 */
  commandTimeoutMs?: number;
}

export interface InstallPluginOutcome {
  result: PluginInstallResult;
  /** 实际解析到的来源（含解析后的版本 / 完整性校验值）。 */
  source: PluginSourceInfo;
}

/** 落盘前的整树体积上限（防"克隆了一个巨大的仓库"这类意外）。 */
const MAX_TREE_BYTES = 96 * 1024 * 1024;

export async function installPlugin(request: InstallPluginRequest): Promise<InstallPluginOutcome> {
  const workDir = path.join(
    request.cacheDir,
    `plugin-install-${Date.now()}-${randomBytes(4).toString('hex')}`
  );
  mkdirSync(workDir, { recursive: true });

  const toolchain = request.toolchain ?? (await detectToolchain(request.logger));
  const allowScripts = request.allowScripts ?? true;
  const timeoutMs = request.commandTimeoutMs ?? 10 * 60 * 1000;

  const log = (step: InstallStep, progress: number, message: string): void => {
    request.logger.info(`[插件安装] ${message}`);
    request.onProgress?.({ step, progress, log: message });
  };

  try {
    // ---------- 1) resolve ----------
    log('resolve', 5, `解析来源：${describeSource(request.source)}`);
    const resolved = await resolveSource(request.source, {
      workDir,
      logger: request.logger,
      toolchain,
      npm: request.npm ?? {},
      onLog: (line: string) => request.onProgress?.({ step: 'resolve', progress: 20, log: line }),
      ...(request.signal ? { signal: request.signal } : {})
    });

    // ---------- 2) prepare ----------
    const manifest = readPackageManifest(resolved.rootDir);
    assertPackageLayout(resolved.rootDir, manifest);
    log('prepare', 35, `已校验清单：${manifest.id} v${manifest.version}`);

    await preparePackage(resolved.rootDir, {
      toolchain,
      allowScripts,
      timeoutMs,
      log: (message) => log('prepare', 55, message),
      ...(request.signal ? { signal: request.signal } : {})
    });

    // 构建可能生成入口文件，因此构建后必须重新校验布局
    assertPackageLayout(resolved.rootDir, manifest);

    const treeBytes = measureTree(resolved.rootDir);
    if (treeBytes > MAX_TREE_BYTES) {
      throw new Error(
        `插件体积超出上限（${Math.round(treeBytes / 1024 / 1024)}MB > ${Math.round(MAX_TREE_BYTES / 1024 / 1024)}MB）`
      );
    }

    // ---------- 3) commit ----------
    const targetDir = path.join(request.installDir, shortName(manifest.id));
    const upgraded = detectUpgrade(targetDir, manifest);
    log('commit', 85, `${upgraded ? '升级' : '安装'}到 ${path.relative(request.cacheDir, targetDir)}`);

    commitDirectory(resolved.rootDir, targetDir, {
      cacheDir: request.cacheDir,
      logger: request.logger
    });

    log('commit', 100, `${manifest.id} v${manifest.version} 已${upgraded ? '升级' : '安装'}`);

    request.logger.info(upgraded ? '插件已升级' : '插件已安装', {
      pluginId: manifest.id,
      version: manifest.version,
      dir: targetDir,
      source: resolved.record.type,
      upgraded
    });

    return {
      result: {
        pluginId: manifest.id,
        name: manifest.name,
        version: manifest.version,
        dir: shortName(manifest.id),
        upgraded,
        restartRequired: true,
        source: resolved.record
      },
      source: resolved.record
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/* ------------------------------- prepare 细节 ------------------------------- */

interface PrepareContext {
  toolchain: ToolchainInfo;
  allowScripts: boolean;
  timeoutMs: number;
  log: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * 装依赖、（必要时）构建。
 *
 * 依赖装在**插件目录内**（`<pluginDir>/node_modules`）：落盘后 Node 从插件模块
 * 位置向上查找即可命中，不需要任何额外的解析机制，也不会污染内核自己的依赖。
 */
async function preparePackage(root: string, ctx: PrepareContext): Promise<void> {
  const packageJsonPath = path.join(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    ctx.log('插件未声明 package.json，跳过依赖安装与构建');
    return;
  }

  const packageJson = readPackageJson(packageJsonPath);

  /*
   * 「只含产物」的包（发布到 registry 的官方插件就是这种形态：`files` 只带
   * dist/admin/migrations/manifest.json，源码在独立仓库里）没有 `src/`，
   * 也没有 `tsconfig.json` —— 它们既不需要装依赖也不需要构建。
   *
   * 若不加这一条，`scripts.build` 会让编排去跑一遍 `install && run build`：
   * 先下载一堆用不上的 devDependencies，再因为缺 `src/` 而失败。
   */
  if (!existsSync(path.join(root, 'src')) && !existsSync(path.join(root, 'tsconfig.json'))) {
    ctx.log('该包只包含构建产物（无 src/ 与 tsconfig.json），跳过依赖安装与构建');
    return;
  }

  const scriptNames = Object.keys(packageJson.scripts ?? {});
  const needsBuild = scriptNames.includes('build');
  const dependencyCount =
    Object.keys(packageJson.dependencies ?? {}).length +
    Object.keys(packageJson.optionalDependencies ?? {}).length +
    (needsBuild ? Object.keys(packageJson.devDependencies ?? {}).length : 0);

  if (dependencyCount === 0 && !needsBuild) {
    ctx.log('插件没有依赖也没有构建脚本，跳过 prepare');
    return;
  }

  /*
   * 单调仓库内的插件（依赖里有 `workspace:` 协议）无法独立安装：
   * 它们依赖工作区的软链，`pnpm install` 在仓库外必然失败。
   * 这类来源（本地目录/内网 Git）通常已经构建好产物，直接跳到落盘即可。
   */
  if (hasWorkspaceProtocol(packageJson)) {
    ctx.log('依赖包含 workspace 协议（单调仓库内的插件），跳过依赖安装，直接使用其构建产物');
    if (needsBuild) {
      ctx.log('提示：该插件声明了构建脚本，但跳过依赖安装后无法构建，请在其仓库内先构建');
    }
    return;
  }

  /*
   * 宿主提供的包**必须**是可选 peer，不能是普通依赖。
   *
   * 写成 dependencies 会在插件目录内装出第二份 `@ricenote/shared` / `plugin-sdk`，
   * 与 ADR-014 记录过的"两份 Vue → 页面空白且控制台干净"是同一类事故，
   * 而且极难定位。这里直接拒绝安装并说明怎么改。
   */
  const hostProvided = hostProvidedDependencies(packageJson);
  if (hostProvided.length > 0) {
    throw new Error(
      `插件包把宿主提供的包写成了普通依赖：${hostProvided.join('、')}。` +
        '请改为 peerDependencies + peerDependenciesMeta.optional=true（宿主负责提供这些包），' +
        '并在 devDependencies 中按普通版本区间保留它们以供本地构建。'
    );
  }

  const manager = requirePackageManager(ctx.toolchain);
  const common = {
    cwd: root,
    timeoutMs: ctx.timeoutMs,
    onLog: ctx.log,
    ...(ctx.signal ? { signal: ctx.signal } : {})
  };

  /*
   * 参数必须按包管理器区分：`--no-audit` / `--no-fund` 是 npm 专有，
   * pnpm 会直接报 "Unknown options" 而整个安装失败（实测踩到过）。
   *
   * 生产依赖开关：不需要构建时只装运行期依赖（更小、更快、攻击面更少）；
   * 需要构建时必须带上 devDependencies —— 构建工具通常在那里。
   */
  const installArgs = ['install'];
  if (manager.kind === 'npm') {
    installArgs.push('--no-audit', '--no-fund');
    if (!needsBuild) installArgs.push('--omit=dev');
  } else if (!needsBuild) {
    installArgs.push('--prod');
  }
  if (!ctx.allowScripts) installArgs.push('--ignore-scripts');

  ctx.log(
    `安装依赖（${manager.kind}${ctx.allowScripts ? '，允许执行安装脚本' : '，已禁用安装脚本'}）`
  );
  await runCommand(manager.command, installArgs, common);

  if (needsBuild) {
    ctx.log('执行插件声明的构建脚本（npm run build）');
    await runCommand(manager.command, ['run', 'build'], common);
  }
}

interface PackageJsonShape {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readPackageJson(file: string): PackageJsonShape {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageJsonShape;
  } catch {
    return {};
  }
}

/** 依赖里是否包含 `workspace:` 协议（单调仓库内的插件）。 */
function hasWorkspaceProtocol(packageJson: PackageJsonShape): boolean {
  const groups = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies
  ];
  return groups.some(
    (group) => group !== undefined && Object.values(group).some((range) => range.startsWith('workspace:'))
  );
}

/** 被错误地写成普通依赖的「宿主提供包」。 */
function hostProvidedDependencies(packageJson: PackageJsonShape): string[] {
  const groups = [packageJson.dependencies, packageJson.optionalDependencies];
  return groups.flatMap((group) =>
    group === undefined ? [] : Object.keys(group).filter((name) => isHostProvidedPackage(name))
  );
}

/* -------------------------------- commit 细节 -------------------------------- */

/**
 * 把工作区里的插件目录换名落盘。
 *
 * 顺序：先复制到 `<target>.incoming-*`，再把旧目录改名为 `<target>.backup-*`，
 * 最后把 incoming 改名为正式目录。任何一步失败都会把备份还原回去 ——
 * "升级失败导致插件消失"是安装器最不可接受的故障。
 */
function commitDirectory(
  sourceRoot: string,
  targetDir: string,
  ctx: { cacheDir: string; logger: Logger }
): void {
  const suffix = randomBytes(4).toString('hex');
  const incoming = `${targetDir}.incoming-${suffix}`;
  let backup: string | undefined;

  mkdirSync(path.dirname(targetDir), { recursive: true });
  sweepTransientSiblings(targetDir, ctx.cacheDir, ctx.logger);

  try {
    /*
     * 复制时**排除 `node_modules`**：
     * - 依赖应由 `prepare` 阶段的包管理器安装（结构正确、平台正确）；
     * - 从工作区拷贝过来的 `node_modules` 里往往是软链，换位置后直接失效，
     *   留着只会让运行期报"找不到模块"而看不出原因。
     */
    cpSync(sourceRoot, incoming, {
      recursive: true,
      filter: (src) => path.basename(src) !== 'node_modules'
    });

    if (existsSync(targetDir)) {
      backup = `${targetDir}.backup-${suffix}`;
      renameSync(targetDir, backup);
    }

    renameSync(incoming, targetDir);

    if (backup) discardBackup(backup, ctx.cacheDir, ctx.logger);
  } catch (error) {
    if (existsSync(incoming)) rmSync(incoming, { recursive: true, force: true });
    if (backup && existsSync(backup)) {
      if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
      renameSync(backup, targetDir);
    }
    throw error;
  }
}

/**
 * 删除上一版本的备份。
 *
 * 删不掉时**必须把它弄出插件扫描根目录**（或至少改成一个不会被发现的形态）：
 * 备份里带着完整的 `manifest.json`，留在 `plugins/third-party` 下会让发现机制
 * 看到一个重复 ID 的插件目录，把"清理失败"升级成"插件加载不上"。
 * 发现机制本身也会跳过 `.backup-*`（双保险），这里再做一次搬运。
 */
function discardBackup(backup: string, cacheDir: string, logger: Logger): void {
  try {
    rmSync(backup, { recursive: true, force: true });
    return;
  } catch (error) {
    logger.warn('插件旧版本备份删除失败，尝试移出插件目录', {
      backup,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const stash = path.join(cacheDir, 'plugin-backups', path.basename(backup));
  try {
    mkdirSync(path.dirname(stash), { recursive: true });
    renameSync(backup, stash);
    logger.warn('已把插件旧版本备份移到缓存目录，可稍后手工删除', { stash });
  } catch (error) {
    // 发现机制会跳过该形态的目录，因此这里只告警、不影响安装结果
    logger.warn('插件旧版本备份仍留在插件目录（发现机制会跳过 *.backup-*），建议手工删除', {
      backup,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/** 清理同一插件遗留的瞬时目录（上次安装异常中断留下的）。 */
function sweepTransientSiblings(targetDir: string, cacheDir: string, logger: Logger): void {
  const parent = path.dirname(targetDir);
  const base = path.basename(targetDir);

  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name === base) continue;
    const isTransient =
      /\.incoming-[0-9a-f]+$/.test(name) || /\.backup-[0-9a-f]+$/.test(name);
    if (!isTransient) continue;
    if (!name.startsWith(`${base}.`)) continue;

    const full = path.join(parent, name);
    logger.info('清理上次安装遗留的临时目录', { dir: full });
    if (/\.backup-/.test(name)) discardBackup(full, cacheDir, logger);
    else rmSync(full, { recursive: true, force: true });
  }
}

/** 统计目录体积（落盘前的最后一道限额）。 */
function measureTree(root: string): number {
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    // node_modules 不计入体积：它由包管理器安装，不属于"插件包"本身
    if (entry.name === 'node_modules') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) total += measureTree(full);
    else if (entry.isFile()) total += statSync(full).size;
    if (total > MAX_TREE_BYTES) return total;
  }
  return total;
}

function describeSource(source: InstallSourceInput): string {
  switch (source.type) {
    case 'registry':
      return `npm 包 ${source.spec}`;
    case 'git':
      return `Git ${source.repo}#${source.ref}`;
    case 'directory':
      return `本地目录 ${source.path}`;
    case 'zip':
      return `压缩包 ${source.fileName}`;
  }
}
