/**
 * 内核自有的权限点声明。
 *
 * 这些权限点守卫的是 **Core 自己的路由与后台入口**（外观中心、扩展中心、系统维护、用户与角色），
 * 以及被多个插件**共用**的跨域权限点（`user.manage` 同时被 identity 的 `/users*` 与
 * authorization 的 `/roles` 使用）。
 *
 * 为什么不写在某个插件的 manifest 里：它们不属于任何插件 —— 若硬塞给某个插件，
 * "谁声明"就又会退化成集中式硬编码（那正是本模块要消除的耦合）。
 *
 * 插件自有权限点由各插件在自己的 `manifest.permissions` 声明，两者由 Core 合并展示。
 */

import type { PluginPermissionDeclaration } from '@ricenote/shared';

export const CORE_PERMISSIONS: readonly PluginPermissionDeclaration[] = [
  {
    key: 'theme.view',
    label: { 'zh-CN': '查看主题', en: 'View themes' },
    group: { 'zh-CN': '外观', en: 'Appearance' }
  },
  {
    key: 'theme.manage',
    label: { 'zh-CN': '管理主题与设置', en: 'Manage themes and settings' },
    group: { 'zh-CN': '外观', en: 'Appearance' }
  },
  {
    key: 'plugin.view',
    label: { 'zh-CN': '查看插件', en: 'View plugins' },
    group: { 'zh-CN': '扩展', en: 'Extensions' }
  },
  {
    key: 'plugin.manage',
    label: { 'zh-CN': '启用与配置插件', en: 'Enable and configure plugins' },
    group: { 'zh-CN': '扩展', en: 'Extensions' }
  },
  {
    /*
     * 与"启停与配置"刻意分开：安装/更新/卸载会在服务器上执行插件代码
     * （装依赖、跑构建脚本），风险等级完全不同。
     */
    key: 'plugin.install',
    label: {
      'zh-CN': '安装、更新与卸载插件（等同授予其服务器代码执行权限）',
      en: 'Install, update and remove plugins (equivalent to granting server code execution)'
    },
    group: { 'zh-CN': '扩展', en: 'Extensions' }
  },
  {
    key: 'user.manage',
    label: { 'zh-CN': '管理用户与角色', en: 'Manage users and roles' },
    group: { 'zh-CN': '用户', en: 'Users' }
  },
  {
    key: 'system.audit',
    label: { 'zh-CN': '查看审计日志', en: 'View the audit log' },
    group: { 'zh-CN': '系统', en: 'System' }
  },
  {
    key: 'system.maintain',
    label: { 'zh-CN': '系统维护（运行日志与备份恢复）', en: 'System maintenance (logs, backup and restore)' },
    group: { 'zh-CN': '系统', en: 'System' }
  },
  {
    key: 'system.restart',
    label: { 'zh-CN': '重启服务（使待生效变更生效）', en: 'Restart the service' },
    group: { 'zh-CN': '系统', en: 'System' }
  }
];
