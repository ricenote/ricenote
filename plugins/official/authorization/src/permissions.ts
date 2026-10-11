/**
 * 权限点目录与内置角色定义。
 *
 * 权限点是 Core 与插件共同遵守的命名约定：`<域>.<动作>`，例如 `post.write`。
 * 插件通过 `ctx.routes.adminApi({ permission })` 声明所需权限点；
 * 插件也可以通过 `ctx.adminMenu.add({ permission })` 控制菜单可见性。
 */

export interface PermissionDefinition {
  key: string;
  label: string;
  group: string;
}

export const PERMISSIONS: PermissionDefinition[] = [
  { key: 'post.view', label: '查看文章', group: '内容' },
  { key: 'post.write', label: '撰写与编辑文章', group: '内容' },
  { key: 'post.publish', label: '发布与撤回文章', group: '内容' },
  { key: 'post.delete', label: '删除文章', group: '内容' },
  { key: 'page.view', label: '查看页面', group: '内容' },
  { key: 'page.manage', label: '管理独立页面', group: '内容' },
  { key: 'taxonomy.manage', label: '管理分类与标签', group: '内容' },
  { key: 'media.manage', label: '管理媒体库', group: '内容' },
  { key: 'comment.moderate', label: '审核与管理评论', group: '互动' },
  { key: 'nav.view', label: '查看导航栏', group: '外观' },
  { key: 'nav.manage', label: '管理导航栏', group: '外观' },
  { key: 'theme.view', label: '查看主题', group: '外观' },
  { key: 'theme.manage', label: '管理主题与设置', group: '外观' },
  { key: 'plugin.view', label: '查看插件', group: '扩展' },
  { key: 'plugin.manage', label: '启用与配置插件', group: '扩展' },
  /*
   * 安装/更新/卸载刻意与"启停与配置"分开：
   * 前者会在服务器上执行插件代码（装依赖、跑构建脚本），风险等级与
   * "启用一个已存在的插件"完全不同，因此默认只给 administrator（`*`）。
   */
  { key: 'plugin.install', label: '安装、更新与卸载插件（等同授予其服务器代码执行权限）', group: '扩展' },
  { key: 'user.manage', label: '管理用户与角色', group: '用户' },
  { key: 'system.audit', label: '查看审计日志', group: '系统' },
  { key: 'system.maintain', label: '系统维护（运行日志与备份恢复）', group: '系统' },
  {
    key: 'system.restart',
    label: '重启服务（使待生效变更生效）',
    group: '系统'
  }
];

export interface BuiltinRoleDefinition {
  name: string;
  description: string;
  /** `*` 表示全部权限。 */
  permissions: string[];
}

export const BUILTIN_ROLES: BuiltinRoleDefinition[] = [
  {
    name: 'administrator',
    description: '站点管理员，拥有全部权限',
    permissions: ['*']
  },
  {
    name: 'editor',
    description: '编辑：可管理全部内容并发布',
    permissions: [
      'post.view',
      'post.write',
      'post.publish',
      'post.delete',
      'page.view',
      'page.manage',
      'taxonomy.manage',
      'media.manage',
      'comment.moderate',
      'nav.view',
      'nav.manage',
      'theme.view',
      'plugin.view'
    ]
  },
  {
    name: 'author',
    description: '作者：可撰写并发布自己的文章',
    permissions: ['post.view', 'post.write', 'post.publish', 'page.view', 'nav.view', 'media.manage']
  },
  {
    name: 'contributor',
    description: '投稿者：可撰写草稿，等待他人发布',
    permissions: ['post.view', 'post.write', 'page.view', 'nav.view']
  }
];

/** 展开角色权限：`*` 展开为全部权限点。 */
export function expandPermissions(permissions: string[]): string[] {
  if (permissions.includes('*')) return PERMISSIONS.map((item) => item.key);
  return permissions;
}
