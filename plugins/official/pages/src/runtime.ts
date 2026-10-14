/**
 * pages 插件的运行时容器与视图模型映射。
 *
 * 与 posts 一致的约定：可选依赖（none 目前）在请求期惰性解析，
 * Core 提供的 `core.theme@1` / `core.html@1` 在 `start()` 中一次性取用
 * （Core 服务先于任何插件注册，不存在启动顺序问题）。
 */

import type { PluginDatabase, PluginLogger } from '@ricenote/plugin-sdk';
import {
  pickDeclaredContentFields,
  resolveContentTemplateKey,
  type ContentFieldsSchema,
  type CoreHtmlService,
  type CoreThemeService
} from '@ricenote/shared';
import type { PageRow } from './repository.js';
// 运行时无循环依赖：permalink.ts 只以 type-only 方式引用本模块（编译后擦除）
import { pageUrl } from './permalink.js';

export interface RuntimeServiceResolver {
  tryUse<T>(name: string): T | undefined;
}

export interface PagesRuntime {
  db: PluginDatabase;
  siteId: string;
  /** 列表默认每页条数。 */
  listPageSize: number;
  /** 是否为页面渲染启用 HTML 缓存。 */
  cacheEnabled: boolean;
  html: CoreHtmlService;
  theme: CoreThemeService;
  logger: PluginLogger;
  services: RuntimeServiceResolver;
}

/** 主题中的页面内容视图模型（对应 theme-sdk 的 PageContentContext）。 */
export interface PageContentViewModel {
  id: number;
  title: string;
  slug: string;
  /** 已消毒并标记为受信任的正文 HTML。 */
  html: unknown;
  url: string;
  /**
   * 内容自定义字段的值（键由主题 `contentFields` 声明，例如 `featuredImage`）。
   *
   * 始终是对象（可能为空）：模板里写 `{{ page.fields.featuredImage }}` 无需判空。
   */
  fields: Record<string, unknown>;
  /** 命中的页面模板键（主题声明），未选择时省略。 */
  template?: string;
  publishedAt?: string;
  updatedAt: string;
}

function toIso(value: Date | string, fallback: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

/**
 * 解析 `fields` JSON 列（驱动可能返回 JSON 字符串或已解析对象）。
 *
 * 内容字段只是"锦上添花"的数据：解析失败**不能**让整页渲染失败（500），
 * 因此降级为空对象并留下 warn，便于排查脏数据。
 */
export function decodeStoredFields(
  raw: unknown,
  onInvalid: (message: string, meta: Record<string, unknown>) => void
): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') {
    onInvalid('页面内容字段格式非法，已按空值处理', { type: typeof raw });
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    onInvalid('页面内容字段不是对象，已按空值处理', { type: typeof parsed });
  } catch (error) {
    onInvalid('页面内容字段解析失败，已按空值处理', { error: String(error) });
  }
  return {};
}

/**
 * 读取一行上的内容字段：解析 JSON 后按**当前主题声明**过滤。
 *
 * 过滤放在读取侧：换主题后旧键仍留在 JSON 里，但不再暴露给后台与模板。
 */
export function readContentFields(
  runtime: Pick<PagesRuntime, 'logger'>,
  row: PageRow,
  declared: ContentFieldsSchema
): Record<string, unknown> {
  const stored = decodeStoredFields(row.fields, (message, meta) =>
    runtime.logger.warn(message, { pageId: row.id, ...meta })
  );
  return pickDeclaredContentFields(declared, stored);
}

/**
 * 把数据库行映射为主题视图模型。
 *
 * 本函数保持**同步**：主题声明的字段清单由调用方在请求期 `await` 后传入，
 * 而不是在这里取 —— 声明会随主题切换而变，在构造器里缓存或做异步都会引入额外状态。
 */
export function toPageContentViewModel(
  runtime: PagesRuntime,
  row: PageRow,
  options: { withHtml: boolean; declaredFields: ContentFieldsSchema }
): PageContentViewModel {
  const updatedAt = toIso(row.updated_at, new Date().toISOString());
  const publishedAt = row.published_at ? toIso(row.published_at, updatedAt) : undefined;

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    html: runtime.html.markTrusted(options.withHtml ? row.content_html : ''),
    // 地址由固定链接方案生成（插件未启用时回退内建 `/page/:slug`）
    url: pageUrl(runtime, { id: row.id, slug: row.slug }),
    fields: readContentFields(runtime, row, options.declaredFields),
    ...(row.template ? { template: row.template } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    updatedAt
  };
}

/**
 * 校验内容所选的模板键。
 *
 * 权威来源是**当前主题声明的清单**（`core.theme@1`）：键不在清单内直接拒绝，
 * 否则主题切换后会出现"模板悄悄回退到 fallback"的静默降级，用户看到的
 * 是"选了模板但没生效"，极难排查。
 *
 * 传空值表示"使用主题的默认页面模板"，是合法输入。
 */
export async function resolveTemplateKey(
  runtime: PagesRuntime,
  raw: string | null | undefined
): Promise<string | null> {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const available = await runtime.theme.pageTemplates();
  return resolveContentTemplateKey(raw, available);
}
