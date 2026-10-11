import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuth } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true, title: '登录' }
  },
  {
    path: '/',
    component: () => import('@/layouts/AdminLayout.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '仪表盘' } },
      { path: 'posts', name: 'posts', component: () => import('@/views/PostsView.vue'), meta: { title: '文章', permission: 'post.view' } },
      { path: 'taxonomy', name: 'taxonomy', component: () => import('@/views/TaxonomyView.vue'), meta: { title: '分类与标签', permission: 'post.view' } },
      { path: 'media', name: 'media', component: () => import('@/views/MediaView.vue'), meta: { title: '媒体库', permission: 'media.manage' } },
      { path: 'comments', name: 'comments', component: () => import('@/views/CommentsView.vue'), meta: { title: '评论审核', permission: 'comment.moderate' } },
      { path: 'users', name: 'users', component: () => import('@/views/UsersView.vue'), meta: { title: '用户', permission: 'user.manage' } },
      { path: 'roles', name: 'roles', component: () => import('@/views/RolesView.vue'), meta: { title: '角色与权限', permission: 'user.manage' } },
      { path: 'themes', name: 'themes', component: () => import('@/views/ThemesView.vue'), meta: { title: '外观中心', permission: 'theme.view' } },
      { path: 'plugins', name: 'plugins', component: () => import('@/views/PluginsView.vue'), meta: { title: '扩展中心', permission: 'plugin.view' } },
      { path: 'logs', name: 'logs', component: () => import('@/views/LogsView.vue'), meta: { title: '运行日志', permission: 'system.maintain' } },
      { path: 'backup', name: 'backup', component: () => import('@/views/BackupView.vue'), meta: { title: '备份与恢复', permission: 'system.maintain' } },
      { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '系统设置' } }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/' }
];

export const router = createRouter({
  history: createWebHistory('/admin/'),
  routes,
  scrollBehavior: () => ({ top: 0 })
});

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

  const permission = to.meta.permission as string | undefined;
  if (permission && !auth.can(permission)) {
    return { name: 'dashboard' };
  }

  return true;
});
