/**
 * Nunjucks 渲染器。
 *
 * 职责：
 * - 组装 Nunjucks 环境（主题模板目录 + Core 内置模板目录）；
 * - 注入受控 helper 与过滤器；
 * - 模板三级回退：显式模板 → 主题 kind 模板 → 主题 fallback.njk → Core fallback.njk；
 * - Slot 采用"占位符 + 渲染后替换"策略，从而在 Nunjucks 的同步渲染模型中
 *   依然支持异步 Slot 组件与每次调用的独立数据；
 * - HTML 缓存与标签失效。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import type { HttpRequestLike, SlotRenderContext } from '@ricenote/plugin-sdk';
import type { PaginationContext } from '@ricenote/theme-sdk';
import { THEME_FILTERS } from '@ricenote/theme-sdk';
import type { EffectiveSiteInfo, ThemeSettingValues } from '@ricenote/shared';
import { ErrorCode, RiceNoteError, shortcodeRuntimeUrl } from '@ricenote/shared';
import type { Logger } from '../logger.js';
import type { RiceNoteConfig } from '../config/loader.js';
import type { ThemeManager, LoadedTheme } from '../themes/manager.js';
import type { SlotRegistry } from './slots.js';
import type { RouterRegistry } from '../routing/registry.js';
import { absoluteUrl } from '../routing/url.js';
import { HtmlCache } from './cache.js';
import { TrustedHtml } from './safe-html.js';
import { buildTemplateContext, viewerFromRequest } from './context.js';
import { capabilityMatches } from '../capabilities.js';
import { APP_VERSION } from '../version.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** dist/render/renderer.js → ../.. = packages/core ; src/render/renderer.ts → ../.. = packages/core */
const CORE_TEMPLATES_DIR = path.resolve(moduleDir, '..', '..', 'templates');

const SLOT_PLACEHOLDER = /<!--rn-slot:([a-zA-Z0-9_-]+)-->/g;

/**
 * 提取并规范化请求查询串，用作 HTML 缓存的区分维度。
 *
 * 参数按键名排序，使 `?a=1&b=2` 与 `?b=2&a=1` 命中同一缓存条目。
 */
export function queryKeyOf(url: string | undefined): string {
  if (!url) return '';
  const start = url.indexOf('?');
  if (start < 0) return '';

  const raw = url.slice(start + 1).split('#')[0] ?? '';
  if (raw.length === 0) return '';

  const pairs = [...new URLSearchParams(raw).entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return pairs.map(([key, value]) => `${key}=${value}`).join('&');
}

export interface RenderInput {
  kind: string;
  title: string;
  canonicalUrl: string;
  data: Record<string, unknown>;
  template?: string;
  status?: number;
  request?: HttpRequestLike;
  pagination?: PaginationContext;
  /** 后台预览草稿（公众请求必须为空）。 */
  draftSettings?: ThemeSettingValues;
  cacheTags?: string[];
  cacheable?: boolean;
}

export interface RenderOutput {
  html: string;
  status: number;
  fromCache: boolean;
  themeId: string;
  template: string;
}

export interface ThemeRendererDeps {
  config: RiceNoteConfig;
  logger: Logger;
  themeManager: ThemeManager;
  slots: SlotRegistry;
  router: RouterRegistry;
  cache: HtmlCache;
  /** 返回当前实际启用的 capability 契约列表（用于 has_feature 与缓存键）。 */
  enabledCapabilities: () => string[];
  /**
   * 生效中的站点信息（env 默认值 + 后台覆盖）。
   *
   * 必须动态读取：后台改站点标题/地址后要**立即**反映到页面上，
   * 不能使用启动期快照。缺省时回落到 `.env` 配置。
   */
  siteInfo?: () => EffectiveSiteInfo;
}

export class ThemeRenderer {
  private readonly environments = new Map<string, nunjucks.Environment>();
  /** 已告警过的缺失路由名，避免每页渲染都刷日志。 */
  private readonly missingRoutes = new Set<string>();

  constructor(private readonly deps: ThemeRendererDeps) {}

  /** 渲染页面。 */
  async render(input: RenderInput): Promise<RenderOutput> {
    const theme = await this.deps.themeManager.getActive();
    const { values: settings, revision } = await this.deps.themeManager.resolveSettings(
      theme,
      input.draftSettings
    );

    const template = this.resolveTemplate(theme, input.kind, input.template);
    const cacheable = input.cacheable !== false && !input.draftSettings;
    /**
     * 缓存键 = canonicalUrl + **请求查询串** + 模板。
     *
     * 必须纳入查询串：页面内容可能随查询变化（评论分页 `?commentPage=2`、
     * 表单提交后的 `?comment=pending` 提示），若只按路径缓存，
     * 这些状态会错误地命中同一个缓存条目。
     */
    const cacheKey = HtmlCache.buildKey({
      themeId: theme.manifest.id,
      revision,
      siteRevision: this.siteInfo().revision,
      pluginsKey: [...this.deps.enabledCapabilities()].sort().join(','),
      path: `${input.canonicalUrl}|${queryKeyOf(input.request?.url)}|${template}`
    });

    if (cacheable) {
      const cached = this.deps.cache.get(cacheKey);
      if (cached !== undefined) {
        return {
          html: cached,
          status: input.status ?? 200,
          fromCache: true,
          themeId: theme.manifest.id,
          template
        };
      }
    }

    const environment = this.getEnvironment(theme);
    const pendingSlots: { id: string; name: string; data: Record<string, unknown> }[] = [];

    const site = this.siteInfo();
    const helpers = this.buildHelpers(theme, pendingSlots, site);
    const context = buildTemplateContext({
      site: {
        id: site.siteId,
        title: site.title,
        description: site.description,
        url: site.url,
        language: site.language,
        ...(site.logoUrl ? { logoUrl: site.logoUrl } : {}),
        ...(site.faviconUrl ? { faviconUrl: site.faviconUrl } : {}),
        ...(site.icpText ? { icpText: site.icpText } : {}),
        ...(site.icpUrl ? { icpUrl: site.icpUrl } : {})
      },
      theme: {
        id: theme.manifest.id,
        name: theme.manifest.name,
        version: theme.manifest.version,
        settings
      },
      page: { kind: input.kind, title: input.title, canonicalUrl: input.canonicalUrl },
      data: input.data,
      ...(viewerFromRequest(input.request) ? { viewer: viewerFromRequest(input.request) } : {}),
      ...(input.pagination ? { pagination: input.pagination } : {}),
      ...(input.request ? { request: input.request } : {})
    });

    let html: string;
    try {
      html = environment.render(template, {
        ...(toSafeValue(context) as Record<string, unknown>),
        ...helpers
      });
    } catch (error) {
      this.deps.logger.error('模板渲染失败', {
        theme: theme.manifest.id,
        template,
        kind: input.kind,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new RiceNoteError(
        ErrorCode.THEME_INVALID,
        `模板渲染失败：${template}（${error instanceof Error ? error.message : String(error)}）`,
        { status: 500, cause: error, details: { theme: theme.manifest.id, template } }
      );
    }

    html = await this.replaceSlotPlaceholders(html, pendingSlots, input);

    if (cacheable) {
      this.deps.cache.set(cacheKey, html, input.cacheTags ?? []);
    }

    return {
      html,
      status: input.status ?? 200,
      fromCache: false,
      themeId: theme.manifest.id,
      template
    };
  }

  /** 按标签失效缓存（内容更新后调用）。 */
  invalidate(tags: string[]): number {
    return this.deps.cache.invalidateTags(tags);
  }

  /** 构造渲染预览用的绝对地址。 */
  absolute(pathname: string): string {
    return absoluteUrl(this.siteInfo().url, pathname);
  }

  /* --------------------------- 内部 --------------------------- */

  /** 生效中的站点信息（缺省时由 `.env` 配置兜底）。 */
  private siteInfo(): EffectiveSiteInfo {
    const fromProvider = this.deps.siteInfo?.();
    if (fromProvider) return fromProvider;

    const { config } = this.deps;
    return {
      siteId: config.site.id,
      title: config.site.title,
      description: config.site.description,
      language: config.site.language,
      url: config.http.siteUrl,
      revision: 0,
      overridden: []
    };
  }

  /**
   * 模板回退链：显式模板 → 主题 kind 模板 → 主题 fallback.njk → Core fallback.njk。
   *
   * 显式模板支持两种写法：
   * - **模板键**：主题 `pageTemplates` 声明的键（页面/文章存的就是这个）；
   * - **模板文件名**：`foo.njk` 形式的直接指定（保持既有插件行为兼容）。
   *
   * 两种写法都必须落在主题模板目录内的 `.njk` 文件上，
   * 因此不存在通过构造模板名读取任意文件或目录穿越的可能。
   */
  private resolveTemplate(theme: LoadedTheme, kind: string, explicit?: string): string {
    const fromKey = this.deps.themeManager.resolvePageTemplate(theme, explicit);
    if (fromKey) return fromKey;

    if (explicit && isSafeTemplateName(explicit) && this.templateExists(theme, explicit)) {
      return explicit;
    }

    const declared = theme.manifest.templates[kind];
    if (declared && this.templateExists(theme, declared)) return declared;

    if (this.templateExists(theme, 'fallback.njk')) return 'fallback.njk';

    // Core 内置模板始终存在
    return 'fallback.njk';
  }

  private templateExists(theme: LoadedTheme, name: string): boolean {
    if (existsSync(path.join(theme.templatesDir, name))) return true;
    return existsSync(path.join(CORE_TEMPLATES_DIR, name));
  }

  private getEnvironment(theme: LoadedTheme): nunjucks.Environment {
    const key = `${theme.manifest.id}@${theme.manifest.version}`;
    const cached = this.environments.get(key);
    if (cached) return cached;

    const loader = new nunjucks.FileSystemLoader([theme.templatesDir, CORE_TEMPLATES_DIR], {
      noCache: false,
      watch: false
    });

    const environment = new nunjucks.Environment(loader, {
      autoescape: true,
      throwOnUndefined: false,
      trimBlocks: false,
      lstripBlocks: false
    });

    for (const [name, filter] of Object.entries(THEME_FILTERS)) {
      environment.addFilter(name, filter as (...args: unknown[]) => unknown);
    }
    environment.addFilter('json', (value: unknown) => JSON.stringify(value ?? null));

    this.environments.set(key, environment);
    // 简单的环境缓存上限控制
    if (this.environments.size > 8) {
      const oldest = [...this.environments.keys()][0];
      if (oldest && oldest !== key) this.environments.delete(oldest);
    }
    return environment;
  }

  private buildHelpers(
    theme: LoadedTheme,
    pendingSlots: { id: string; name: string; data: Record<string, unknown> }[],
    site: EffectiveSiteInfo
  ): Record<string, unknown> {
    const registeredSlotNames = new Set(this.deps.slots.list().map((item) => item.slot));
    let slotSequence = 0;

    return {
      theme_asset: (relativePath: string): string => {
        const clean = String(relativePath).replace(/^\/+/, '');
        return `/theme-assets/${theme.manifest.id}/${clean}?v=${encodeURIComponent(theme.manifest.version)}`;
      },
      /**
       * 按路由名生成 URL。
       *
       * 未注册时**不抛错**：模板可能引用可选插件提供的路由（例如 search 插件被禁用时的
       * `url('search')`），此时整页渲染不应失败（说明书：禁用插件必须优雅降级）。
       * 降级为 `#` 并在日志中告警一次，便于主题作者发现拼写错误。
       */
      url: (routeName: string, params: Record<string, string | number> = {}): string => {
        try {
          return this.deps.router.resolveUrl(routeName, params);
        } catch (error) {
          if (!this.missingRoutes.has(routeName)) {
            this.missingRoutes.add(routeName);
            this.deps.logger.warn('模板引用了未注册的路由名，已降级为 #', {
              route: routeName,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
          return '#';
        }
      },
      // 支持短名（`posts`）、全名（`content.posts`）与完整契约（`content.posts@1`）
      has_feature: (capability: string): boolean =>
        capabilityMatches(this.deps.enabledCapabilities(), capability),
      site_url: (pathname = '/'): string => absoluteUrl(site.url, pathname),
      /**
       * 短代码引擎的脚本标签。
       *
       * 引擎在前台解析正文里的短代码标记，具体展示由主题用
       * `RiceNoteShortcodes.define()` 定义；主题不引入它时短代码原样显示为文字。
       * 返回值标记为安全字符串，否则 Nunjucks 的自动转义会把标签转义掉。
       */
      shortcode_runtime: (): nunjucks.runtime.SafeString =>
        new nunjucks.runtime.SafeString(
          `<script src="${shortcodeRuntimeUrl(APP_VERSION)}" defer></script>`
        ),
      slot: (slotName: string, data: Record<string, unknown> = {}): nunjucks.runtime.SafeString => {
        if (!registeredSlotNames.has(slotName)) {
          // 未注册的插槽输出空片段，避免模板出现占位符残留
          return new nunjucks.runtime.SafeString('');
        }
        const id = `s${++slotSequence}`;
        pendingSlots.push({ id, name: slotName, data });
        return new nunjucks.runtime.SafeString(`<!--rn-slot:${id}-->`);
      }
    };
  }

  /** 把占位符替换为真实 Slot 片段。 */
  private async replaceSlotPlaceholders(
    html: string,
    pending: { id: string; name: string; data: Record<string, unknown> }[],
    input: RenderInput
  ): Promise<string> {
    if (pending.length === 0) {
      return html;
    }

    const fragments = new Map<string, string>();
    for (const entry of pending) {
      const context: SlotRenderContext = {
        kind: input.kind,
        data: { ...input.data, ...entry.data },
        ...(input.request ? { request: input.request } : {})
      };
      fragments.set(entry.id, await this.deps.slots.render(entry.name, context));
    }

    return html.replace(SLOT_PLACEHOLDER, (match, id: string) => fragments.get(id) ?? match);
  }
}

/**
 * 模板文件名安全校验。
 *
 * 只允许"不含路径分隔符的 .njk 文件名"，因此即使模板值来自数据库，
 * 也无法借此跳出主题模板目录（目录穿越防护）。
 */
function isSafeTemplateName(name: string): boolean {
  return /^[^/\\]+\.njk$/.test(name) && !name.includes('..');
}

/** 递归把 TrustedHtml 转为 Nunjucks 安全值，其余值原样保留。 */
function toSafeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (value instanceof TrustedHtml) return new nunjucks.runtime.SafeString(value.value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => toSafeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return value;
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      output[key] = toSafeValue(inner, depth + 1);
    }
    return output;
  }
  return value;
}
