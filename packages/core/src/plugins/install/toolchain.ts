/**
 * 安装期工具链：探测外部命令并统一执行子进程。
 *
 * 为什么需要这一层：
 * - **跨平台**：Windows 上 `pnpm` / `npm` / `git` 实际是 `.cmd` 垫片，
 *   直接 `spawn('pnpm')` 会 ENOENT，必须走 shell（或显式补后缀）；
 * - **可运维**：安装第三方插件要跑包管理器与 git，失败原因必须能原样带回到后台，
 *   而不是变成一个语焉不详的 500；
 * - **可控**：每一步都要超时、要能把输出流式写进任务日志、要能限制日志体积。
 */

import { spawn } from 'node:child_process';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import type { Logger } from '../../logger.js';

export type PackageManagerKind = 'pnpm' | 'npm';

export interface ToolchainInfo {
  /** 探测到的包管理器（优先 pnpm，回退 npm）；都没有时为 undefined。 */
  packageManager?: { kind: PackageManagerKind; command: string };
  /** git 是否可用（仅 Git 来源需要）。 */
  git?: { command: string };
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd: string;
  /** 超时（毫秒）。超时会杀掉子进程并抛错 —— 安装不能无限挂着。 */
  timeoutMs?: number;
  /** 追加/覆盖环境变量（例如 registry token）。 */
  env?: Record<string, string | undefined>;
  /** 逐行回调（写入任务日志）。 */
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

/** Windows 需要 shell 才能解析 `.cmd` 垫片。 */
const USE_SHELL = process.platform === 'win32';

/** 单条命令保留的输出上限（避免把日志写爆）。 */
const MAX_OUTPUT_BYTES = 128 * 1024;

export async function runCommand(
  command: string,
  args: string[],
  options: RunOptions
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: USE_SHELL,
      env: { ...process.env, ...options.env },
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const append = (target: 'out' | 'err', chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      const next = (target === 'out' ? stdout : stderr) + text;
      if (target === 'out') stdout = next.slice(-MAX_OUTPUT_BYTES);
      else stderr = next.slice(-MAX_OUTPUT_BYTES);

      // 行缓冲：只在换行处回调，避免把半行日志切碎
      const buffered = (target === 'out' ? stdoutBuffer : stderrBuffer) + text;
      const lines = buffered.split(/\r?\n/);
      const rest = lines.pop() ?? '';
      if (target === 'out') stdoutBuffer = rest;
      else stderrBuffer = rest;
      for (const line of lines) options.onLog?.(line);
    };

    child.stdout?.on('data', (chunk: Buffer) => append('out', chunk));
    child.stderr?.on('data', (chunk: Buffer) => append('err', chunk));

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new RiceNoteError(
          ErrorCode.PLUGIN_INSTALL_FAILED,
          `执行 ${command} 超时（${Math.round(timeoutMs / 1000)} 秒），已终止。`,
          { status: 500, details: { command, args, timeoutMs } }
        )
      );
    }, timeoutMs);

    const abort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(
        new RiceNoteError(ErrorCode.PLUGIN_INSTALL_FAILED, `安装已被取消（${command}）`, {
          status: 499
        })
      );
    };
    options.signal?.addEventListener('abort', abort, { once: true });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new RiceNoteError(
          ErrorCode.PLUGIN_INSTALL_FAILED,
          `无法执行 ${command}：${error.message}`,
          { status: 500, details: { command } }
        )
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutBuffer) options.onLog?.(stdoutBuffer);
      if (stderrBuffer) options.onLog?.(stderrBuffer);

      const result: RunResult = { code: code ?? -1, stdout, stderr };
      if (result.code !== 0) {
        reject(
          new RiceNoteError(
            ErrorCode.PLUGIN_INSTALL_FAILED,
            `${command} ${args.join(' ')} 失败（退出码 ${result.code}）：${lastLines(stderr || stdout)}`,
            { status: 500, details: { command, args, code: result.code } }
          )
        );
        return;
      }
      resolve(result);
    });
  });
}

/** 取末尾若干行，用于错误摘要（完整输出在任务日志里）。 */
function lastLines(text: string, count = 6): string {
  const lines = text.trim().split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(-count).join(' ⏎ ');
}

/**
 * 探测可用工具链。
 *
 * 探测失败**不抛错**：registry 来源只需要包管理器，git 来源才需要 git。
 * 由调用方在真正需要时给出「缺什么、怎么装」的可操作错误。
 */
export async function detectToolchain(logger?: Logger): Promise<ToolchainInfo> {
  const info: ToolchainInfo = {};

  for (const kind of ['pnpm', 'npm'] as const) {
    if (await isAvailable(kind)) {
      info.packageManager = { kind, command: kind };
      break;
    }
  }

  if (await isAvailable('git')) info.git = { command: 'git' };

  logger?.debug?.('安装工具链探测结果', {
    packageManager: info.packageManager?.kind ?? null,
    git: info.git !== undefined
  });

  return info;
}

async function isAvailable(command: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ['--version'], { shell: USE_SHELL, windowsHide: true });
    const finish = (value: boolean): void => {
      child.removeAllListeners();
      resolve(value);
    };
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, 8000);
  });
}

/** 需要包管理器时的统一报错（给出可操作的安装指引）。 */
export function requirePackageManager(info: ToolchainInfo): { kind: PackageManagerKind; command: string } {
  if (!info.packageManager) {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_INSTALL_FAILED,
      '未找到可用的包管理器（pnpm 或 npm）：安装来自 npm Registry 的插件需要它解析依赖。请先安装 Node.js（自带 npm）。',
      { status: 500 }
    );
  }
  return info.packageManager;
}

/** 需要 git 时的统一报错。 */
export function requireGit(info: ToolchainInfo): { command: string } {
  if (!info.git) {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_INSTALL_FAILED,
      '未找到 git：从 Git 仓库安装插件需要它。请先安装 git（https://git-scm.com/downloads），或改用 npm 包 / 本地目录来源。',
      { status: 500 }
    );
  }
  return info.git;
}
