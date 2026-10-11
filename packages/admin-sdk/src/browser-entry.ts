/**
 * 浏览器入口：`/admin-sdk/v1/ricenote-admin.js`（零构建插件的唯一 import 目标）。
 *
 * 关键设计：`vue` 与 `vue-router` 在构建时被**外部化**到托管 URL
 * （见 vite.config.ts 的 `output.paths`），因此：
 *
 * - 宿主 SPA 与插件后台界面加载的是**同一个 Vue 模块实例**；
 * - 插件不需要（也不能）自己打包 Vue —— 否则会出现"同一页面两份 Vue"，
 *   表现为模板不编译、响应式不生效、`h()` 渲染异常。
 *
 * `sdkInstanceCount()` 让这件事可以被断言：正常恒为 1。
 */

export * from 'vue';
export * from 'vue-router';
export * from './index.js';
