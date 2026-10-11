/**
 * 插件与主题的 Manifest 数据契约。
 *
 * 这些类型是"静态约定"（只描述磁盘上的清单文件），
 * 运行时接口（PluginContext 等）由 @ricenote/plugin-sdk 提供。
 */

/** 插件可请求的内核能力白名单。 */
export type PluginCapability =
  | 'routes:public'
  | 'routes:admin'
  | 'database:own'
  | 'events:publish'
  | 'events:subscribe'
  | 'services:provide'
  | 'services:consume'
  | 'slots:register'
  | 'admin:menu'
  | 'media:store';

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: string;
  author?: string;
  license?: string;
  homepage?: string;
  /** 相对于插件目录的入口模块路径。 */
  entry: string;
  /** 依赖：键为 capability 契约或插件 ID，值为 semver 区间。 */
  requires?: Record<string, string>;
  /** 对外提供的 capability 契约。 */
  provides?: string[];
  capabilities?: PluginCapability[];
  /** 相对于插件目录的迁移目录。 */
  migrations?: string;
  /** 插件自有配置默认值。 */
  settings?: Record<string, unknown>;
}

export type ThemeSettingFieldType =
  | 'text'
  | 'textarea'
  | 'color'
  | 'boolean'
  | 'number'
  | 'select'
  | 'image'
  | 'url';

/**
 * 可本地化的展示文案。
 *
 * 允许两种写法：
 * - 字符串：单语言直接书写，等价于不声明任何语言标签；
 * - 对象：语言标签 → 文案，例如 `{ "zh-CN": "主色", "en": "Accent" }`。
 *
 * 运行时按 `site.language` 解析：精确匹配 → 基础语言（`zh-CN` → `zh`）→ `en` → 首个非空值。
 */
export type LocalizedText = string | Record<string, string>;

export interface ThemeSettingOption {
  label: LocalizedText;
  value: string;
}

export interface ThemeSettingField {
  type: ThemeSettingFieldType;
  label: LocalizedText;
  description?: LocalizedText;
  default?: unknown;
  min?: number;
  max?: number;
  maxLength?: number;
  placeholder?: LocalizedText;
  options?: ThemeSettingOption[];
}

export interface ThemeSettingGroup {
  label: LocalizedText;
  description?: LocalizedText;
  fields: Record<string, ThemeSettingField>;
}

export interface ThemeManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: string;
  engine: 'nunjucks';
  author?: string;
  license?: string;
  screenshot?: string;
  /** 页面类型 → 模板文件名（如 home → index.njk）。 */
  templates: Record<string, string>;
  /** 主题依赖的插件能力契约。 */
  requires?: Record<string, string>;
  settings?: Record<string, ThemeSettingGroup>;
}

/** 主题设置的有效值（扁平化后的字段名 → 值）。 */
export type ThemeSettingValues = Record<string, unknown>;

export interface ValidationIssue {
  path: string;
  message: string;
  keyword?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
