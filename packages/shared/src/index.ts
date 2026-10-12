/**
 * @ricenote/shared —— Core、插件、主题与前端共享的稳定契约。
 *
 * 该包只包含类型、常量与纯函数工具，不依赖任何运行时框架，
 * 因此可以被服务端、CLI 与浏览器端同时引用。
 */

export * from './errors.js';
export * from './capability.js';
export * from './slug.js';
export * from './content-template.js';
export * from './url.js';
export * from './embed.js';
export * from './manifests.js';
export * from './localized-text.js';
export * from './content-fields.js';
export * from './types/dto.js';
export * from './types/services.js';
export * from './types/catalog.js';
export {
  createManifestValidator,
  getPluginSchema,
  getThemeSchema,
  getSettingsSchema,
  resolveManifestPath,
  type ManifestValidator
} from './validation.js';
export {
  getPluginCatalog,
  findCatalogEntryById,
  findCatalogEntryByNpm,
  catalogPackageNames,
  requiredCatalogEntries,
  defaultSelectedEntries,
  withRequiredDependencies,
  resetCatalogCache
} from './catalog.js';
