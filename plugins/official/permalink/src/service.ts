/**
 * 固定链接方案服务的实现（`permalink.routes@1`）。
 *
 * 全部是**同步、无 IO** 的字符串操作：方案在插件启动末段就已编译完毕，
 * 请求期只做拼接与剥离，因此它可以被列表页、订阅源、站点地图等热路径直接调用。
 *
 * 失败策略：任何一步失败都返回 `undefined` 而不是抛错 —— 调用方（内容插件）
 * 会回退到自己的内建默认路径，保证"插件出问题不会把前台链接打断"。
 *
 * 方案清单以**取值函数**传入（而不是数组快照）：第三方通过扩展点贡献的方案
 * 要在"全部插件启动完成后"才收集得到，届时会整体替换，而服务句柄已经发给别人了。
 */

import type {
  CompiledPathTemplate,
  PermalinkRoutesService,
  PermalinkSchemeInfo,
  PermalinkTokenDeclaration,
  PermalinkTokenInfo
} from '@ricenote/shared';
import type { PluginLogger } from '@ricenote/plugin-sdk';

/** 一个已解析（模板已编译）的方案。 */
export interface ResolvedPermalinkScheme {
  id: string;
  label: string;
  routeName: string;
  /** 生效模板（后台配置值或默认模板）。 */
  template: string;
  defaultTemplate: string;
  presets: { label: string; template: string }[];
  /** 方案自带参数 + 适用于本方案的第三方参数。 */
  tokens: PermalinkTokenInfo[];
  /** 生效模板的编译结果。 */
  compiled: CompiledPathTemplate;
  /** 默认模板的编译结果（第三方参数取不到值时的回退目标）。 */
  fallback: CompiledPathTemplate;
}

export interface PermalinkServiceDeps {
  /** 当前生效的方案清单（装配完成前后会整体替换）。 */
  schemes(): ResolvedPermalinkScheme[];
  /** 第三方贡献的参数（可能适用于多个方案）。 */
  tokens(): PermalinkTokenDeclaration[];
  logger: PluginLogger;
}

export function createPermalinkService(deps: PermalinkServiceDeps): PermalinkRoutesService {
  let cachedSchemes: ResolvedPermalinkScheme[] | undefined;
  let byId = new Map<string, ResolvedPermalinkScheme>();
  /** 已经告警过的 (方案, 参数)，避免每次请求都刷日志。 */
  const warned = new Set<string>();

  const lookup = (schemeId: string): ResolvedPermalinkScheme | undefined => {
    const schemes = deps.schemes();
    if (cachedSchemes !== schemes) {
      cachedSchemes = schemes;
      byId = new Map(schemes.map((scheme) => [scheme.id, scheme]));
    }
    return byId.get(schemeId);
  };

  const warnOnce = (schemeId: string, token: string, message: string): void => {
    const key = `${schemeId}:${token}`;
    if (warned.has(key)) return;
    warned.add(key);
    deps.logger.warn(message, { scheme: schemeId, token });
  };

  /** 本方案生效模板里实际用到的第三方参数。 */
  const contributedTokensOf = (scheme: ResolvedPermalinkScheme): PermalinkTokenDeclaration[] =>
    deps
      .tokens()
      .filter(
        (token) =>
          scheme.compiled.tokens.includes(token.token) &&
          (!token.schemes || token.schemes.includes(scheme.id))
      );

  /** 第三方参数取不到值时的回退：用方案默认模板，保证永远不产出坏链接。 */
  const buildFallback = (
    scheme: ResolvedPermalinkScheme,
    values: Record<string, string | number>
  ): string | undefined => {
    try {
      return scheme.fallback.build(values);
    } catch {
      return undefined;
    }
  };

  return {
    schemes(): PermalinkSchemeInfo[] {
      return deps.schemes().map((scheme) => ({
        id: scheme.id,
        label: scheme.label,
        routeName: scheme.routeName,
        template: scheme.template,
        defaultTemplate: scheme.defaultTemplate,
        presets: scheme.presets.map((preset) => ({ ...preset })),
        tokens: scheme.tokens.map((token) => ({ ...token }))
      }));
    },

    template(schemeId) {
      return lookup(schemeId)?.template;
    },

    tokens(schemeId) {
      return (lookup(schemeId)?.tokens ?? []).map((token) => ({ ...token }));
    },

    uses(schemeId, token) {
      return lookup(schemeId)?.compiled.tokens.includes(token) ?? false;
    },

    extract(schemeId, params) {
      const scheme = lookup(schemeId);
      if (!scheme) return undefined;

      const raw = scheme.compiled.extract(params);
      if (!raw) return undefined;

      for (const token of contributedTokensOf(scheme)) {
        const value = raw[token.token];
        if (value === undefined || !token.match) continue;
        if (!token.match({ scheme: schemeId, value })) return undefined;
      }

      return raw;
    },

    build(schemeId, values, options) {
      const scheme = lookup(schemeId);
      if (!scheme) return undefined;

      const merged: Record<string, string | number> = { ...values };

      for (const token of contributedTokensOf(scheme)) {
        if (merged[token.token] !== undefined) continue;

        let resolved: string | undefined;
        try {
          resolved = token.resolve({ scheme: schemeId, values: merged, request: options?.request });
        } catch (error) {
          warnOnce(
            schemeId,
            token.token,
            `固定链接参数 {${token.token}} 取值时出错，已回退默认路径：${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return buildFallback(scheme, values);
        }

        if (typeof resolved !== 'string' || resolved.length === 0) {
          warnOnce(
            schemeId,
            token.token,
            `固定链接参数 {${token.token}} 本次取不到值，已回退默认路径`
          );
          return buildFallback(scheme, values);
        }

        merged[token.token] = resolved;
      }

      try {
        return scheme.compiled.build(merged);
      } catch (error) {
        deps.logger.warn('固定链接地址生成失败', {
          scheme: schemeId,
          error: error instanceof Error ? error.message : String(error)
        });
        return undefined;
      }
    }
  };
}
