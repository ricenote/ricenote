-- pages 插件自有表：独立页面。
--
-- 与文章的区别：页面不参与分类/标签与列表归档，拥有独立地址 /page/:slug，
-- 因此单独建表而非复用 rn_posts（表所有权边界见说明书第 8 章）。
--
-- `template` 保存的是**主题声明的模板键**（theme.json 的 pageTemplates），
-- 不是文件名：这样主题换掉模板文件后旧数据依然可用，键失效时回退到 kind 模板。

CREATE TABLE IF NOT EXISTS rn_pages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id         VARCHAR(64)     NOT NULL DEFAULT 'default',
  title           VARCHAR(255)    NOT NULL,
  slug            VARCHAR(200)    NOT NULL,
  content         MEDIUMTEXT      NOT NULL,
  content_html    MEDIUMTEXT      NOT NULL,
  status          VARCHAR(24)     NOT NULL DEFAULT 'draft',
  template        VARCHAR(120)    NULL,
  sort_order      INT             NOT NULL DEFAULT 0,
  seo_title       VARCHAR(255)    NULL,
  seo_description VARCHAR(500)    NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME        NOT NULL,
  updated_at      DATETIME        NOT NULL,
  published_at    DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rn_pages_slug (site_id, slug),
  KEY idx_rn_pages_status (site_id, status, sort_order),
  KEY idx_rn_pages_updated (site_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
