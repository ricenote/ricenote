-- authorization 插件自有表：角色、角色权限与用户角色关联。
-- 角色记录在此创建；角色所包含的权限点由插件启动时按代码目录（permissions.ts）同步，
-- 以避免 SQL 与代码两处维护同一份权限清单而产生漂移。

CREATE TABLE IF NOT EXISTS rn_authz_roles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(64)     NOT NULL,
  description VARCHAR(255)    NULL,
  builtin     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_authz_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rn_authz_role_permissions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id    BIGINT UNSIGNED NOT NULL,
  permission VARCHAR(96)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_authz_role_permission (role_id, permission),
  KEY idx_rn_authz_role_permissions_permission (permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rn_authz_user_roles (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  role_id    BIGINT UNSIGNED NOT NULL,
  created_at DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_authz_user_role (user_id, role_id),
  KEY idx_rn_authz_user_roles_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO rn_authz_roles (name, description, builtin, created_at) VALUES
  ('administrator', '站点管理员，拥有全部权限', 1, NOW()),
  ('editor',        '编辑：可管理全部内容并发布', 1, NOW()),
  ('author',        '作者：可撰写并发布自己的文章', 1, NOW()),
  ('contributor',   '投稿者：可撰写草稿，等待他人发布', 1, NOW());
