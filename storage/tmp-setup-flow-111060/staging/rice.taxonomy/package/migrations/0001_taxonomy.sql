-- taxonomy 插件自有表：词条与文章关联。
-- 注意：rn_term_relations 只保存 ID 关联，不对外键约束到 rn_posts
-- （跨插件表不做外键，见说明书第 8 章），一致性由 posts 插件通过服务调用维护。

CREATE TABLE IF NOT EXISTS rn_terms (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     VARCHAR(64)     NOT NULL DEFAULT 'default',
  type        VARCHAR(16)     NOT NULL,
  name        VARCHAR(120)    NOT NULL,
  slug        VARCHAR(160)    NOT NULL,
  description VARCHAR(500)    NULL,
  created_at  DATETIME        NOT NULL,
  updated_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_terms_site_type_slug (site_id, type, slug),
  KEY idx_rn_terms_type (site_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rn_term_relations (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  term_id    BIGINT UNSIGNED NOT NULL,
  post_id    BIGINT UNSIGNED NOT NULL,
  created_at DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_term_relations (term_id, post_id),
  KEY idx_rn_term_relations_post (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
