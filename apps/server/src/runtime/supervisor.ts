/**
 * 进程内软重启编排（ServerSupervisor）。
 *
 * 背景（ADR-004 受控重启）：插件启停、插件设置、备份恢复等变更无法在进程内
 * 热应用，必须重启才能生效。过去这是**人工运维动作**，本模块把它变成
 * 后台一键动作，但语义未变：仍然是"停机 → 重新 bootstrap → 重新监听"，
 * **不是** Fastify 路由热卸载。
 *
 * 为什么放在服务端而不是 Core：
 * 重启涉及 HTTP 服务生命周期与进程信号，属于"进程宿主"的职责；
 * Core 只负责状态簿记与请求受理（`core.runtime@1`），机制由这里注入。
 *
 * 失败语义：重启过程中的任意一步失败都会被记录并保留诊断信息，
 * 绝不静默半死（宁可让运维看到明确的错误，也不要出现"端口没人监听但进程还在"）。
 */

import { bootstrap, type RiceNoteKernel } from '@ricenote/core';
import { isRiceNoteError, ErrorCode } from '@ricenote/shared';
import { startDiagnosticServer, startHttpServer, type RunningServer } from '../server.js';
import { renderDatabaseDownPage } from '../recovery/recovery-mode.js';
import { APP_VERSION } from '../version.js';

/** 重启流程中的阶段，仅用于日志与诊断。 */
type RestartPhase = 'idle' | 'closing-http' | 'shutting-down' | 'bootstrapping' | 'listening';

export interface SupervisorDeps {
  /** 初始内核（已完成一次 bootstrap）。 */
  kernel: RiceNoteKernel;
  /** 初始 HTTP 服务。 */
  server: RunningServer;
  /** 内核关停后的收尾回调（例如清理定时器）。 */
  onShutdown?: () => void;
}

export class ServerSupervisor {
  private kernel: RiceNoteKernel;
  private server: RunningServer;
  private phase: RestartPhase = 'idle';
  private restarting = false;

  constructor(private readonly deps: SupervisorDeps) {
    this.kernel = deps.kernel;
    this.server = deps.server;
  }

  get currentKernel(): RiceNoteKernel {
    return this.kernel;
  }

  get currentServer(): RunningServer {
    return this.server;
  }

  get isRestarting(): boolean {
    return this.restarting;
  }

  /**
   * 执行一次软重启。
   *
   * 顺序不可颠倒：
   * 1. 关闭 HTTP（等待 in-flight 请求结束，保证 202 响应已写回客户端）；
   * 2. 关停内核（插件 stopAll → 释放数据库连接池）；
   * 3. 重新 bootstrap（重新跑迁移、重新启动插件）；
   * 4. 重新监听同一端口。
   *
   * 第 3 步失败时进入"诊断服务"模式而不是直接退出：这样管理员仍能打开
   * 页面看到失败原因（例如数据库连不上），与首次启动的行为保持一致。
   */
  async restart(reason: string): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;

    const log = this.kernel.logger;
    try {
      this.phase = 'closing-http';
      log.warn('软重启：正在关闭 HTTP 服务', { reason });
      await this.server.close().catch((error: unknown) => {
        log.warn('关闭 HTTP 服务时出错（继续重启）', { error: describe(error) });
      });

      this.phase = 'shutting-down';
      log.warn('软重启：正在关停内核');
      await this.kernel.shutdown().catch((error: unknown) => {
        log.warn('关停内核时出错（继续重启）', { error: describe(error) });
      });
      this.deps.onShutdown?.();

      this.phase = 'bootstrapping';
      log.warn('软重启：正在重新装配内核');
      const nextKernel = await bootstrap({ rootDir: this.kernel.config.paths.rootDir });

      // 把重启执行器重新注入新内核：否则"重启一次之后按钮就失效了"
      this.wire(nextKernel);

      this.phase = 'listening';
      const nextServer = await startHttpServer(nextKernel, {
        trustProxy: nextKernel.config.env === 'production'
      });

      this.kernel = nextKernel;
      this.server = nextServer;

      nextKernel.logger.info('软重启完成', {
        reason,
        url: `http://${nextKernel.config.http.host}:${nextKernel.config.http.port}`
      });
    } catch (error) {
      log.error('软重启失败', { reason, error: describe(error), stack: describeStack(error) });
      await this.fallbackToDiagnosticServer(reason, error).catch(() => undefined);
      throw error;
    } finally {
      this.phase = 'idle';
      this.restarting = false;
    }
  }

  /** 把重启执行器注入内核（首次启动与每次重启后都要调用）。 */
  wire(kernel: RiceNoteKernel): void {
    kernel.runtime.registerRestartHandler(async ({ reason }) => {
      await this.restart(reason);
    });
  }

  /** 当前阶段（诊断用）。 */
  get currentPhase(): RestartPhase {
    return this.phase;
  }

  /** 重启失败时兜底：起一个只提供诊断页的服务，保证管理员能看到原因。 */
  private async fallbackToDiagnosticServer(reason: string, error: unknown): Promise<void> {
    const config = this.kernel.config;
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : '未知错误';

    await startDiagnosticServer({
      host: config.http.host,
      port: config.http.port,
      html: () =>
        renderDatabaseDownPage({
          siteTitle: config.site.title,
          version: APP_VERSION,
          error: `重启失败：${message}（触发原因：${reason}）`,
          host: config.database.host,
          port: config.database.port,
          database: config.database.name
        })
    });
  }
}

function describe(error: unknown): string {
  if (isRiceNoteError(error)) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function describeStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/** 供进程入口判断"是否数据库不可用"（用于首次启动的诊断模式）。 */
export function isDatabaseUnavailable(error: unknown): boolean {
  return isRiceNoteError(error) && error.code === ErrorCode.DB_UNAVAILABLE;
}
