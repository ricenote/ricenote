/**
 * 主题声明的「内容自定义字段」：**文章与页面共用同一份声明**。
 *
 * 分工（避免出现第二份实现）：
 * - **值级校验与读取过滤**在 `@ricenote/shared`（`content-fields.ts`），
 *   因为真正用它们的是内容插件，而插件不依赖宿主 Core；
 * - **本文件**只负责宿主的另一半：把声明解析成后台可渲染的本地化 DTO，
 *   以及把声明通过 `core.theme@1` 服务交给插件（见 `bootstrap.ts`）。
 *
 * 字段定义本身（类型/label/默认值/范围）由清单 Schema（ajv）在 `pnpm validate` 阶段把关；
 * 这里与 shared 的校验互补，各自只做自己那一段。
 */

import type { ContentFieldDto, ContentFieldsSchema } from '@ricenote/shared';
import { resolveLocalizedText } from '@ricenote/theme-sdk';

export {
  hasContentFields,
  isContentFieldType,
  validateContentFieldValues,
  assertContentFieldValues,
  pickDeclaredContentFields
} from '@ricenote/shared';

/** 把字段声明解析成后台可直接渲染的 DTO（文案按站点语言解析）。 */
export function resolveContentFields(
  fields: ContentFieldsSchema | undefined,
  language: string
): ContentFieldDto[] {
  if (!fields) return [];

  return Object.entries(fields).map(([key, field]) => {
    const label = resolveLocalizedText(field.label, language) || key;
    const description = field.description
      ? resolveLocalizedText(field.description, language)
      : undefined;
    const placeholder = field.placeholder
      ? resolveLocalizedText(field.placeholder, language)
      : undefined;

    return {
      key,
      type: field.type,
      label,
      ...(description ? { description } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...(field.options
        ? {
            options: field.options.map((option) => ({
              value: option.value,
              label: resolveLocalizedText(option.label, language) || option.value
            }))
          }
        : {}),
      ...(field.min === undefined ? {} : { min: field.min }),
      ...(field.max === undefined ? {} : { max: field.max }),
      ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
      ...(field.maxItems === undefined ? {} : { maxItems: field.maxItems })
    };
  });
}
