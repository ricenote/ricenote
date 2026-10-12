-- 中文全文检索：把 0001 创建的默认分词 FULLTEXT 索引重建为 ngram 解析器。
--
-- MySQL 的默认分词器按空格切词，对中文几乎不可用（整句会被当成一个词）。
-- ngram 解析器按固定长度切分多字节字符，使中文关键词可以命中。
--
-- 说明：先 DROP 再 ADD 是 MySQL 修改 FULLTEXT 解析器的必需步骤；
-- 0001 已经创建过同名索引，因此这里 DROP 不会失败。

ALTER TABLE rn_posts DROP INDEX ft_rn_posts_search;

ALTER TABLE rn_posts
  ADD FULLTEXT KEY ft_rn_posts_search (title, excerpt, content) WITH PARSER ngram;
