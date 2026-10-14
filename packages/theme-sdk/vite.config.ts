/**
 * 短代码引擎的浏览器产物构建。
 *
 * 镜像 `@ricenote/admin-sdk` 的做法（Vite 构建到 `dist/browser`），
 * 由 Core 以 `/theme-sdk/v1/**` 托管、主题用 `shortcode_runtime()` 引入。
 *
 * 为什么打包成 IIFE 而不是 ESM：主题脚本是**零构建**的普通脚本，用
 * `<script defer>` 直接引入即可，不需要 import map；IIFE 全局名
 * `RiceNoteShortcodes` 就是主题侧的注册入口。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, 'dist/browser');

export default defineConfig({
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    // 不压缩：产物体积由 HTTP 长缓存兜底，可读性更有利于主题作者调试
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.resolve(here, 'src/shortcodes/browser.ts'),
      formats: ['iife'],
      name: 'RiceNoteShortcodes',
      fileName: () => 'ricenote-shortcodes.js'
    }
  }
});
