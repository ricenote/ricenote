/**
 * 内容自定义字段（主题声明）的后台渲染出口。
 *
 * - `ContentFields`：字段集 → 表单控件（文章/页面编辑页共用）；
 * - `useContentFields`：读取主题声明的字段元数据（模块级缓存、失败降级）。
 */

export * from './use-content-fields.js';
export { default as ContentFields } from './ContentFields.vue';

/* 重新导出字段 DTO，便于使用方直接 `from '@ricenote/admin-sdk'` 取类型。 */
export type { ContentFieldDto, ContentFieldsDto } from '@ricenote/shared';
