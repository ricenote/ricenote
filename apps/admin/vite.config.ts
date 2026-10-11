import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Vue 与 SDK 的**托管 URL**（由 RiceNote 服务端提供，见 apps/server 的 /admin-sdk 路由）。
 *
 * 为什么宿主也要走这些 URL，而不是把 Vue 打进自己的 bundle：
 * 插件后台界面在浏览器里动态 import 同一个 `ricenote-admin.js`，
 * 它内部又 import 同一个 `vue.js`。只有宿主与插件指向**同一 URL**，
 * 才能保证是同一个模块实例（同一份 Vue）——否则会出现"同一页面两个 Vue"，
 * 表现为模板不编译、响应式不生效。
 */
const SDK_VUE_URL = '/admin-sdk/v1/vue.js';
const SDK_VUE_ROUTER_URL = '/admin-sdk/v1/vue-router.js';
/**
 * SDK 本体的托管 URL。
 *
 * 宿主必须与插件加载**同一份** SDK：SDK 里持有会话、权限、提示条、运行状态等
 * 全局单例状态 —— 若宿主打包一份源码、插件加载一份产物，插件界面就会看到
 * "未登录/无权限"的空状态，提示条也弹不到宿主的容器里。
 */
const SDK_URL = '/admin-sdk/v1/ricenote-admin.js';

/**
 * 后台 SPA 的部署基础路径。
 *
 * 生产由服务端的 `/admin/*` 分发（`/admin/`）；开发期为 `/`：
 * 一是本地访问更直接，二是**避免 base 前缀改写托管 URL**（见 hostedVue 的说明）。
 * 路由两侧都通过 `import.meta.env.BASE_URL` 取值，因此无需各自硬编码。
 */
const PROD_BASE = '/admin/';

/**
 * 开发期把 `vue` / `vue-router` 解析为**浏览器外部 URL**。
 *
 * 不能只用 `resolve.alias`：Vite 会把别名目标当成项目内文件去读，直接 500。
 * `resolveId` 返回 `{ external: true }` 才是正确姿势 —— 浏览器按托管 URL 加载，
 * 与服务端托管、以及插件侧的 import 完全一致（这是"单实例"的前提）。
 * 生产构建由 `build.rollupOptions.external` + `output.paths` 完成同样的事。
 *
 * 注意：**开发期的 base 必须是 `/`**（见 `base` 配置）。若 base 是 `/admin/`，
 * Vite 会把项目内文件的导入改写成 `/admin/admin-sdk/v1/vue.js`，而托管产物内部
 * （vue-router 改写后的绝对路径）用的是 `/admin-sdk/v1/vue.js` —— 两个 URL 会变成
 * 两份 Vue 实例，`provide/inject` 失效，表现为页面空白且控制台干净。
 */
function hostedVue(): Plugin {
  const targets: Record<string, string> = {
    vue: SDK_VUE_URL,
    'vue-router': SDK_VUE_ROUTER_URL,
    '@ricenote/admin-sdk': SDK_URL
  };

  return {
    name: 'ricenote-hosted-vue',
    apply: 'serve',
    enforce: 'pre',
    resolveId(source) {
      const target = targets[source];
      return target ? { id: target, external: true } : null;
    }
  };
}

export default defineConfig(({ command }) => ({
  plugins: [vue(), hostedVue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  base: command === 'serve' ? '/' : PROD_BASE,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      // 生产构建同样外部化：产物里留下 /admin-sdk/v1/* 的 import
      external: ['vue', 'vue-router', '@ricenote/admin-sdk'],
      output: {
        paths: {
          vue: SDK_VUE_URL,
          'vue-router': SDK_VUE_ROUTER_URL,
          '@ricenote/admin-sdk': SDK_URL
        }
      }
    }
  },
  optimizeDeps: {
    /*
     * 交给浏览器按 URL 加载，不要让 Vite 预打包出第二份 Vue。
     *
     * `lucide-vue-next` 也必须排除：esbuild 预打包时会把 `vue` 视为外部依赖，
     * 产物里保留**裸模块名** `import ... from "vue"`，浏览器无法解析（直接报
     * "Failed to resolve module specifier"）。排除后它由 Vite 按源码逐个转换，
     * 其中的 `vue` 会走同一套外部化规则 → 与宿主/插件共用同一个 Vue 实例。
     */
    exclude: ['vue', 'vue-router', 'lucide-vue-next']
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173,
    proxy: {
      // 开发期把 API、媒体、主题资源与托管资源代理到 RiceNote 服务端
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/theme-assets': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/preview': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/admin-sdk': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/plugin-admin': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      /*
       * `/media` 同时是"媒体文件回传"的路径与**媒体库插件页面的路由**。
       * 开发期 SPA 在根路径下，两者会撞车：只有 `/media/xxx`（带资源段）才该走后端，
       * 顶层 `/media` 必须回退到 SPA（生产环境 SPA 在 `/admin/` 下，不存在该冲突）。
       */
      '/media': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        bypass: (request) => (request.url === '/media' ? '/index.html' : undefined)
      }
    }
  }
}));
