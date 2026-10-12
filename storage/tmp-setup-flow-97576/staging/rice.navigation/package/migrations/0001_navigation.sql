-- navigation 插件自有表：顶部导航项。
--
-- 设计要点：
-- 1. 三种来源（custom / page / post）共用一张表：
--    - custom 用 href 存地址；
--    - page / post 用 ref_id 引用内容 ID，**不冗余保存标题与地址**，
--      这样页面改名、改别名后导航会自动跟随（前台不显示死链，后台给出警告）。
-- 2. 排序用 sort_order（越小越靠前，间隔 10），重排时整体重编号，避免并列。
-- 3. 不建跨插件外键：ref_id 只是"引用"，目标插件可被禁用或内容可被删除，
--    因此解析失败必须是一等公民（前台跳过、后台提示），而不是数据库报错。
--    （表所有权边界见说明书第 8 章。）

CREATE TABLE IF NOT EXISTS rn_nav_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     VARCHAR(64)     NOT NULL DEFAULT 'default',
  label       VARCHAR(120)    NULL,
  item_type   VARCHAR(16)     NOT NULL,
  href        VARCHAR(500)    NULL,
  ref_id      BIGINT UNSIGNED NULL,
  new_tab     TINYINT(1)      NOT NULL DEFAULT 0,
  enabled     TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order  INT             NOT NULL DEFAULT 0,
  created_at  DATETIME        NOT NULL,
  updated_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rn_nav_items_order (site_id, enabled, sort_order),
  KEY idx_rn_nav_items_ref (site_id, item_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
