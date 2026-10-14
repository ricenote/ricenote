-- permalink 插件自有表：各固定链接方案的生效模板。
--
-- 设计要点：
-- 1. **按方案存**（`scheme_id` 为主键的一部分），而不是给内置三类各开一列：
--    第三方插件通过 `rice.permalink.schemes` 扩展点贡献的方案与本插件内置的
--    文章/页面/分类共用同一张表，新增方案不需要迁移。
-- 2. `template` 为空字符串表示"未配置"，读取时回落到该方案的默认模板；
--    因此删掉一行与写空串语义一致（都回到默认），但保留一行可以留下修改痕迹。
-- 3. 不存"编译结果"：模板在插件启动时统一编译，库里的永远是人可读的模板原文。
-- 4. 表所有权归本插件（见说明书第 8 章），不与其他插件的表联查。

CREATE TABLE IF NOT EXISTS rn_permalink_settings (
  site_id    VARCHAR(64)  NOT NULL DEFAULT 'default',
  scheme_id  VARCHAR(64)  NOT NULL,
  template   VARCHAR(200) NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME     NOT NULL,
  PRIMARY KEY (site_id, scheme_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
