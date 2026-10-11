import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuth } from '@/stores/auth';
import { useAdminMenu } from '@/stores/menu';
import PluginHostView from '@/views/PluginHostView.vue';

/**
 * 后台路由。
 *
 * Core 只声明**自己拥有**的页面；插件页面（文章、页面、导航栏、分类、媒体、
 * 评论、用户、角色…）不在代码里出现，而是由服务端 `/menu` 下发的
 * `pluginPages` 在运行时动态注册（见 `syncPluginRoutes`）。
 *
 * 这样做的收益：插件停用后其路由与界面一起消失，Core 不需要为每个插件改代码；
 * 代价是深链必须先拿到菜单才能解析路由，因此导航守卫里有一次"等菜单"的等待
 * （否则会命中兜底重定向）。
 */

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true, title: '登录' }
  },
  {
    path: '/',
    name: 'admin-layout',
    component: () => import('@/layouts/AdminLayout.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '仪表盘' } },
      { path: 'themes', name: 'themes', component: () => import('@/views/ThemesView.vue'), meta: { title: '外观中心', permission: 'theme.view' } },
      { path: 'plugins', name: 'plugins', component: () => import('@/views/PluginsView.vue'), meta: { title: '扩展中心', permission: 'plugin.view' } },
      { path: 'logs', name: 'logs', component: () => import('@/views/LogsView.vue'), meta: { title: '运行日志', permission: 'system.maintain' } },
      { path: 'backup', name: 'backup', component: () => import('@/views/BackupView.vue'), meta: { title: '备份与恢复', permission: 'system.maintain' } },
      { path: 'profile', name: 'profile', component: () => import('@/views/ProfileView.vue'), meta: { title: '个人资料' } },
      { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '系统设置' } }
    ]
  },
  /*
   * 兜底路由**不做重定向**。
   *
   * 若写成 `redirect: '/'`，vue-router 会在守卫之前就完成重定向，守卫拿到的是
   * 重定向后的目标（`to.name` 已是 dashboard），于是"插件页面是刚注册的、
   * 需要重新解析一次"这条逻辑永远走不到 —— 深链会被静默吃成仪表盘。
   * 现在由守卫决定：能解析成插件页面就重解析，解析不到才渲染 404。
   */
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') }
];

export const router = createRouter({
  // 取自构建基路径：生产为 /admin/（服务端分发），开发为 /（见 vite.config.ts）
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 })
});

/** 已动态注册的插件路径（避免重复 addRoute）。 */
const registeredPluginPaths = new Set<string>();

/** 把菜单里的插件页面注册为路由（URL 与插件声明一致，书签不受影响）。 */
function syncPluginRoutes(): void {
  const menu = useAdminMenu();

  for (const item of menu.pluginPages.value) {
    if (!item.entryUrl || registeredPluginPaths.has(item.path)) continue;
    registeredPluginPaths.add(item.path);

    router.addRoute('admin-layout', {
      path: item.path.replace(/^\//, ''),
      name: `plugin:${item.path}`,
      component: PluginHostView,
      meta: {
        title: item.label,
        ...(item.permission ? { permission: item.permission } : {}),
        ...(item.pluginId ? { pluginId: item.pluginId } : {}),
        ...(item.styleUrl ? { styleUrl: item.styleUrl } : {}),
        entryUrl: item.entryUrl
      }
    });
  }
}

router.beforeEach(async (to) => {
  const auth = useAuth();

  if (!auth.ready) {
    await auth.refresh();
  }

  if (to.meta.public === true) {
    return auth.isAuthenticated.value && to.name === 'login' ? { name: 'dashboard' } : true;
  }

  if (!auth.isAuthenticated.value) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
  }

  /*
   * 插件页面路由来自菜单。两类时机都要处理：
   * - 深链（刷新页面/粘贴地址）：先拿到菜单，否则目标路由不存在，地址会被兜底吃掉；
   * - 已在后台内点击：菜单通常已就绪，但路由可能尚未注册（首次进入后台时）。
   *
   * 因此每次导航都同步一次（内部按路径去重，成本可忽略）。
   */
  const menu = useAdminMenu();
  if (!menu.loaded.value) {
    await menu.load();
  }
  syncPluginRoutes();

  // 刚注册的路由需要重新解析一次；只做一次（`redirectedFrom` 标记），避免循环
  if (to.name === 'not-found' && !to.redirectedFrom) {
    return { path: to.fullPath, replace: true };
  }

  const permission = to.meta.permission as string | undefined;
  if (permission && !auth.can(permission)) {
    return { name: 'dashboard' };
  }

  return true;
});

/** 登录后重新拉取菜单（权限可能变化），并同步插件路由。 */
export function refreshMenuRoutes(): Promise<void> {
  return useAdminMenu()
    .load(true)
    .then(() => {
      syncPluginRoutes();
    });
}
