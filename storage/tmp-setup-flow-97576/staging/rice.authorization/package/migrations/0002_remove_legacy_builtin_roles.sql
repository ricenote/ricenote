-- 内置角色收敛：只保留 administrator，删除历史内置的 editor / author / contributor。
--
-- 背景：这三个角色曾把**各插件**的权限点硬编码在 authorization 插件里
-- （每加一个插件都要改它的源码）。现在权限点声明已下放给各插件
-- （`manifest.permissions`），内置角色也不再替站点决定"谁该有什么权限"，
-- 因此这三个角色退出内置，已存在的记录在这里一次性删除。
--
-- 迁移 0001 不改动：它已被既有实例执行过，改内容会让校验值不一致。
-- 全新安装的顺序是 0001 建四个 → 0002 删三个，净结果一致。
--
-- 删除顺序：先删两张关联表，再删角色本身（避免留下悬空引用）。

DELETE rp FROM rn_authz_role_permissions rp
  JOIN rn_authz_roles r ON r.id = rp.role_id
 WHERE r.builtin = 1 AND r.name IN ('editor', 'author', 'contributor');

DELETE ur FROM rn_authz_user_roles ur
  JOIN rn_authz_roles r ON r.id = ur.role_id
 WHERE r.builtin = 1 AND r.name IN ('editor', 'author', 'contributor');

DELETE FROM rn_authz_roles
 WHERE builtin = 1 AND name IN ('editor', 'author', 'contributor');
