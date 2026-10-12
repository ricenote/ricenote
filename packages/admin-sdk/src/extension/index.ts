/**
 * 后台插槽宿主对外的统一出口。
 *
 * - `useAdminExtensions`：读取并裁决命名扩展点的贡献；
 * - `PluginSlot`：把生效贡献渲染到扩展点上（默认插槽即默认内容）；
 * - `defineAdminContribution`：插件声明贡献的入口。
 */

export * from './use-extensions.js';
export * from './contribution.js';
export { default as PluginSlot } from './PluginSlot.vue';

/* 重新导出贡献相关的 DTO，方便使用方直接 `from '@ricenote/admin-sdk'` 取类型。 */
export type {
  AdminExtensionContributionDto,
  AdminExtensionPointDto,
  AdminExtensionsDto
} from '@ricenote/shared';
