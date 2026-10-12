/**
 * 主题声明的「内容自定义字段」——**值级校验与读取过滤**。
 *
 * 为什么放在 `@ricenote/shared` 而不是 Core：真正需要它的两处是**内容插件**
 * （文章与页面）的保存与 ViewModel 构造，而插件只能依赖 `@ricenote/shared`
 * 与 `@ricenote/plugin-sdk`，不依赖宿主 Core。字段的**声明**则通过
 * `core.theme@1` 服务取得 —— 校验逻辑纯函数、声明数据由宿主下发，
 * 两边都不会出现第二份实现。
 *
 * 设计口径：
 * - **fail-closed**：写入只接受声明的键；未声明的键**报错而不是静默丢弃**
 *   （静默丢弃会让作者以为"填了却没生效"）；
 * - **空值不落库**：空字符串与空数组一律视作"未填写"，模板侧 `{% if %}` 自然为假，
 *   避免空串覆盖主题想表达的缺省；
 * - **读取按声明过滤**：换主题后旧键仍留在 JSON 里，但不再暴露给模板。
 */

import { ErrorCode, RiceNoteError } from './errors.js';
import type { ContentFieldsSchema, SettingFieldSchema, ValidationIssue } from './manifests.js';

/** 单条内容字段的合法类型（与设置表单完全一致）。 */
const FIELD_TYPES = [
  'text',
  'textarea',
  'color',
  'boolean',
  'number',
  'select',
  'image',
  'url',
  'stringList'
] as const;

/** 主题是否声明了内容字段。 */
export function hasContentFields(fields?: ContentFieldsSchema): boolean {
  return fields !== undefined && Object.keys(fields).length > 0;
}

/** 字段类型白名单（供后台渲染端与校验共用）。 */
export function isContentFieldType(value: string): boolean {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

function typeMismatch(key: string, expected: string): ValidationIssue {
  return { path: `/fields/${key}`, message: `字段 ${key} 需要 ${expected}`, keyword: 'type' };
}

interface FieldCheck {
  value?: unknown;
  empty?: boolean;
  issue?: ValidationIssue;
}

function validateOneField(key: string, field: SettingFieldSchema, raw: unknown): FieldCheck {
  switch (field.type) {
    case 'boolean': {
      if (typeof raw !== 'boolean') return { issue: typeMismatch(key, '布尔值') };
      return { value: raw };
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return { issue: typeMismatch(key, '数字') };
      }
      if (field.min !== undefined && raw < field.min) {
        return {
          issue: {
            path: `/fields/${key}`,
            message: `字段 ${key} 不能小于 ${field.min}`,
            keyword: 'minimum'
          }
        };
      }
      if (field.max !== undefined && raw > field.max) {
        return {
          issue: {
            path: `/fields/${key}`,
            message: `字段 ${key} 不能大于 ${field.max}`,
            keyword: 'maximum'
          }
        };
      }
      return { value: raw };
    }
    case 'stringList': {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
        return { issue: typeMismatch(key, '字符串数组') };
      }
      const list = (raw as string[]).map((item) => item.trim()).filter((item) => item.length > 0);
      if (list.length === 0) return { empty: true };
      if (field.maxItems !== undefined && list.length > field.maxItems) {
        return {
          issue: {
            path: `/fields/${key}`,
            message: `字段 ${key} 最多 ${field.maxItems} 项`,
            keyword: 'maxItems'
          }
        };
      }
      return { value: list };
    }
    case 'select': {
      if (typeof raw !== 'string') return { issue: typeMismatch(key, '字符串') };
      const value = raw.trim();
      if (value.length === 0) return { empty: true };
      const allowed = (field.options ?? []).map((option) => option.value);
      if (!allowed.includes(value)) {
        return {
          issue: {
            path: `/fields/${key}`,
            message: `字段 ${key} 的取值不在可选范围内：${value}`,
            keyword: 'enum'
          }
        };
      }
      return { value };
    }
    default: {
      // text / textarea / color / url / image 都是字符串
      if (typeof raw !== 'string') return { issue: typeMismatch(key, '字符串') };
      const value = raw.trim();
      if (value.length === 0) return { empty: true };
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return {
          issue: {
            path: `/fields/${key}`,
            message: `字段 ${key} 最长 ${field.maxLength} 个字符`,
            keyword: 'maxLength'
          }
        };
      }
      return { value };
    }
  }
}

/**
 * 校验并归一化提交上来的字段值。
 *
 * 调用方拿到 `issues` 后**必须拒绝保存**（用 `assertContentFieldValues` 最省事），
 * 而不是"过滤掉坏值继续写" —— 后者会让作者以为保存成功了。
 */
export function validateContentFieldValues(
  fields: ContentFieldsSchema | undefined,
  input: unknown
): { values: Record<string, unknown>; issues: ValidationIssue[] } {
  const declared = fields ?? {};
  const issues: ValidationIssue[] = [];

  if (input === undefined || input === null) return { values: {}, issues };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      values: {},
      issues: [{ path: '/fields', message: 'fields 必须是对象', keyword: 'type' }]
    };
  }

  const source = input as Record<string, unknown>;
  const values: Record<string, unknown> = {};

  for (const key of Object.keys(source)) {
    if (!(key in declared)) {
      issues.push({
        path: `/fields/${key}`,
        message: `未声明的内容字段：${key}（当前主题未声明它，可能是字段名写错或主题已更换）`,
        keyword: 'additionalProperties'
      });
    }
  }

  for (const [key, field] of Object.entries(declared)) {
    if (!(key in source)) continue;
    const check = validateOneField(key, field, source[key]);
    if (check.issue) {
      issues.push(check.issue);
      continue;
    }
    if (check.empty) continue;
    values[key] = check.value;
  }

  return { values, issues };
}

/** 校验失败即抛错（供内容插件的保存路径复用）。 */
export function assertContentFieldValues(
  fields: ContentFieldsSchema | undefined,
  input: unknown
): Record<string, unknown> {
  const { values, issues } = validateContentFieldValues(fields, input);
  if (issues.length > 0) {
    throw new RiceNoteError(
      ErrorCode.VALIDATION_FAILED,
      `内容字段校验未通过：${issues.map((issue) => issue.message).join('；')}`,
      { status: 400, details: { issues } }
    );
  }
  return values;
}

/** 读取时按声明过滤（换主题后旧键不再暴露给模板）。 */
export function pickDeclaredContentFields(
  fields: ContentFieldsSchema | undefined,
  stored: unknown
): Record<string, unknown> {
  if (!fields || typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  const source = stored as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}
