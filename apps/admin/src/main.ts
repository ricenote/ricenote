import { createApp } from 'vue';
import { createAdminSdk, setHostContext } from '@ricenote/admin-sdk';
import App from '@/App.vue';
import { router } from '@/router';
import '@/index.css';

const app = createApp(App);

/*
 * 导航失败必须可见：生产构建里的 vue-router 会**静默**吞掉导航错误，
 * 表现为"页面一片空白且控制台干净"，排查成本极高（本次迁移就踩过）。
 * 这里统一上报，包含目标路径与原因。
 */
router.onError((error, to) => {
  console.error('[admin] 路由导航失败', to?.fullPath ?? '(未知路径)', error);
});

app.use(router);
// 全局注册 SDK 组件：插件后台界面的模板里可直接写 <Card>、<Button>、<DataTable>
app.use(createAdminSdk());

// 注入宿主上下文：插件通过 SDK 的 navigate() 做后台内跳转，而不直接依赖宿主实现
setHostContext({
  host: 'admin',
  navigate: (path: string) => {
    void router.push(path);
  }
});

app.mount('#app');
