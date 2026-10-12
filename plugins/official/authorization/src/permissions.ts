/**
 * 内置角色与权限点目录的组装。
 *
 * 权限点的**声明**已经下放：各插件在 `manifest.permissions` 里声明自己的权限点，
 * Core 声明控制面权限点，并由 Core 聚合、校验全局唯一性、记录使用点。
 * 本插件因此**不再持有任何权限点清单** —— 它只做两件事：
 *
 * 1. **组装展示目录**：把 Core 聚合后的「声明 + 使用」视图按站点语言解析成文案；
 * 2. **维护内置角色**：只保留 `administrator`（`*`）。
 *
 * 为什么内置角色只剩一个：插件不该替站点决定"谁该有什么权限"。
 * `editor` / `author` / `contributor` 曾把各插件的权限点硬编码在这里，
 * 每加一个插件都要改本文件 —— 现在改为由管理员按需自建角色并显式授权。
 * 升级时这三个历史角色会由迁移一次性删除（见 `migrations/0002_*.sql`）。
 */

import { resolveLocalizedText, type DeclaredPermission } from '@ricenote/shared';

/** 权限管理界面里的一项（文案已按站点语言解析）。 */
export interface PermissionDefinition {
  key: string;
  label: string;
  group: string;
}

export interface BuiltinRoleDefinition {
  name: string;
  description: string;
  /** `*` 表示全部权限。 */
  permissions: string[];
}

/**
 * 未声明权限点的兜底分组名。
 *
 * 宽松策略下这些权限点仍然可分配，因此不能从目录里丢掉；
 * 给它们一个明确的分组，管理员一眼能看出"这是哪个插件忘了声明"。
 */
export const UNDECLARED_PERMISSION_GROUP = '未登记';

export const BUILTIN_ROLES: BuiltinRoleDefinition[] = [
  {
    name: 'administrator',
    description: '站点管理员，拥有全部权限',
    permissions: ['*']
  }
];

/** 内置管理员角色名（多处使用，避免拼写漂移）。 */
export const ADMINISTRATOR_ROLE = 'administrator';

/**
 * 把 Core 聚合的权限点视图解析为后台展示用的目录。
 *
 * 未登记的权限点不会被丢掉：`label` 回退为标识本身、`group` 归入「未登记」，
 * 这样管理员仍能给它分配权限（宽松策略 —— 鉴权本来就不依赖声明）。
 */
export function buildPermissionCatalog(
  declared: readonly DeclaredPermission[],
  locale: string
): PermissionDefinition[] {
  return declared.map((item) => ({
    key: item.key,
    label: resolveLocalizedText(item.label ?? undefined, locale, item.key),
    group: resolveLocalizedText(item.group ?? undefined, locale, UNDECLARED_PERMISSION_GROUP)
  }));
}
