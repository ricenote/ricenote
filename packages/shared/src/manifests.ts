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
  /**
   * 插件自有配置默认值（扁平「字段名 → 默认值」）。
   *
   * 该字段为**向后兼容**的旧写法，语义自 v1 起未变：
   * 未声明 `settingsSchema` 的插件继续用 `ctx.config.get(key, fallback)` 读取。
   */
  settings?: Record<string, unknown>;
  /**
   * 插件设置的声明式表单定义（分组 + 字段），与主题设置同构。
   *
   * 声明后后台会自动生成设置表单；未声明的字段一律拒绝写入（防越权）。
   * 需要完全自定义界面的插件可改为注册自己的后台设置页。
   */
  settingsSchema?: SettingsSchema;
  /**
   * 插件自带后台界面的声明。
   *
   * 声明后 Core 会：把每页注册为后台菜单入口（按权限过滤）、
   * 托管 `<插件目录>/admin/**`、并把 `entry` 换算成前端可 import 的托管 URL。
   */
  admin?: PluginAdminManifest;
}

/** 插件自带后台界面中的一个页面。 */
export interface PluginAdminPageDeclaration {
  /** 菜单项 ID，全局唯一。 */
  id: string;
  /** 菜单显示名。 */
  label: string;
  /** 后台前端路由路径（`/` 开头，全局唯一，保持既有书签可用）。 */
  path: string;
  /** 图标名（见后台界面 SDK 的受控图标集）。 */
  icon?: string;
  order?: number;
  /** 访问所需权限点；为空表示仅需登录。 */
  permission?: string;
  /** 相对插件目录的界面入口（`.js`，零构建 ESM），例如 `./admin/main.js`。 */
  entry: string;
  /**
   * 可选：插件自带样式（相对插件目录的 `.css`）。
   *
   * 声明后由宿主在页面挂载时注入；**不声明就不加载** —— 避免宿主去"探测"文件是否存在
   * （那会在控制台留下一串 404，看起来像故障）。
   */
  style?: string;
}

export interface PluginAdminManifest {
  pages: PluginAdminPageDeclaration[];
}

export type ThemeSettingFieldType =
  | 'text'
  | 'textarea'
  | 'color'
  | 'boolean'
  | 'number'
  | 'select'
  | 'image'
  | 'url'
  | 'stringList';

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
  /**
   * 文本类字段（`text` / `textarea` / `url`）的长度上限；
   * 对 `stringList` 表示**单项**长度上限。
   */
  maxLength?: number;
  /**
   * `stringList` 专用：列表最多项数（默认 200）。
   *
   * `stringList` 的值在存储与插件侧都是 `string[]`（表单每行一项），
   * 因此插件可以直接 `ctx.config.get<string[]>('blockedKeywords', [])`。
   */
  maxItems?: number;
  placeholder?: LocalizedText;
  options?: ThemeSettingOption[];
}

export interface ThemeSettingGroup {
  label: LocalizedText;
  description?: LocalizedText;
  fields: Record<string, ThemeSettingField>;
}

/**
 * 设置字段与分组的中性别名。
 *
 * 插件设置的 `settingsSchema` 与主题设置的 `settings` 使用**完全同一套结构**，
 * 这样校验与表单渲染两端都只有一份实现（见 `@ricenote/theme-sdk` 的 validator）。
 */
export type SettingFieldSchema = ThemeSettingField;
export type SettingGroupSchema = ThemeSettingGroup;
/** 分组键 → 分组定义。 */
export type SettingsSchema = Record<string, SettingGroupSchema>;

/**
 * 主题声明的「可被内容选择的页面模板」。
 *
 * 键为模板选项键（页面/文章的 `template` 字段存该值），值为模板文件与展示文案。
 * 页面与文章在后台按下拉选择，渲染器按所选模板输出（纯渲染层选择，不改内容）。
 */
export interface PageTemplateDeclaration {
  /** 主题内模板文件名（必须存在于主题 templates 目录），例如 page-landing.njk。 */
  template: string;
  label: LocalizedText;
  description?: LocalizedText;
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
  /**
   * 可供「页面」与「文章」选择的模板清单（键 → 模板声明）。
   *
   * 未声明时对应内容回退到其 kind 模板（页面为 `templates.page`，文章为 `templates.post`）。
   */
  pageTemplates?: Record<string, PageTemplateDeclaration>;
  /** 主题依赖的插件能力契约。 */
  requires?: Record<string, string>;
  settings?: SettingsSchema;
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
