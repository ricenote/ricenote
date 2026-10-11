/**
 * 插件设置的声明式 Schema 解析与校验。
 *
 * 两种写法并存（向后兼容）：
 * 1. **旧写法**：`manifest.settings` 是扁平的「字段名 → 默认值」对象。
 *    此时只能做"键必须在声明范围内"的宽松校验，后台退化为键值编辑。
 * 2. **新写法**：`manifest.settingsSchema` 是「分组 + 字段」，与主题设置**完全同构**。
 *    后台据此自动生成表单，且值校验直接复用 theme-sdk 的实现，
 *    因此插件设置与主题设置在类型、范围、多语言上的行为完全一致。
 */

import {
  buildDefaults,
  resolveLocalizedText,
  validateSettings,
  type SettingsValidationResult
} from '@ricenote/theme-sdk';
import {
  ErrorCode,
  RiceNoteError,
  type PluginManifest,
  type SettingsGroupDto,
  type SettingsSchema,
  type ValidationIssue
} from '@ricenote/shared';

/** 插件是否声明了声明式设置表单。 */
export function hasDeclarativeSettings(manifest: Pick<PluginManifest, 'settingsSchema'>): boolean {
  return manifest.settingsSchema !== undefined && Object.keys(manifest.settingsSchema).length > 0;
}

/** 以主题设置的校验器所需的形态包装插件 Schema。 */
function asThemeLike(
  manifest: Pick<PluginManifest, 'settingsSchema'>
): { settings: SettingsSchema } {
  return { settings: manifest.settingsSchema ?? {} };
}

/** 插件声明的全部设置字段名（声明式与旧写法合并）。 */
export function declaredSettingKeys(
  manifest: Pick<PluginManifest, 'settings' | 'settingsSchema'>
): string[] {
  const keys = new Set<string>(Object.keys(manifest.settings ?? {}));
  for (const group of Object.values(manifest.settingsSchema ?? {})) {
    for (const key of Object.keys(group.fields ?? {})) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * 合成插件生效设置：旧写法默认值 → 声明式默认值 → 数据库覆盖。
 *
 * 声明式默认值优先于旧写法，因为一旦声明了表单，字段语义以表单为准。
 */
export function resolvePluginSettings(
  manifest: Pick<PluginManifest, 'settings' | 'settingsSchema'>,
  overrides: Record<string, unknown> | undefined
): Record<string, unknown> {
  const legacy = (manifest.settings ?? {}) as Record<string, unknown>;
  const schemaDefaults = hasDeclarativeSettings(manifest)
    ? buildDefaults(asThemeLike(manifest))
    : {};
  return { ...legacy, ...schemaDefaults, ...(overrides ?? {}) };
}

/** 把声明式 Schema 解析为后台可渲染的分组 DTO（文案已按站点语言解析）。 */
export function buildPluginSettingsGroups(
  manifest: Pick<PluginManifest, 'settingsSchema'>,
  values: Record<string, unknown>,
  locale: string
): SettingsGroupDto[] {
  const groups = manifest.settingsSchema ?? {};
  return Object.entries(groups).map(([key, group]) => {
    const groupDescription = resolveLocalizedText(group.description, locale);
    return {
      key,
      label: resolveLocalizedText(group.label, locale),
      ...(groupDescription ? { description: groupDescription } : {}),
      fields: Object.entries(group.fields ?? {}).map(([fieldKey, field]) => {
        const { label, description, placeholder, options, ...rest } = field;
        const fieldDescription = resolveLocalizedText(description, locale);
        const fieldPlaceholder = resolveLocalizedText(placeholder, locale);
        return {
          ...rest,
          key: fieldKey,
          label: resolveLocalizedText(label, locale),
          ...(fieldDescription ? { description: fieldDescription } : {}),
          ...(fieldPlaceholder ? { placeholder: fieldPlaceholder } : {}),
          ...(options
            ? {
                options: options.map((option) => ({
                  label: resolveLocalizedText(option.label, locale),
                  value: option.value
                }))
              }
            : {}),
          value: values[fieldKey] ?? field.default ?? null,
          default: field.default ?? null
        };
      })
    };
  });
}

/**
 * 校验待保存的插件设置。
 *
 * 返回值中的 `normalized` 只包含**本次提交的字段**：
 * 只持久化用户实际改动过的键，这样插件升级后新增字段的默认值仍然动态生效，
 * 而不会被旧的落库快照冻结。
 */
export function validatePluginSettingsValues(
  manifest: Pick<PluginManifest, 'settings' | 'settingsSchema'>,
  input: Record<string, unknown>
): SettingsValidationResult {
  if (!hasDeclarativeSettings(manifest)) {
    return validateLegacyValues(manifest, input);
  }

  const result = validateSettings(asThemeLike(manifest), input);
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (result.normalized[key] === undefined) continue;
    normalized[key] = result.normalized[key];
  }
  return { ...result, normalized };
}

/**
 * 旧写法（`manifest.settings` 为自由对象）的宽松校验。
 *
 * 严格程度刻意低于声明式：只保证"键必须在插件声明范围内"（防止借该接口
 * 往任意配置里塞东西），值本身只要求是可 JSON 序列化的标量，
 * 以兼容既有插件的自由约定。
 */
function validateLegacyValues(
  manifest: Pick<PluginManifest, 'settings'>,
  input: Record<string, unknown>
): SettingsValidationResult {
  const declared = Object.keys(manifest.settings ?? {});
  const issues: ValidationIssue[] = [];
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!declared.includes(key)) {
      issues.push({
        path: `/settings/${key}`,
        message: `插件未声明该设置项：${key}（可选：${declared.join(', ') || '无'}）`,
        keyword: 'unknownField'
      });
      continue;
    }
    if (value !== null && typeof value === 'object') {
      issues.push({
        path: `/settings/${key}`,
        message: '设置值必须是字符串、数字、布尔或 null',
        keyword: 'type'
      });
      continue;
    }
    normalized[key] = value;
  }

  return { valid: issues.length === 0, issues, normalized };
}

/** 校验失败时抛出携带字段级问题的领域错误。 */
export function assertPluginSettingsValid(
  pluginId: string,
  result: SettingsValidationResult
): void {
  if (result.valid) return;
  throw new RiceNoteError(ErrorCode.PLUGIN_SETTING_INVALID, `插件 ${pluginId} 的设置校验失败`, {
    status: 400,
    details: { pluginId, issues: result.issues }
  });
}
