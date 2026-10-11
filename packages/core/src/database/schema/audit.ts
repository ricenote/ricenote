/** 管理操作审计日志表。 */

import { bigint, datetime, index, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

export const rnAuditLogs = mysqlTable(
  'rn_audit_logs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    siteId: varchar('site_id', { length: 64 }).notNull(),
    actorId: bigint('actor_id', { mode: 'number', unsigned: true }),
    actorName: varchar('actor_name', { length: 120 }),
    action: varchar('action', { length: 120 }).notNull(),
    targetType: varchar('target_type', { length: 64 }),
    targetId: varchar('target_id', { length: 120 }),
    ip: varchar('ip', { length: 64 }),
    requestId: varchar('request_id', { length: 64 }),
    detailJson: json('detail_json'),
    createdAt: datetime('created_at', { mode: 'date' }).notNull()
  },
  (table) => [index('idx_audit_action_created').on(table.action, table.createdAt)]
);
