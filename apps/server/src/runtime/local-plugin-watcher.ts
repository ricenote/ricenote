/**
 * 开发期「本地插件目录」监视：改动即生效（秒级自动重启内核）。
 *
 * 为什么是"重启"而不是模块级热替换：
 * Node 的 ESM 模块缓存按 URL 生效，且 `loadPluginModule()` 不做缓存破坏
 * （加查询串会让静态导入的新旧代码混跑，比"没生效"更难排查，见 ADR-012）。
 * 因此本地目录的快速迭代只能是：**文件变更 → 自动重启内核**。
 *
 * 与 `tsx watch` 的分工：
 * - `tsx watch` 盯着服务端源码与它**已导入**的文件；
 * - 本模块盯着配置登记的外部插件目录（`RICENOTE_LOCAL_PLUGINS`），
 *   那些目录通常在工作区之外，tsx 不会覆盖。
 */

import { existsSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { Logger, RiceNoteConfig } from '@ricenote/core';
import type { ServerSupervisor } from './supervisor.js';

export interface LocalPluginWatcherOptions {
  config: RiceNoteConfig;
  logger: Logger;
  supervisor: ServerSupervisor;
  /** 静默期（毫秒）：编辑器保存会连发多个事件，攒一攒再重启。 */
  debounceMs?: number;
  /** 单次目录树遍历的最大深度。 */
  maxDepth?: number;
}

export interface LocalPluginWatcher {
  /** 实际监视的目录。 */
  readonly dirs: string[];
  close(): void;
}

/** 不需要监视的目录名（依赖、版本库、产物缓存）。 */
const IGNORED_DIRS = new Set(['node_modules', '.git', 'storage', '.cache']);
/** 不需要触发重启的文件后缀（日志与临时文件）。 */
const IGNORED_SUFFIXES = ['.log', '.tmp', '.swp', '.swx', '~'];

export function startLocalPluginWatcher(options: LocalPluginWatcherOptions): LocalPluginWatcher | undefined {
  const { config, logger, supervisor } = options;
  const debounceMs = options.debounceMs ?? 900;
  const maxDepth = options.maxDepth ?? 6;

  const dirs = config.paths.localPluginDirs.filter((dir) => existsSync(dir));
  if (dirs.length === 0) return undefined;

  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  /** 最近一次触发变化的原因（写进重启 reason，便于回溯）。 */
  let lastChange = '';

  const trigger = (): void => {
    if (closed) return;
    /*
     * 重启过程中收到变更：重新计时而不是丢弃 ——
     * 否则"保存了两次、只有第一次生效"会很难理解。
     */
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (closed) return;
      if (supervisor.isRestarting) {
        trigger();
        return;
      }
      logger.warn('本地插件目录发生变化，自动重启内核使其生效', {
        change: lastChange,
        dirs
      });
      void supervisor.restart(`本地插件目录发生变化（${lastChange}）`).catch((error: unknown) => {
        logger.error('自动重启失败（本地插件目录变更）', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, debounceMs);
  };

  const onChange = (root: string, dir: string, filename: string | null): void => {
    const relative = filename ? path.relative(root, path.join(dir, filename)) : '';
    if (relative.length > 0) {
      const lower = relative.toLowerCase();
      if (IGNORED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return;
      if (relative.split(/[\\/]/).some((part) => IGNORED_DIRS.has(part))) return;
      lastChange = relative;
    }
    trigger();
  };

  /** 递归监视目录树（`recursive: true` 在 Linux 上不支持，因此自己遍历）。 */
  const watchTree = (root: string, dir: string, depth: number): void => {
    try {
      const watcher = watch(dir, { persistent: true }, (event, filename) => {
        onChange(root, dir, filename);
        // 新目录出现时补挂监视（插件目录通常一开始就存在，这里只是兜底）
        if (event === 'rename' && filename && depth < maxDepth) {
          const next = path.join(dir, filename);
          if (existsSync(next) && !IGNORED_DIRS.has(filename)) {
            try {
              if (readdirSync(next)) watchTree(root, next, depth + 1);
            } catch {
              /* 不是目录（或刚被删除）：忽略 */
            }
          }
        }
      });
      watcher.on('error', (error) => {
        logger.warn('本地插件目录监视出错（该目录的自动重启已失效）', {
          dir,
          error: error instanceof Error ? error.message : String(error)
        });
      });
      watchers.push(watcher);
    } catch (error) {
      logger.warn('无法监视本地插件目录', {
        dir,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    if (depth >= maxDepth) return;
    for (const entry of safeReaddir(dir)) {
      if (IGNORED_DIRS.has(entry) || entry.startsWith('.')) continue;
      const next = path.join(dir, entry);
      watchTree(root, next, depth + 1);
    }
  };

  for (const dir of dirs) watchTree(dir, dir, 0);

  logger.info('已开启本地插件目录监视（改动即自动重启内核）', { dirs, debounceMs });

  return {
    dirs,
    close(): void {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    }
  };
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
