/**
 * 操作审计。
 *
 * 所有管理写操作都应经此记录，且**不可被插件绕过**（插件通过
 * `ctx.routes.adminApi()` 注册的路由由 Core 在处理链中自动审计）。
 */

import type { AuditLogEntry } from '@ricenote/shared';
import type { DatabaseAdapter } from '../database/adapter.js';
import type { Logger } from '../logger.js';

export interface AuditInput {
  action: string;
  actorId?: number;
  actorName?: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  requestId?: string;
  detail?: Record<string, unknown>;
}

export interface AuditQuery {
  action?: string;
  actorId?: number;
  page?: number;
  pageSize?: number;
}

export class AuditLogger {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly siteId: string,
    private readonly logger: Logger
  ) {}

  /** 写入一条审计记录；失败只记录日志，不阻断业务操作。 */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO rn_audit_logs
           (site_id, actor_id, actor_name, action, target_type, target_id, ip, request_id, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NOW())`,
        [
          this.siteId,
          input.actorId ?? null,
          input.actorName ?? null,
          input.action,
          input.targetType ?? null,
          input.targetId ?? null,
          input.ip ?? null,
          input.requestId ?? null,
          input.detail ? JSON.stringify(input.detail) : null
        ]
      );
    } catch (error) {
      this.logger.error('审计日志写入失败', {
        action: input.action,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /** 查询审计日志（后台「系统 → 日志」）。 */
  async list(query: AuditQuery = {}): Promise<{ items: AuditLogEntry[]; total: number }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(query.pageSize ?? 20, 100));
    const conditions: string[] = ['site_id = ?'];
    const params: unknown[] = [this.siteId];

    if (query.action) {
      conditions.push('action = ?');
      params.push(query.action);
    }
    if (query.actorId !== undefined) {
      conditions.push('actor_id = ?');
      params.push(query.actorId);
    }

    const where = conditions.join(' AND ');
    const totalRows = await this.db.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM rn_audit_logs WHERE ${where}`,
      params
    );

    const rows = await this.db.query<{
      id: number;
      actor_id: number | null;
      actor_name: string | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      ip: string | null;
      request_id: string | null;
      detail_json: string | Record<string, unknown> | null;
      created_at: Date | string;
    }>(
      `SELECT id, actor_id, actor_name, action, target_type, target_id, ip, request_id, detail_json, created_at
         FROM rn_audit_logs
        WHERE ${where}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );

    return {
      total: Number(totalRows[0]?.total ?? 0),
      items: rows.map((row) => ({
        id: row.id,
        ...(row.actor_id !== null ? { actorId: row.actor_id } : {}),
        ...(row.actor_name ? { actorName: row.actor_name } : {}),
        action: row.action,
        ...(row.target_type ? { targetType: row.target_type } : {}),
        ...(row.target_id ? { targetId: row.target_id } : {}),
        ...(row.ip ? { ip: row.ip } : {}),
        ...(row.request_id ? { requestId: row.request_id } : {}),
        ...(row.detail_json ? { detail: parseDetail(row.detail_json) } : {}),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
      }))
    };
  }

  /** 清理过期审计日志。 */
  async prune(olderThanDays: number): Promise<number> {
    const result = await this.db.execute(
      'DELETE FROM rn_audit_logs WHERE site_id = ? AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [this.siteId, Math.max(1, olderThanDays)]
    );
    return result.affectedRows;
  }
}

function parseDetail(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value;
}
