-- identity 插件自有表：用户与登录会话。
-- 表名遵循 rn_ 前缀 + 插件短名命名约束。

CREATE TABLE IF NOT EXISTS rn_identity_users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username       VARCHAR(64)     NOT NULL,
  display_name   VARCHAR(120)    NOT NULL,
  email          VARCHAR(190)    NOT NULL,
  password_hash  VARCHAR(255)    NOT NULL,
  status         VARCHAR(16)     NOT NULL DEFAULT 'active',
  created_at     DATETIME        NOT NULL,
  updated_at     DATETIME        NOT NULL,
  last_login_at  DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_identity_users_username (username),
  UNIQUE KEY uk_rn_identity_users_email (email),
  KEY idx_rn_identity_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rn_identity_sessions (
  session_id  VARCHAR(96)      NOT NULL,
  user_id     BIGINT UNSIGNED  NOT NULL,
  ip          VARCHAR(64)      NULL,
  user_agent  VARCHAR(255)     NULL,
  created_at  DATETIME         NOT NULL,
  expires_at  DATETIME         NOT NULL,
  revoked_at  DATETIME         NULL,
  PRIMARY KEY (session_id),
  KEY idx_rn_identity_sessions_user (user_id),
  KEY idx_rn_identity_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
