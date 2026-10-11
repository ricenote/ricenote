/**
 * Core 自有的 DDL 迁移（有序、幂等、带校验值）。
 *
 * 迁移内容一经发布不可修改——修改会导致 checksum 不一致并被协调器拒绝。
 * 需要变更结构时新增一条迁移，而不是编辑历史迁移。
 */

export interface CoreMigration {
  name: string;
  sql: string;
}

export const CORE_MIGRATIONS: CoreMigration[] = [
  {
    name: '0001_core_plugin_meta',
    sql: `
CREATE TABLE IF NOT EXISTS rn_plugins (
  id            VARCHAR(120)  NOT NULL,
  name          VARCHAR(160)  NOT NULL,
  version       VARCHAR(32)   NOT NULL,
  api_version   VARCHAR(32)   NOT NULL,
  state         VARCHAR(24)   NOT NULL,
  enabled       TINYINT(1)    NOT NULL DEFAULT 0,
  builtin       TINYINT(1)    NOT NULL DEFAULT 0,
  path          VARCHAR(500)  NOT NULL,
  manifest_json JSON          NOT NULL,
  last_error    VARCHAR(1000) NULL,
  installed_at  DATETIME      NOT NULL,
  updated_at    DATETIME      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rn_plugins_enabled (enabled),
  KEY idx_rn_plugins_state (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rn_plugin_migrations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope       VARCHAR(160)    NOT NULL,
  migration   VARCHAR(255)    NOT NULL,
  checksum    VARCHAR(64)     NOT NULL,
  applied_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_plugin_migrations (scope, migration)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rn_plugin_settings (
  plugin_id     VARCHAR(120) NOT NULL,
  site_id       VARCHAR(64)  NOT NULL,
  settings_json JSON         NOT NULL,
  revision      INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at    DATETIME     NOT NULL,
  PRIMARY KEY (plugin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  },
  {
    name: '0002_theme_state',
    sql: `
CREATE TABLE IF NOT EXISTS rn_themes (
  id            VARCHAR(120)  NOT NULL,
  name          VARCHAR(160)  NOT NULL,
  version       VARCHAR(32)   NOT NULL,
  api_version   VARCHAR(32)   NOT NULL,
  path          VARCHAR(500)  NOT NULL,
  manifest_json JSON          NOT NULL,
  installed_at  DATETIME      NOT NULL,
  updated_at    DATETIME      NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rn_site_state (
  site_id         VARCHAR(64)  NOT NULL,
  active_theme_id VARCHAR(120) NULL,
  runtime_status  VARCHAR(32)  NOT NULL,
  app_version     VARCHAR(32)  NOT NULL,
  started_at      DATETIME     NULL,
  updated_at      DATETIME     NOT NULL,
  PRIMARY KEY (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rn_theme_settings (
  site_id       VARCHAR(64)  NOT NULL,
  theme_id      VARCHAR(120) NOT NULL,
  settings_json JSON         NOT NULL,
  revision      INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME     NOT NULL,
  PRIMARY KEY (site_id, theme_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rn_theme_setting_revisions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       VARCHAR(64)  NOT NULL,
  theme_id      VARCHAR(120) NOT NULL,
  revision      INT UNSIGNED NOT NULL,
  settings_json JSON         NOT NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rn_theme_revisions (site_id, theme_id, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  },
  {
    name: '0003_audit',
    sql: `
CREATE TABLE IF NOT EXISTS rn_audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     VARCHAR(64)   NOT NULL,
  actor_id    BIGINT UNSIGNED NULL,
  actor_name  VARCHAR(120)  NULL,
  action      VARCHAR(120)  NOT NULL,
  target_type VARCHAR(64)   NULL,
  target_id   VARCHAR(120)  NULL,
  ip          VARCHAR(64)   NULL,
  request_id  VARCHAR(64)   NULL,
  detail_json JSON          NULL,
  created_at  DATETIME      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rn_audit_action_created (action, created_at),
  KEY idx_rn_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  },
  {
    /*
     * 站点信息覆盖层 + 待重启标记。
     *
     * `rn_site_settings` 只存"被后台显式修改过"的字段（稀疏覆盖），
     * 因此 .env 始终是默认值与兜底来源，清空某个键即回落到 .env。
     */
    name: '0004_site_settings_and_restart',
    sql: `
CREATE TABLE IF NOT EXISTS rn_site_settings (
  site_id       VARCHAR(64)  NOT NULL,
  settings_json JSON         NOT NULL,
  revision      INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME     NOT NULL,
  PRIMARY KEY (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE rn_site_state
  ADD COLUMN restart_required TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN restart_reason VARCHAR(500) NULL,
  ADD COLUMN restart_requested_at DATETIME NULL;
`
  },
  {
    /*
     * 插件来源元数据 + 后台任务表。
     *
     * 来源从"只有 ZIP 上传"扩展为 registry / git / local 三路（ADR-015），
     * 因此需要记录"装的哪个来源、哪个引用、解析到什么版本"：
     * 扩展中心据此展示，更新检查据此判断，卸载/回滚也据此定位。
     *
     * 回填口径：v0.4.0 之前只有「官方目录（随仓库分发）」与「ZIP 上传」两种投放方式，
     * 二者都没有版本解析与更新检查能力，统一记为 `local`；
     * `installed_via` 保持 NULL —— 当时无法区分是上传安装还是手工拷贝目录，
     * 与其猜一个值，不如留空并在界面标注"历史记录"。
     */
    name: '0005_plugin_source_and_jobs',
    sql: `
ALTER TABLE rn_plugins
  ADD COLUMN source_type      VARCHAR(16)  NULL,
  ADD COLUMN source_spec      VARCHAR(500) NULL,
  ADD COLUMN source_ref       VARCHAR(200) NULL,
  ADD COLUMN resolved_version VARCHAR(64)  NULL,
  ADD COLUMN integrity        VARCHAR(200) NULL,
  ADD COLUMN installed_via    VARCHAR(16)  NULL;

UPDATE rn_plugins SET source_type = 'local' WHERE source_type IS NULL;

CREATE TABLE IF NOT EXISTS rn_plugin_jobs (
  id           VARCHAR(40)   NOT NULL,
  plugin_id    VARCHAR(120)  NULL,
  action       VARCHAR(16)   NOT NULL,
  source_json  JSON          NOT NULL,
  status       VARCHAR(16)   NOT NULL,
  step         VARCHAR(16)   NULL,
  progress     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  log_text     MEDIUMTEXT    NULL,
  error        VARCHAR(1000) NULL,
  actor_id     BIGINT UNSIGNED NULL,
  started_at   DATETIME      NOT NULL,
  finished_at  DATETIME      NULL,
  PRIMARY KEY (id),
  KEY idx_rn_plugin_jobs_created (started_at),
  KEY idx_rn_plugin_jobs_plugin (plugin_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  }
];
