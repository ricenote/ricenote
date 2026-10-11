/**
 * 内核系统能力：运行日志读取与备份恢复。
 *
 * 这些能力不承载业务语义，属于"站点运维"范畴，因此由 Core 直接提供，
 * 但同样通过 HTTP 层的管理守卫（认证 → CSRF → 权限 → 审计）暴露。
 */

export { LogsReader, type LogsReaderOptions, type LogsQueryResult } from './logs-reader.js';
export {
  BackupService,
  RESTORE_ZIP_GUARD,
  type BackupServiceDeps
} from './backup.js';
