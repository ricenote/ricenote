/**
 * 插件后台界面的模块契约与宿主上下文。
 *
 * 插件（零构建）只需这样写：
 *
 * ```js
 * import { defineAdminPage, ref, api, useToast } from '/admin-sdk/v1/ricenote-admin.js';
 *
 * export default defineAdminPage({
 *   title: '导航栏',
 *   setup() {
 *     const items = ref([]);
 *     const toast = useToast();
 *     async function load() { items.value = await api.get('/navigation/items'); }
 *     return { items, load, toast };
 *   },
 *   template: `<Card>...</Card>`   // SDK 组件已全局注册，无需 import 注册
 * });
 * ```
 *
 * 两个关键点：
 * 1. **组件全局注册**：宿主启动时 `app.use(createAdminSdk())`，因此插件模板里
 *    可以直接写 `<Card>`、`<Button>`、`<DataTable>`，无需自行注册；
 * 2. **单实例标记**：SDK 被加载几次就有几个实例标记。宿主与插件必须命中同一个
 *    模块实例（同一 URL），否则会出现"两份 Vue"这类极难排查的问题——
 *    `sdkInstanceCount()` 让这件事**可断言**。
 */

import type { App, Component } from 'vue';
import { defineComponent, h } from 'vue';
import Badge from './components/ui/Badge.vue';
import Button from './components/ui/Button.vue';
import Card from './components/ui/Card.vue';
import Dialog from './components/ui/Dialog.vue';
import Input from './components/ui/Input.vue';
import Label from './components/ui/Label.vue';
import Select from './components/ui/Select.vue';
import Switch from './components/ui/Switch.vue';
import Textarea from './components/ui/Textarea.vue';
import Toaster from './components/ui/Toaster.vue';
import AdminPage from './components/AdminPage.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import DataTable from './components/DataTable.vue';
import EmptyState from './components/EmptyState.vue';
import Field from './components/Field.vue';
import Icon from './components/Icon.vue';
import LoadingState from './components/LoadingState.vue';
import Pagination from './components/Pagination.vue';
import Tabs from './components/Tabs.vue';
import ContentFields from './content/ContentFields.vue';
import PluginSlot from './extension/PluginSlot.vue';

/** SDK 版本：与 package.json 保持一致，供插件做能力探测与日志排查。 */
export const SDK_VERSION = '0.1.0';

/** 单实例标记：同一模块实例只会写入一次。 */
const INSTANCE_KEY = '__RICENOTE_ADMIN_SDK_INSTANCES__';

interface InstanceRegistry {
  [INSTANCE_KEY]?: string[];
}

const instanceId = `sdk-${Math.random().toString(36).slice(2, 10)}`;

(() => {
  const registry = globalThis as unknown as InstanceRegistry;
  const list = registry[INSTANCE_KEY] ?? [];
  list.push(instanceId);
  registry[INSTANCE_KEY] = list;
})();

/** 已加载的 SDK 实例数：正常应为 1（宿主与插件共用同一 URL）。 */
export function sdkInstanceCount(): number {
  return ((globalThis as unknown as InstanceRegistry)[INSTANCE_KEY] ?? []).length;
}

export interface AdminPageOptions {
  /** 页面标题（宿主可用于文档标题；缺省使用菜单项 label）。 */
  title?: string;
  /** 组合式 API；返回值即模板作用域。 */
  setup?: () => Record<string, unknown>;
  /** 模板字符串（依赖 SDK 内置的 Vue 运行时编译器）。 */
  template?: string;
  /** 或不写模板、直接给渲染函数。 */
  render?: () => unknown;
}

/**
 * 定义插件后台页面。
 *
 * 返回值就是标准的 Vue 组件定义，宿主直接 `<component :is="page" />` 渲染。
 */
export function defineAdminPage(options: AdminPageOptions): Component {
  return defineComponent({
    name: `PluginAdminPage:${options.title ?? 'page'}`,
    ...(options.setup ? { setup: options.setup } : {}),
    ...(options.template ? { template: options.template } : {}),
    ...(options.render
      ? { render: options.render as () => unknown }
      : options.template
        ? {}
        : { render: () => h('div') })
  });
}

/* ------------------------------ 宿主上下文 ------------------------------ */

/** 宿主注入的最小能力集（避免插件直接依赖宿主实现）。 */
export interface HostContext {
  /** 路由跳转（后台内导航，例如跳到扩展中心）。 */
  navigate?: (path: string) => void;
  /** 宿主提供的当前工作目录标识（便于日志排查）。 */
  host?: string;
}

let hostContext: HostContext = {};

/** 由宿主在挂载后注入（后台 SPA 调用）。 */
export function setHostContext(context: HostContext): void {
  hostContext = context;
}

/** 后台内导航；宿主未注入时退化为整页跳转。 */
export function navigate(path: string): void {
  if (hostContext.navigate) {
    hostContext.navigate(path);
    return;
  }
  window.location.assign(`/admin${path}`);
}

export function getHostContext(): HostContext {
  return hostContext;
}

/* ------------------------------ Vue 插件 ------------------------------ */

/** SDK 全局注册的组件名 → 组件定义。 */
export const SDK_COMPONENTS: Record<string, Component> = {
  AdminPage,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ContentFields,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Icon,
  Input,
  Label,
  LoadingState,
  Pagination,
  PluginSlot,
  Select,
  Switch,
  Tabs,
  Textarea,
  Toaster
};

/**
 * 以 Vue 插件形式全局注册 SDK 组件。
 *
 * 注册后**插件模板不需要 import 组件**，直接写 `<Card>` / `<Button>` 即可；
 * 这也是"零构建写界面"体验的关键一步。
 */
export function createAdminSdk(): { install: (app: App) => void } {
  return {
    install(app: App): void {
      for (const [name, component] of Object.entries(SDK_COMPONENTS)) {
        app.component(name, component);
      }
    }
  };
}
