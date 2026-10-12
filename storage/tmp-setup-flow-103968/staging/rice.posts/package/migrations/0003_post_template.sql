-- 文章可选模板（1.2.0 新增）。
--
-- 保存的是**主题声明的模板键**（theme.json 的 pageTemplates），不是文件名：
-- 主题更换模板文件后旧数据仍然有效；键在当前主题下不存在时，
-- 渲染器会优雅回退到 templates.post，不会让文章页变成 500。
--
-- 该列为新增可空列，历史文章保持 NULL（= 使用主题默认文章模板），
-- 不改变既有数据的渲染行为。

ALTER TABLE rn_posts ADD COLUMN template VARCHAR(120) NULL AFTER status;
