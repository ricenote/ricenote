/**
 * 进程入口。
 *
 * 行为：
 * - 正常启动内核并挂载 HTTP 服务；
 * - 数据库不可用时不崩溃，而是启动"诊断服务"，让管理员能看到原因与修复步骤；
 * - **未初始化时给引导**：「还没有 .env」与「库结构还没建」不是故障而是"还没装"，
 *   因此直接输出下一步命令（`pnpm run setup`），不让用户从数据库错误栈里反推；
 * - 把重启执行器注入内核，从而支持后台"一键重启"（进程内软重启，ADR-004 / ADR-012）；
 * - 收到 SIGINT/SIGTERM 时优雅关停（停止插件、释放连接池）。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { bootstrap, loadConfig, resolveRootDir } from '@ricenote/core';
import { ErrorCode, isRiceNoteError } from '@ricenote/shared';
import { renderDatabaseDownPage } from './recovery/recovery-mode.js';
import { startDiagnosticServer, startHttpServer } from './server.js';
import { ServerSupervisor } from './runtime/supervisor.js';
import { startLocalPluginWatcher } from './runtime/local-plugin-watcher.js';
import { APP_VERSION } from './version.js';

async function main(): Promise<void> {
  // 向上查找项目根目录：pnpm 以包目录为 cwd 运行脚本时也能正确定位
  // .env / plugins / themes / storage
  const rootDir = resolveRootDir();
  const config = loadConfig({ rootDir });

  try {
    const kernel = await bootstrap({ rootDir });
    const server = await startHttpServer(kernel, {
      trustProxy: kernel.config.env === 'production'
    });

    const supervisor = new ServerSupervisor({ kernel, server });
    // 注入重启机制：Core 只受理请求，真正关停/重建由 supervisor 完成
    supervisor.wire(kernel);

    /*
     * 开发期监视"本地插件目录"（`RICENOTE_LOCAL_PLUGINS`）：
     * 改动即自动重启内核。只在开发环境开启 —— 生产环境改文件应当由
     * 部署流程负责，而不是进程自己去猜。
     */
    const watchLocalPlugins =
      kernel.config.env === 'development' && kernel.config.pluginInstall.watchLocalDirs
        ? startLocalPluginWatcher({
            config: kernel.config,
            logger: kernel.logger,
            supervisor
          })
        : undefined;

    kernel.logger.info('HTTP 服务已就绪', {
      url: `http://${kernel.config.http.host}:${kernel.config.http.port}`,
      siteUrl: kernel.config.http.siteUrl,
      restart: 'available via POST /api/admin/system/restart',
      ...(watchLocalPlugins ? { watchingLocalPlugins: watchLocalPlugins.dirs } : {})
    });

    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      kernel.logger.info('收到关停信号', { signal });
      watchLocalPlugins?.close();
      const current = supervisor.currentKernel;
      await supervisor.currentServer.close().catch(() => undefined);
      await current.shutdown().catch(() => undefined);
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('unhandledRejection', (reason) => {
      supervisor.currentKernel.logger.error('未处理的 Promise 拒绝', {
        error: reason instanceof Error ? reason.message : String(reason)
      });
    });
    process.on('uncaughtException', (error) => {
      supervisor.currentKernel.logger.error('未捕获异常', { error: error.message, stack: error.stack });
    });
  } catch (error) {
    /*
     * 未初始化引导：全新部署最容易撞的两件事是「还没有 .env」与「库结构还没建」。
     * 这两类都不是故障，而是"还没装"，因此直接给出下一步命令，
     * 而不是让用户从数据库错误栈里反推。
     */
    const hints = initializationHints(rootDir, error);
    if (hints.length > 0) {
      process.stderr.write(
        `[ricenote] 尚未完成初始化：\n${hints.map((hint) => `  · ${hint}`).join('\n')}\n`
      );
    }

    if (isRiceNoteError(error) && error.code === ErrorCode.DB_UNAVAILABLE) {
      const reason = error.message;

      /*
       * 先写原因、再起诊断服务。
       *
       * 诊断服务本身也可能起不来（端口被占用、依赖缺失等），而那正是最需要看到根因的时刻：
       * 曾有版本因为诊断服务抛错，把"数据库不可用"这条信息一起埋掉，用户只看到一坨 TypeError。
       */
      process.stderr.write(`[ricenote] 数据库不可用：${reason}\n`);

      try {
        await startDiagnosticServer({
          host: config.http.host,
          port: config.http.port,
          html: () =>
            renderDatabaseDownPage({
              siteTitle: config.site.title,
              version: APP_VERSION,
              error: reason,
              host: config.database.host,
              port: config.database.port,
              database: config.database.name
            })
        });
        process.stderr.write(
          `[ricenote] 已启动诊断服务：${config.http.siteUrl}（打开它可看到原因与修复步骤）\n`
        );
      } catch (diagnosticError) {
        process.stderr.write(
          `[ricenote] 诊断服务启动失败：${
            diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
          }\n  · 常见原因：端口被占用（改 .env 里的 PORT），或数据库已恢复但需要重启\n`
        );
      }
      return;
    }

    process.stderr.write(
      `[ricenote] 启动失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exit(1);
  }
}

void main();

/**
 * 把"尚未初始化"与"真的出故障"区分开，并给出下一步命令。
 *
 * 判据刻意用**可观察事实**（.env 是否存在、错误里是否提到表不存在），
 * 而不是新加一个状态标记 —— 状态标记会在"装到一半"时撒谎。
 */
function initializationHints(rootDir: string, error: unknown): string[] {
  const hints: string[] = [];

  if (!existsSync(path.join(rootDir, '.env'))) {
    hints.push('未找到 .env —— 请先执行：pnpm run setup（不要写裸 pnpm setup，那是 pnpm 自己的命令）');
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/doesn't exist|ER_NO_SUCH_TABLE|Unknown table|Unknown database/i.test(message)) {
    hints.push('数据库结构尚未初始化 —— 请执行：pnpm run setup（或只补结构：pnpm migrate）');
  }

  return hints;
}
