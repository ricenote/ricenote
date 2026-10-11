-- comments 插件自有表：评论与审核状态。
--
-- post_id / user_id / parent_id 只保存 ID，不加跨插件外键（说明书第 8 章）：
-- 文章信息通过 content.posts@1 获取，用户信息通过 identity.users@1 获取。
--
-- ip_hash 存的是加盐哈希而非明文 IP：反垃圾只需要"可比较"，不需要"可还原"。

CREATE TABLE IF NOT EXISTS rn_comments (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id      VARCHAR(64)     NOT NULL DEFAULT 'default',
  post_id      BIGINT UNSIGNED NOT NULL,
  parent_id    BIGINT UNSIGNED NULL,
  user_id      BIGINT UNSIGNED NULL,
  author_name  VARCHAR(80)     NOT NULL,
  author_email VARCHAR(160)    NOT NULL,
  author_url   VARCHAR(300)    NULL,
  content      TEXT            NOT NULL,
  status       VARCHAR(16)     NOT NULL DEFAULT 'pending',
  ip_hash      CHAR(64)        NULL,
  user_agent   VARCHAR(300)    NULL,
  created_at   DATETIME        NOT NULL,
  updated_at   DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rn_comments_post (site_id, post_id, status, created_at),
  KEY idx_rn_comments_status (site_id, status, created_at),
  KEY idx_rn_comments_parent (parent_id),
  KEY idx_rn_comments_email (site_id, author_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
