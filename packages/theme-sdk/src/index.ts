/**
 * @ricenote/theme-sdk —— 主题作者与 Core 渲染器共享的稳定契约。
 *
 * 主题作者只需要 HTML/CSS 与（可选的）本包提供的类型说明文档；
 * Core 的 Renderer 使用本包的校验器与过滤器实现渲染安全。
 */

export type {
  SiteContext,
  PageContext,
  ThemeContext,
  ViewerContext,
  PostContext,
  PostsContext,
  PageContentContext,
  PaginationContext,
  ThemeRenderContext,
  ThemeAssetHelper,
  UrlHelper,
  SlotHelper,
  HasFeatureHelper,
  ThemeHelpers
} from './helpers.js';

export {
  cssColor,
  isValidCssColor,
  formatDate,
  excerpt,
  toNumber,
  THEME_FILTERS,
  type ThemeFilterName
} from './filters.js';

export {
  flattenFields,
  buildDefaults,
  fallbackForType,
  resolveLocalizedText,
  validateSettings,
  composeSettings,
  toExportableSettings,
  type SettingsValidationResult
} from './validator.js';

/** 当前 Theme API 主版本，与 theme.json 的 apiVersion 区间对齐。 */
export const THEME_API_VERSION = '1.0.0';
