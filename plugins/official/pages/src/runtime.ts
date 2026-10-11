/**
 * pages 插件的运行时容器与视图模型映射。
 *
 * 与 posts 一致的约定：可选依赖（none 目前）在请求期惰性解析，
 * Core 提供的 `core.theme@1` / `core.html@1` 在 `start()` 中一次性取用
 * （Core 服务先于任何插件注册，不存在启动顺序问题）。
 */

import type { PluginDatabase, PluginLogger } from '@ricenote/plugin-sdk';
import {
  resolveContentTemplateKey,
  type CoreHtmlService,
  type CoreThemeService
} from '@ricenote/shared';
import type { PageRow } from './repository.js';

export interface RuntimeServiceResolver {
  tryUse<T>(name: string): T | undefined;
}

export interface PagesRuntime {
  db: PluginDatabase;
  siteId: string;
  /** 前台导航最多输出的页面数。 */
  navLimit: number;
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
  /** 命中的页面模板键（主题声明），未选择时省略。 */
  template?: string;
  publishedAt?: string;
  updatedAt: string;
}

function toIso(value: Date | string, fallback: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

/** 把数据库行映射为主题视图模型。 */
export function toPageContentViewModel(
  runtime: PagesRuntime,
  row: PageRow,
  options: { withHtml: boolean }
): PageContentViewModel {
  const updatedAt = toIso(row.updated_at, new Date().toISOString());
  const publishedAt = row.published_at ? toIso(row.published_at, updatedAt) : undefined;

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    html: runtime.html.markTrusted(options.withHtml ? row.content_html : ''),
    url: `/page/${row.slug}`,
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
