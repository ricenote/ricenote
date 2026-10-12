/**
 * 插件对"命名扩展点"的贡献契约。
 *
 * 与 `defineAdminPage` 同构同风格：返回值就是标准的 Vue 组件定义，
 * 宿主 `<PluginSlot>` 会把它动态挂到对应的扩展点上。
 *
 * 关键点：宿主通过插槽的 `context` 把**提供方声明的字段**以 props 传入
 * （`h(component, context)`）。但 Vue 只会把**本组件声明过**的字段填进
 * `setup(props)` —— 未声明的同名字段会落进 `ctx.attrs`（见 runtime-core 的
 * `setFullProps`：`hasOwn(propsOptions, key)` 为假时写入 attrs）。
 * 因此要读 `props.value` 就必须用下面的 `props` 显式声明，例如：
 *
 * ```js
 * import { defineAdminContribution } from '/admin-sdk/v1/ricenote-admin.js';
 *
 * export default defineAdminContribution({
 *   name: '字数统计',
 *   props: ['value'], // 与提供方扩展点声明的字段一一对应
 *   setup(props) {
 *     const count = computed(() => String(props.value ?? '').length);
 *     return { count };
 *   },
 *   template: `<span class="text-xs text-muted-foreground">{{ count }} 字</span>`
 * });
 * ```
 *
 * 若不便声明（例如字段是动态的），也可从第二个参数读：`setup(props, ctx)`
 * 后取 `ctx.attrs.value`。两种形态都指向同一份 `context`。
 *
 * 注意：贡献组件**不应**承担安全判断 —— 服务端已按权限过滤下发的贡献集合。
 */

import { defineComponent, h, type Component, type ComponentPropsOptions } from 'vue';

export interface AdminContributionOptions {
  /** 组件名（用于 Vue DevTools 定位；缺省为 anonymous）。 */
  name?: string;
  /**
   * 声明本贡献要消费的字段（与提供方扩展点的 `props` 声明一一对应）。
   *
   * 不声明就读不到 `setup(props)` 上的值（会退化为 `ctx.attrs`），
   * 零构建插件写成 `props: ['value', 'onChange']` 即可。
   */
  props?: ComponentPropsOptions;
  /** 组合式 API；第一个参数是按 `props` 声明解析后的字段。 */
  setup?: (props: Record<string, unknown>) => Record<string, unknown>;
  /** 模板字符串（依赖 SDK 内置的 Vue 运行时编译器）。 */
  template?: string;
  /** 或不写模板、直接给渲染函数。 */
  render?: (props: Record<string, unknown>) => unknown;
}

/**
 * 定义一个扩展点贡献。
 *
 * 返回标准的 Vue 组件定义，宿主直接动态渲染 —— 与 `defineAdminPage` 保持
 * 同一套写法，插件作者不需要学习第二套约定。
 */
export function defineAdminContribution(options: AdminContributionOptions): Component {
  return defineComponent({
    name: `AdminContribution:${options.name ?? 'anonymous'}`,
    ...(options.props ? { props: options.props } : {}),
    ...(options.setup ? { setup: options.setup as () => Record<string, unknown> } : {}),
    ...(options.template ? { template: options.template } : {}),
    ...(options.render
      ? { render: options.render as () => unknown }
      : options.template
        ? {}
        : { render: () => h('div') })
  });
}
