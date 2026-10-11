/**
 * 运行时状态：待生效（需重启）标记与重启请求。
 *
 * 与 ADR-004「受控重启生效」的关系：
 * 插件启停、插件设置、备份恢复等变更无法在进程内热应用，必须重启才生效。
 * 本模块把"重启"从**人工运维动作**变成**后台一键动作**，但不改变语义：
 * 仍然是"停机 → 重新 bootstrap → 重新监听"，而不是 Fastify 路由热卸载。
 *
 * 职责分工（关键）：
 * - Core（本模块）只做**状态簿记 + 请求受理 + 审计友好性**，不知道 HTTP 的存在；
 * - 真正的重启机制由服务端进程入口通过 `registerRestartHandler` 注入。
 *
 * 状态落库到 `rn_site_state`，因此"待重启"提示在进程重启后依然可见
 * （bootstrap 成功后由入口调用 `clearRestartRequired` 清除）。
 */

import { ErrorCode, RiceNoteError, type CoreRuntimeService } from '@ricenote/shared';
import type { RiceNoteConfig } from '../config/loader.js';
import type { Logger } from '../logger.js';
import type { DatabaseAdapter } from '../database/adapter.js';

export interface RestartState {
  restartRequired: boolean;
  reason?: string;
  /** ISO 8601 字符串。 */
  requestedAt?: string;
  restarting: boolean;
}

export interface RestartCoordinatorDeps {
  config: RiceNoteConfig;
  logger: Logger;
  db: DatabaseAdapter;
  /**
   * 重启执行的宽限期（毫秒）。
   *
   * 必须大于 0：请求处理函数需要先把 202 响应写回客户端，
   * 之后才能关停 HTTP 服务，否则浏览器只会看到连接被重置。
   */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 300;

export class RestartCoordinator implements CoreRuntimeService {
  private handler: ((input: { reason: string }) => Promise<void> | void) | undefined;
  private restarting = false;
  private restartRequired = false;
  private reason: string | undefined;
  private requestedAt: Date | undefined;

  constructor(private readonly deps: RestartCoordinatorDeps) {}

  /** 从数据库载入待生效标记（bootstrap 阶段调用）。 */
  async load(): Promise<void> {
    const rows = await this.deps.db.query<{
      restart_required: number;
      restart_reason: string | null;
      restart_requested_at: Date | null;
    }>(
      'SELECT restart_required, restart_reason, restart_requested_at FROM rn_site_state WHERE site_id = ? LIMIT 1',
      [this.deps.config.site.id]
    );
    const row = rows[0];
    this.restartRequired = Number(row?.restart_required ?? 0) === 1;
    this.reason = row?.restart_reason ?? undefined;
    this.requestedAt = row?.restart_requested_at ? new Date(row.restart_requested_at) : undefined;
  }

  registerRestartHandler(handler: (input: { reason: string }) => Promise<void> | void): void {
    this.handler = handler;
  }

  /** 是否有可用的重启执行器（由进程入口注入）。 */
  hasHandler(): boolean {
    return this.handler !== undefined;
  }

  async markRestartRequired(input: { reason: string; actorId?: number }): Promise<void> {
    if (this.restarting) return;

    const now = new Date();
    await this.deps.db.execute(
      `INSERT INTO rn_site_state (site_id, runtime_status, app_version, restart_required, restart_reason, restart_requested_at, updated_at)
       VALUES (?, 'running', '0.0.0', 1, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         restart_required = 1,
         restart_reason = VALUES(restart_reason),
         restart_requested_at = NOW(),
         updated_at = NOW()`,
      [this.deps.config.site.id, input.reason.slice(0, 500)]
    );

    this.restartRequired = true;
    this.reason = input.reason;
    this.requestedAt = now;
    this.deps.logger.info('已标记待生效变更，需重启后生效', {
      reason: input.reason,
      ...(input.actorId ? { actorId: input.actorId } : {})
    });
  }

  async requestRestart(input: { reason: string; actorId?: number }): Promise<{ accepted: boolean }> {
    if (!this.handler) {
      throw new RiceNoteError(
        ErrorCode.RESTART_UNAVAILABLE,
        '当前进程未注册重启执行器，请手动重启服务',
        { status: 503 }
      );
    }
    if (this.restarting) {
      throw new RiceNoteError(ErrorCode.RESTART_IN_PROGRESS, '服务正在重启，请稍候', { status: 409 });
    }

    await this.markRestartRequired(input);

    this.restarting = true;
    this.deps.logger.warn('收到重启请求，即将重启进程', {
      reason: input.reason,
      graceMs: this.deps.graceMs ?? DEFAULT_GRACE_MS
    });

    const handler = this.handler;
    // 延迟触发：让当前请求的响应先写回客户端，再开始关停
    setTimeout(() => {
      void (async () => {
        try {
          await handler({ reason: input.reason });
        } catch (error) {
          // 重启失败必须留下可诊断输出，而不是静默半死
          this.deps.logger.error('重启执行失败', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
        } finally {
          // 若执行器返回后进程仍在（例如执行失败），恢复为可服务状态
          this.restarting = false;
        }
      })();
    }, this.deps.graceMs ?? DEFAULT_GRACE_MS).unref?.();

    return { accepted: true };
  }

  async clearRestartRequired(): Promise<void> {
    this.restartRequired = false;
    this.reason = undefined;
    this.requestedAt = undefined;
    await this.deps.db
      .execute(
        `UPDATE rn_site_state
            SET restart_required = 0, restart_reason = NULL, restart_requested_at = NULL, updated_at = NOW()
          WHERE site_id = ?`,
        [this.deps.config.site.id]
      )
      .catch((error: unknown) => {
        this.deps.logger.warn('清除待重启标记失败', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  state(): RestartState {
    return {
      restartRequired: this.restartRequired,
      ...(this.reason ? { reason: this.reason } : {}),
      ...(this.requestedAt ? { requestedAt: this.requestedAt.toISOString() } : {}),
      restarting: this.restarting
    };
  }
}
