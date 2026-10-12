-- friend-links 插件自有表：一条记录 = 一个友情链接。
--
-- 设计要点：
-- 1. 字段刻意保持扁平（名称 / 地址 / 头像 / 描述 / 排序 / 启用），
--    不做友链分类——分类需要额外的表与界面，当前需求里没有。
-- 2. 排序用 sort_order（数值越小越靠前），由后台直接编辑；
--    并按 (site_id, sort_order, id) 建索引，前台取数即可直接排序返回。
-- 3. 不建跨插件外键：本表不引用任何其他插件的数据。
-- 4. avatar_url 可以是完整的 http(s) 地址，也可以是媒体库相对路径
--    （/uploads/... 或 /media/...），由应用层校验，不在此强制约束，
--    以便历史数据与外部图片共存。

CREATE TABLE IF NOT EXISTS rn_friend_links (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     VARCHAR(64)     NOT NULL DEFAULT 'default',
  name        VARCHAR(120)    NOT NULL,
  url         VARCHAR(500)    NOT NULL,
  avatar_url  VARCHAR(500)    NULL,
  description VARCHAR(300)    NULL,
  sort_order  INT             NOT NULL DEFAULT 0,
  enabled     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME        NOT NULL,
  updated_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rn_friend_links_order (site_id, sort_order, id),
  KEY idx_rn_friend_links_enabled (site_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
