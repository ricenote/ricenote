/**
 * 进程入口。
 *
 * 行为：
 * - 正常启动内核并挂载 HTTP 服务；
 * - 数据库不可用时不崩溃，而是启动"诊断服务"，让管理员能看到原因与修复步骤；
 * - 把重启执行器注入内核，从而支持后台"一键重启"（进程内软重启，ADR-004 / ADR-012）；
 * - 收到 SIGINT/SIGTERM 时优雅关停（停止插件、释放连接池）。
 */

import { bootstrap, loadConfig, resolveRootDir } from '@ricenote/core';
import { ErrorCode, isRiceNoteError } from '@ricenote/shared';
import { renderDatabaseDownPage } from './recovery/recovery-mode.js';
import { startDiagnosticServer, startHttpServer } from './server.js';
import { ServerSupervisor } from './runtime/supervisor.js';
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

    kernel.logger.info('HTTP 服务已就绪', {
      url: `http://${kernel.config.http.host}:${kernel.config.http.port}`,
      siteUrl: kernel.config.http.siteUrl,
      restart: 'available via POST /api/admin/system/restart'
    });

    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      kernel.logger.info('收到关停信号', { signal });
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
    if (isRiceNoteError(error) && error.code === ErrorCode.DB_UNAVAILABLE) {
      const reason = error.message;
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
        `[ricenote] 数据库不可用，已启动诊断服务：${config.http.siteUrl}\n${reason}\n`
      );
      return;
    }

    process.stderr.write(
      `[ricenote] 启动失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exit(1);
  }
}

void main();
