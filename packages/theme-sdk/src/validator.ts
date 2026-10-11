/**
 * theme.json 设置字段的服务端校验与三级配置合成。
 *
 * 三层模型（说明书 7.4）：
 *   effective = defaults + publishedOverrides        // 公众站点
 *   preview   = defaults + publishedOverrides + draft // 后台预览
 */

import type {
  ThemeManifest,
  ThemeSettingField,
  ThemeSettingValues,
  ValidationIssue,
  ValidationResult
} from '@ricenote/shared';
import { isValidCssColor } from './filters.js';

const SELECT_LIMIT = 64;

/** 扁平化主题设置字段表：字段名在主题范围内必须唯一。 */
export function flattenFields(
  manifest: Pick<ThemeManifest, 'settings'>
): Map<string, ThemeSettingField> {
  const fields = new Map<string, ThemeSettingField>();
  const groups = manifest.settings ?? {};
  for (const group of Object.values(groups)) {
    for (const [key, field] of Object.entries(group.fields ?? {})) {
      fields.set(key, field);
    }
  }
  return fields;
}

/** 由主题声明推导默认值集合。 */
export function buildDefaults(manifest: Pick<ThemeManifest, 'settings'>): ThemeSettingValues {
  const values: ThemeSettingValues = {};
  for (const [key, field] of flattenFields(manifest)) {
    if (field.default !== undefined) {
      values[key] = field.default;
    } else {
      values[key] = fallbackForType(field);
    }
  }
  return values;
}

/** 字段缺省默认值。 */
export function fallbackForType(field: ThemeSettingField): unknown {
  switch (field.type) {
    case 'boolean':
      return false;
    case 'number':
      return field.min ?? 0;
    case 'select':
      return field.options?.[0]?.value ?? '';
    case 'color':
      return '#000000';
    default:
      return '';
  }
}

export interface SettingsValidationResult extends ValidationResult {
  /** 通过校验并归一化后的值（仅包含 Manifest 已声明的字段）。 */
  normalized: ThemeSettingValues;
}

/**
 * 校验一组设置值：
 * - 只接受 Manifest 已声明的字段（未声明字段一律丢弃，防越权写入）；
 * - 按字段类型做服务端二次校验；
 * - 缺失字段补默认值。
 */
export function validateSettings(
  manifest: Pick<ThemeManifest, 'settings'>,
  input: Record<string, unknown>
): SettingsValidationResult {
  const fields = flattenFields(manifest);
  const defaults = buildDefaults(manifest);
  const issues: ValidationIssue[] = [];
  const normalized: ThemeSettingValues = { ...defaults };

  for (const [key, rawValue] of Object.entries(input)) {
    const field = fields.get(key);
    if (!field) {
      issues.push({
        path: `/settings/${key}`,
        message: `主题未声明该设置字段：${key}`,
        keyword: 'unknownField'
      });
      continue;
    }
    const checked = checkField(key, field, rawValue, issues);
    if (checked.ok) {
      normalized[key] = checked.value;
    }
  }

  return { valid: issues.length === 0, issues, normalized };
}

function checkField(
  key: string,
  field: ThemeSettingField,
  value: unknown,
  issues: ValidationIssue[]
): { ok: true; value: unknown } | { ok: false } {
  const path = `/settings/${key}`;
  const fail = (message: string, keyword: string): { ok: false } => {
    issues.push({ path, message, keyword });
    return { ok: false };
  };

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'url': {
      if (typeof value !== 'string') return fail('期望字符串', 'type');
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return fail(`长度超出上限 ${field.maxLength}`, 'maxLength');
      }
      if (field.type === 'url' && value !== '' && !/^https?:\/\//i.test(value)) {
        return fail('URL 必须以 http:// 或 https:// 开头', 'format');
      }
      return { ok: true, value };
    }
    case 'number': {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed)) return fail('期望数字', 'type');
      if (field.min !== undefined && parsed < field.min) {
        return fail(`不得小于 ${field.min}`, 'minimum');
      }
      if (field.max !== undefined && parsed > field.max) {
        return fail(`不得大于 ${field.max}`, 'maximum');
      }
      return { ok: true, value: parsed };
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      if (value === 'true') return { ok: true, value: true };
      if (value === 'false') return { ok: true, value: false };
      return fail('期望布尔值', 'type');
    }
    case 'color': {
      if (typeof value !== 'string' || !isValidCssColor(value)) {
        return fail('期望合法 CSS 颜色', 'format');
      }
      return { ok: true, value: value.trim() };
    }
    case 'select': {
      if (typeof value !== 'string') return fail('期望字符串选项值', 'type');
      const allowed = (field.options ?? []).slice(0, SELECT_LIMIT).map((item) => item.value);
      if (!allowed.includes(value)) {
        return fail(`不在可选范围内：${allowed.join(', ')}`, 'enum');
      }
      return { ok: true, value };
    }
    case 'image': {
      // 媒体库保存的是 Media ID（数字）或来自媒体库的 URL
      if (value === null || value === undefined || value === '') {
        return { ok: true, value: null };
      }
      if (typeof value === 'number' && Number.isInteger(value)) {
        return { ok: true, value };
      }
      if (typeof value === 'string' && /^\/(?:uploads|media)\//.test(value)) {
        return { ok: true, value };
      }
      return fail('图片必须是媒体库 ID 或受管的相对路径', 'format');
    }
    default:
      return fail('未知字段类型', 'type');
  }
}

/** 合成生效配置：默认值 → 已发布覆盖 → （可选）预览草稿。 */
export function composeSettings(
  defaults: ThemeSettingValues,
  published: ThemeSettingValues | null | undefined,
  draft?: ThemeSettingValues | null
): ThemeSettingValues {
  return {
    ...defaults,
    ...(published ?? {}),
    ...(draft ?? {})
  };
}

/** 导出不含敏感数据的设置快照（用于导入导出）。 */
export function toExportableSettings(values: ThemeSettingValues): ThemeSettingValues {
  const blocked = /(secret|token|password|key)$/i;
  const output: ThemeSettingValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (blocked.test(key)) continue;
    output[key] = value;
  }
  return output;
}
