import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, 'dist/browser');

/** 托管路径前缀：与 apps/server 的 /admin-sdk 路由、以及后台 SPA 的 external 映射一致。 */
const SDK_BASE = '/admin-sdk/v1';

/**
 * 拷入 Vue / Vue Router 的官方 esm-browser 产物，并校验单实例前提。
 *
 * 为什么要拷：`ricenote-admin.js` 把 `vue` 外部化成了 `/admin-sdk/v1/vue.js`，
 * 这个 URL 必须真的能被浏览器取到；由 Core 的 `/admin-sdk/**` 路由托管。
 * 这里同时断言产物里确实出现了该 URL —— 如果哪天外部化配置被改掉，
 * 构建会直接失败，而不是等到运行期才发现"宿主与插件各有两份 Vue"。
 */
function copyVendorBundles(): Plugin {
  /*
   * 必须使用**生产版**浏览器产物：
   * 开发版（`*.esm-browser.js`）内部会 `import "@vue/devtools-api"` 这类裸模块名，
   * 浏览器无法解析，需要 import map 才能跑；生产版没有这些依赖。
   */
  const files: Array<{ from: string; to: string }> = [
    { from: require.resolve('vue/dist/vue.esm-browser.prod.js'), to: 'vue.js' },
    { from: require.resolve('vue-router/dist/vue-router.esm-browser.prod.js'), to: 'vue-router.js' }
  ];

  return {
    name: 'ricenote-admin-sdk-vendor-bundles',
    apply: 'build',
    closeBundle() {
      mkdirSync(outDir, { recursive: true });

      for (const file of files) {
        const target = path.join(outDir, file.to);
        copyFileSync(file.from, target);

        /*
         * 官方 esm-browser 产物内部用的是**裸模块名**（`from "vue"`）——
         * 浏览器只有在页面提供 import map 时才能解析它。这里直接改写为托管 URL，
         * 于是不需要 import map，且开发/生产/插件三处的解析结果完全一致。
         */
        const source = readFileSync(target, 'utf8');
        const rewritten = source.replace(
          /(from\s*["'])vue(["'])/g,
          (_match, prefix: string, suffix: string) => `${prefix}${SDK_BASE}/vue.js${suffix}`
        );
        if (rewritten !== source) writeFileSync(target, rewritten);
      }

      // 产物里必须出现托管 URL：这是"宿主与插件共用同一个 Vue 实例"的前提
      for (const name of ['ricenote-admin.js', 'vue-router.js']) {
        const content = readFileSync(path.join(outDir, name), 'utf8');
        if (!content.includes(`${SDK_BASE}/vue.js`)) {
          throw new Error(
            `${name} 未引用 ${SDK_BASE}/vue.js：Vue 未被外部化，宿主与插件会出现两份 Vue 实例`
          );
        }
      }

      /*
       * 零构建的前提是"浏览器能直接解析这些模块"，因此产物里**不允许出现裸模块名**
       * （`from "vue"`、`from "@vue/devtools-api"` 之类）。这条断言把问题拦在构建期：
       * 真跑到浏览器里才报 "Failed to resolve module specifier" 时极难定位。
       */
      const bareImport =
        /(?:^|[;\s])import\s*(?:[^;]*?\bfrom\s*)?["'](?![./]|https?:\/\/|\/\/)([A-Za-z0-9@][A-Za-z0-9@/._-]*)["']/;
      for (const name of ['vue.js', 'vue-router.js', 'ricenote-admin.js']) {
        const content = readFileSync(path.join(outDir, name), 'utf8');
        const matched = content.match(bareImport);
        if (matched) {
          throw new Error(`${name} 含裸模块名（浏览器无法解析）：${matched[0]}（应用生产版产物或外部化该依赖）`);
        }
      }

      writeFileSync(
        path.join(outDir, 'SINGLETON.md'),
        [
          '本目录的产物由 `packages/admin-sdk` 构建生成，由 Core 以 /admin-sdk/v1/** 托管。',
          '',
          '- vue.js：官方 esm-browser 产物（含运行时编译器，插件模板字符串需要它）',
          '- vue-router.js：官方 esm-browser 产物，内部 `from "vue"` 已在构建时改写为托管 URL',
          '- ricenote-admin.js：SDK 主体，import 上面两个 URL（保证宿主与插件同一模块实例）',
          '',
          '不要手工编辑这些文件；修改后重新执行 `pnpm --filter @ricenote/admin-sdk build`。',
          ''
        ].join('\n')
      );
    }
  };
}

export default defineConfig({
  plugins: [vue(), copyVendorBundles()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    // 不压缩：产物体积由 HTTP 长缓存兜底，可读性更有利于插件作者调试
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.resolve(here, 'src/browser-entry.ts'),
      formats: ['es'],
      fileName: () => 'ricenote-admin.js'
    },
    rollupOptions: {
      // 外部化 Vue 并映射到托管 URL：宿主与插件必须拿到同一个模块实例
      external: ['vue', 'vue-router'],
      output: {
        paths: {
          vue: `${SDK_BASE}/vue.js`,
          'vue-router': `${SDK_BASE}/vue-router.js`
        }
      }
    }
  }
});
