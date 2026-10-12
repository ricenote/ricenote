-- media 插件自有表：媒体元数据。
-- 磁盘文件位于受管目录 storage/uploads 之下，数据库中保存相对路径而非绝对路径，
-- 便于迁移部署目录而无需改数据。

CREATE TABLE IF NOT EXISTS rn_media (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     VARCHAR(64)     NOT NULL DEFAULT 'default',
  file_name   VARCHAR(255)    NOT NULL,
  stored_path VARCHAR(500)    NOT NULL,
  mime_type   VARCHAR(128)    NOT NULL,
  size        BIGINT UNSIGNED NOT NULL,
  width       INT UNSIGNED    NULL,
  height      INT UNSIGNED    NULL,
  alt         VARCHAR(255)    NULL,
  uploader_id BIGINT UNSIGNED NULL,
  created_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rn_media_site_created (site_id, created_at),
  KEY idx_rn_media_mime (mime_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
