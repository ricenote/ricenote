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
  | 'media:store'
  /*
   * 命名扩展点（v0.5.0）：
   * - declare：声明自己的挂载点供别的插件接入；
   * - contribute：向（自己的或别人的）扩展点贡献内容——**会执行贡献方代码**，
   *   因此与"只读"能力分开授权。
   * `slots:register` 继续作为 render 作用域贡献的别名能力，既有插件无需改动。
   */
  | 'extensions:declare'
  | 'extensions:contribute';

/* --------------------------- 命名扩展点（清单层） --------------------------- */

/** 扩展点作用域：后台界面 / 站点渲染 / 服务端钩子。 */
export type ExtensionScope = 'admin' | 'render' | 'server';

/** 贡献模式：追加（默认）或替换（接管该扩展点）。 */
export type ExtensionMode = 'append' | 'replace';

/** 扩展点契约文档的一项（告诉贡献者会收到什么）。 */
export interface ExtensionPointProp {
  name: string;
  description: string;
}

/**
 * 提供方声明：本插件对外暴露哪些扩展点。
 *
 * 定义放在 shared 而不是 plugin-sdk：清单层与运行时层必须共用同一份形状，
 * 否则两侧的字段会各自漂移（plugin-sdk 再导出它，插件作者依然只依赖 SDK）。
 */
export interface PluginExtensionPointDeclaration {
  name: string;
  scope: ExtensionScope;
  replaceable?: boolean;
  description?: string;
  props?: ExtensionPointProp[];
}

/** 消费方声明：向某个扩展点贡献内容。 */
export interface PluginExtensionContributionDeclaration {
  point: string;
  scope: ExtensionScope;
  mode?: ExtensionMode;
  order?: number;
  entry: string;
  style?: string;
  permission?: string;
  label?: string;
}

/**
 * 权限点声明：本插件**拥有**哪些权限点。
 *
 * 权限点是"谁声明、谁展示、谁校验"的三方约定：
 * - **声明**：拥有它的插件（本字段）或 Core（内核自有的控制面权限点）；
 * - **展示**：权限管理界面（authorization 插件消费 Core 聚合后的结果）；
 * - **校验**：Core 的安全网关按字符串比对，**不依赖**声明 ——
 *   因此未声明的权限点仍然可用，只是会被标记为「未登记」并给出警告（宽松策略）。
 */
export interface PluginPermissionDeclaration {
  /** 权限点标识，形如 `post.publish`（`<域>.<动作>`），全局唯一。 */
  key: string;
  /** 展示名。 */
  label: LocalizedText;
  /** 权限管理界面里的分组名。 */
  group: LocalizedText;
}

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
  /**
   * 对外暴露的扩展点（v0.5.0）：别的插件据此向本插件的界面/流程接入。
   *
   * 声明只描述"契约"（名字、作用域、可替换性、会传什么），
   * 真正的挂载由插件自己的界面或流程决定。
   */
  extensionPoints?: PluginExtensionPointDeclaration[];
  /**
   * 向扩展点贡献内容（声明式）。
   *
   * 随插件启停自动生效、可被 `pnpm validate` 静态校验；
   * 需要运行时动态判定时才改用 `ctx.extensions`。
   */
  contributions?: PluginExtensionContributionDeclaration[];
  /**
   * 本插件拥有的权限点声明。
   *
   * 只描述"标识 + 展示文案 + 分组"与归属，**鉴权不依赖它**：
   * Core 仍按标识字符串比对，未声明的标识照旧可用（但会被标记为「未登记」并告警）。
   * Core 会校验标识格式与**全局唯一性**（跨插件重复声明直接启动失败）。
   */
  permissions?: PluginPermissionDeclaration[];
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
  /**
   * 为 `true` 时**只注册路由、不出现在侧栏**。
   *
   * 用于"由列表页跳转进入"的页面（如文章/页面的独立编辑页）：
   * 路由仍会注册（深链可解析、可刷新），只是不占侧栏位置。
   */
  hidden?: boolean;
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
/**
 * 内容自定义字段的声明形状（v0.5.0）。
 *
 * **文章与页面共用同一份**：主题声明一次，两个编辑页都按它生成控件。
 * 复用设置表单的字段定义（`SettingFieldSchema`），因此类型、范围、多语言文案
 * 与校验逻辑都只有一份实现。
 */
export type ContentFieldsSchema = Record<string, SettingFieldSchema>;
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
  /**
   * 内容自定义字段（v0.5.0）：**文章与页面共用**的字段声明。
   *
   * 主题按自己的版式需要声明字段（例如特色图片），作者在文章/页面编辑页填写，
   * 模板通过 `{{ post.fields.<key> }}` 读取。只声明键、不声明值；
   * 未声明的键一律拒绝写入（防越权），读取时也按声明过滤（脏数据不进模板）。
   */
  contentFields?: ContentFieldsSchema;
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
