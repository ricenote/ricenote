-- posts 插件自有表：文章。
-- author_id / cover_media_id 只保存 ID，不加跨插件外键（说明书第 8 章），
-- 作者信息通过 identity.users@1 服务获取，封面通过 media.library@1 服务获取。

CREATE TABLE IF NOT EXISTS rn_posts (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id         VARCHAR(64)     NOT NULL DEFAULT 'default',
  author_id       BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(255)    NOT NULL,
  slug            VARCHAR(191)    NOT NULL,
  excerpt         VARCHAR(500)    NOT NULL DEFAULT '',
  content         MEDIUMTEXT      NOT NULL,
  content_html    MEDIUMTEXT      NOT NULL,
  cover_media_id  BIGINT UNSIGNED NULL,
  status          VARCHAR(16)     NOT NULL DEFAULT 'draft',
  seo_title       VARCHAR(255)    NULL,
  seo_description VARCHAR(500)    NULL,
  published_at    DATETIME        NULL,
  created_at      DATETIME        NOT NULL,
  updated_at      DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_posts_site_slug (site_id, slug),
  KEY idx_rn_posts_status (site_id, status, published_at),
  KEY idx_rn_posts_author (author_id),
  FULLTEXT KEY ft_rn_posts_search (title, excerpt, content)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
