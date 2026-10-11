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
import type { ThemeSettingValues } from '@ricenote/shared';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
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

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** dist/render/renderer.js → ../.. = packages/core ; src/render/renderer.ts → ../.. = packages/core */
const CORE_TEMPLATES_DIR = path.resolve(moduleDir, '..', '..', 'templates');

const SLOT_PLACEHOLDER = /<!--rn-slot:([a-zA-Z0-9_-]+)-->/g;

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
}

export class ThemeRenderer {
  private readonly environments = new Map<string, nunjucks.Environment>();

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
    const cacheKey = HtmlCache.buildKey({
      themeId: theme.manifest.id,
      revision,
      pluginsKey: [...this.deps.enabledCapabilities()].sort().join(','),
      path: `${input.canonicalUrl}|${template}`
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

    const helpers = this.buildHelpers(theme, input, pendingSlots);
    const context = buildTemplateContext({
      site: {
        id: this.deps.config.site.id,
        title: this.deps.config.site.title,
        description: this.deps.config.site.description,
        url: this.deps.config.http.siteUrl,
        language: this.deps.config.site.language
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
    return absoluteUrl(this.deps.config.http.siteUrl, pathname);
  }

  /* --------------------------- 内部 --------------------------- */

  private resolveTemplate(theme: LoadedTheme, kind: string, explicit?: string): string {
    if (explicit && this.templateExists(theme, explicit)) return explicit;

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
    input: RenderInput,
    pendingSlots: { id: string; name: string; data: Record<string, unknown> }[]
  ): Record<string, unknown> {
    const registeredSlotNames = new Set(this.deps.slots.list().map((item) => item.slot));
    let slotSequence = 0;

    return {
      theme_asset: (relativePath: string): string => {
        const clean = String(relativePath).replace(/^\/+/, '');
        return `/theme-assets/${theme.manifest.id}/${clean}?v=${encodeURIComponent(theme.manifest.version)}`;
      },
      url: (routeName: string, params: Record<string, string | number> = {}): string =>
        this.deps.router.resolveUrl(routeName, params),
      // 支持短名（`posts`）、全名（`content.posts`）与完整契约（`content.posts@1`）
      has_feature: (capability: string): boolean =>
        capabilityMatches(this.deps.enabledCapabilities(), capability),
      site_url: (pathname = '/'): string => absoluteUrl(this.deps.config.http.siteUrl, pathname),
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
