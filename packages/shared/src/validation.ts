/**
 * Manifest 校验器：基于 JSON Schema（Ajv）对插件/主题清单做结构与取值校验。
 *
 * Schema 文件位于包根目录的 `manifests/`，因此无论从 `src/`（tsx 直跑）
 * 还是 `dist/`（编译产物）引用，相对路径都能正确解析。
 *
 * 注意：`ajv` 为 CJS 包且以命名导出暴露类，因此必须使用 `{ Ajv }` 具名导入；
 * `ajv-formats` 则以 `module.exports = formatsPlugin` 导出函数，使用默认导入。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats';
import type { ValidationIssue, ValidationResult } from './manifests.js';

const addFormats = addFormatsImport as unknown as FormatsPlugin;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** 兼容 `src/` 与 `dist/` 两种目录深度，逐个候选探测 Schema 文件。 */
function resolveSchemaPath(fileName: string): string {
  const candidates = [
    path.resolve(moduleDir, '..', 'manifests', fileName),
    path.resolve(moduleDir, '..', '..', 'manifests', fileName)
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`未找到 Manifest Schema 文件：${fileName}（已尝试 ${candidates.join(', ')}）`);
}

let pluginSchemaCache: Record<string, unknown> | undefined;
let themeSchemaCache: Record<string, unknown> | undefined;

/** 读取插件 Manifest JSON Schema。 */
export function getPluginSchema(): Record<string, unknown> {
  if (!pluginSchemaCache) {
    pluginSchemaCache = JSON.parse(
      readFileSync(resolveSchemaPath('plugin.schema.json'), 'utf8')
    ) as Record<string, unknown>;
  }
  return pluginSchemaCache;
}

/** 读取主题 Manifest JSON Schema。 */
export function getThemeSchema(): Record<string, unknown> {
  if (!themeSchemaCache) {
    themeSchemaCache = JSON.parse(
      readFileSync(resolveSchemaPath('theme.schema.json'), 'utf8')
    ) as Record<string, unknown>;
  }
  return themeSchemaCache;
}

function mapErrors(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((error) => ({
    path: error.instancePath === '' ? '/' : error.instancePath,
    message: error.message ?? '校验失败',
    keyword: error.keyword
  }));
}

export interface ManifestValidator {
  validatePlugin(manifest: unknown): ValidationResult;
  validateTheme(manifest: unknown): ValidationResult;
}

/** 创建 Ajv 校验器实例（关闭严格模式以兼容 `if/then` 与 `additionalProperties` 组合）。 */
export function createManifestValidator(): ManifestValidator {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true
  });
  addFormats(ajv);

  let pluginValidate: ValidateFunction | undefined;
  let themeValidate: ValidateFunction | undefined;

  return {
    validatePlugin(manifest: unknown): ValidationResult {
      if (!pluginValidate) {
        pluginValidate = ajv.compile(getPluginSchema());
      }
      const compiled = pluginValidate;
      const ok = compiled(manifest) === true;
      return { valid: ok, issues: ok ? [] : mapErrors(compiled.errors) };
    },
    validateTheme(manifest: unknown): ValidationResult {
      if (!themeValidate) {
        themeValidate = ajv.compile(getThemeSchema());
      }
      const compiled = themeValidate;
      const ok = compiled(manifest) === true;
      return { valid: ok, issues: ok ? [] : mapErrors(compiled.errors) };
    }
  };
}
