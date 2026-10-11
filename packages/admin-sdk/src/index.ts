/**
 * `@ricenote/admin-sdk` 的类型化出口（供后台 SPA 与构建型插件使用）。
 *
 * 零构建插件走的是浏览器入口：`/admin-sdk/v1/ricenote-admin.js`
 * （见 `browser-entry.ts`），两者导出同一套能力，区别只是 Vue API 的再次导出。
 */

export * from './utils.js';
export * from './api/client.js';
export * from './composables/use-session.js';
export * from './composables/use-toast.js';
export * from './composables/use-system-state.js';
export * from './composables/use-async-data.js';
export * from './admin-page.js';
export * from './icons.js';

/* ------------------------------ UI 组件 ------------------------------ */

export { default as Badge } from './components/ui/Badge.vue';
export { default as Button } from './components/ui/Button.vue';
export { default as Card } from './components/ui/Card.vue';
export { default as Dialog } from './components/ui/Dialog.vue';
export { default as Input } from './components/ui/Input.vue';
export { default as Label } from './components/ui/Label.vue';
export { default as Select } from './components/ui/Select.vue';
export { default as Switch } from './components/ui/Switch.vue';
export { default as Textarea } from './components/ui/Textarea.vue';
export { default as Toaster } from './components/ui/Toaster.vue';

/* --------------------------- 复合组件 --------------------------- */

export { default as AdminPage } from './components/AdminPage.vue';
export { default as ConfirmDialog } from './components/ConfirmDialog.vue';
export { default as DataTable } from './components/DataTable.vue';
export { default as EmptyState } from './components/EmptyState.vue';
export { default as Field } from './components/Field.vue';
export { default as Icon } from './components/Icon.vue';
export { default as LoadingState } from './components/LoadingState.vue';
export { default as Pagination } from './components/Pagination.vue';
export { default as Tabs } from './components/Tabs.vue';

export type { DataTableColumn } from './components/DataTable.vue';
export type { TabItem } from './components/Tabs.vue';
export type { SelectOption } from './components/ui/Select.vue';
