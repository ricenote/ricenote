/**
 * 方案装配：把「声明的方案 + 第三方参数 + 后台配置的模板」解析成可直接使用的形态。
 *
 * 全部是纯函数（只额外接受一个 logger 用于告警），因此可以单测：
 * 第三方贡献的形状是不可信输入，这里负责把它们收敛成"可编译或明确跳过"。
 */

import {
  compilePathTemplate,
  validatePathTemplate,
  type CompiledPathTemplate,
  type PermalinkSchemeDeclaration,
  type PermalinkTokenDeclaration,
  type PermalinkTokenInfo
} from '@ricenote/shared';
import type { PluginLogger } from '@ricenote/plugin-sdk';
import { MAX_TEMPLATE_LENGTH, SCHEME_ID_PATTERN } from './config.js';
import type { ResolvedPermalinkScheme } from './service.js';

const TOKEN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const ROUTE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

/** 某个方案可用的全部参数名（方案自带 + 适用的第三方参数）。 */
export function allowedTokensFor(
  declaration: PermalinkSchemeDeclaration,
  tokens: readonly PermalinkTokenDeclaration[]
): string[] {
  const names = new Set(declaration.tokens.map((token) => token.name));
  for (const token of tokens) {
    if (token.schemes && !token.schemes.includes(declaration.id)) continue;
    names.add(token.token);
  }
  return [...names];
}

/** 某个方案可用的参数（含说明与来源），供后台参数标签区展示。 */
export function tokensForScheme(
  declaration: PermalinkSchemeDeclaration,
  tokens: readonly PermalinkTokenDeclaration[]
): PermalinkTokenInfo[] {
  const own: PermalinkTokenInfo[] = declaration.tokens.map((token) => ({
    name: token.name,
    label: token.label,
    ...(token.description ? { description: token.description } : {})
  }));

  const ownNames = new Set(declaration.tokens.map((token) => token.name));
  const contributed: PermalinkTokenInfo[] = tokens
    .filter(
      (token) =>
        !ownNames.has(token.token) && (!token.schemes || token.schemes.includes(declaration.id))
    )
    .map((token) => ({
      name: token.token,
      label: token.label,
      ...(token.description ? { description: token.description } : {}),
      // 未自报来源时用一个中性说法，后台据此提示"由其它插件提供"
      source: token.source ?? '第三方插件'
    }));

  return [...own, ...contributed];
}

/** 校验某个方案下的模板（后台保存与装配前都会用）。 */
export function validateSchemeTemplate(
  declaration: PermalinkSchemeDeclaration,
  tokens: readonly PermalinkTokenDeclaration[],
  template: string
): { valid: boolean; issues: { path: string; message: string }[]; normalized: string } {
  const result = validatePathTemplate(template, {
    allowedTokens: allowedTokensFor(declaration, tokens),
    maxLength: MAX_TEMPLATE_LENGTH
  });
  return {
    valid: result.valid,
    issues: result.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    normalized: result.normalized
  };
}

/**
 * 过滤并校验第三方贡献的方案。
 *
 * 非法方案只告警并跳过，不抛错：一个第三方插件的坏声明不应该让整个固定链接
 * （乃至站点启动）失败。
 */
export function collectSchemes(
  declarations: readonly PermalinkSchemeDeclaration[],
  logger: PluginLogger
): PermalinkSchemeDeclaration[] {
  const byId = new Map<string, PermalinkSchemeDeclaration>();

  for (const declaration of declarations) {
    const problem = describeSchemeProblem(declaration);
    if (problem) {
      logger.warn('固定链接方案被跳过（声明不合法）', { scheme: declaration?.id, problem });
      continue;
    }
    if (byId.has(declaration.id)) {
      logger.warn('固定链接方案被跳过（标识重复）', { scheme: declaration.id });
      continue;
    }
    byId.set(declaration.id, declaration);
  }

  return [...byId.values()];
}

function describeSchemeProblem(declaration: PermalinkSchemeDeclaration): string | undefined {
  if (!declaration || typeof declaration !== 'object') return '不是一个对象';
  if (typeof declaration.id !== 'string' || !SCHEME_ID_PATTERN.test(declaration.id)) {
    return '方案标识需为小写字母开头的短标识';
  }
  if (typeof declaration.label !== 'string' || declaration.label.trim().length === 0) {
    return '缺少展示名';
  }
  if (typeof declaration.routeName !== 'string' || !ROUTE_NAME_PATTERN.test(declaration.routeName)) {
    return '缺少要接管的前台路由名';
  }
  if (!Array.isArray(declaration.tokens)) return '缺少参数声明';
  if (typeof declaration.defaultTemplate !== 'string') return '缺少默认模板';

  const seen = new Set<string>();
  for (const token of declaration.tokens) {
    if (!token || typeof token.name !== 'string' || !TOKEN_NAME_PATTERN.test(token.name)) {
      return `参数名不合法：${String(token?.name)}`;
    }
    if (seen.has(token.name)) return `参数重复：{${token.name}}`;
    seen.add(token.name);
    if (typeof token.label !== 'string' || token.label.trim().length === 0) {
      return `参数 {${token.name}} 缺少说明`;
    }
  }

  return undefined;
}

/**
 * 过滤并校验第三方贡献的参数。
 *
 * `reserved` 是所有方案自带参数名的并集：重名会让模板语义产生歧义（同一个
 * `{lang}` 到底由谁取值？），因此一律拒绝并告警。
 */
export function collectTokens(
  tokens: readonly PermalinkTokenDeclaration[],
  reserved: ReadonlySet<string>,
  logger: PluginLogger
): PermalinkTokenDeclaration[] {
  const accepted = new Map<string, PermalinkTokenDeclaration>();

  for (const token of tokens) {
    if (!token || typeof token !== 'object') {
      logger.warn('固定链接参数被跳过（不是一个对象）');
      continue;
    }
    if (typeof token.token !== 'string' || !TOKEN_NAME_PATTERN.test(token.token)) {
      logger.warn('固定链接参数被跳过（参数名不合法）', { token: String(token.token) });
      continue;
    }
    if (reserved.has(token.token) || accepted.has(token.token)) {
      logger.warn('固定链接参数被跳过（参数名重复）', { token: token.token });
      continue;
    }
    if (typeof token.resolve !== 'function') {
      logger.warn('固定链接参数被跳过（缺少取值来源）', { token: token.token });
      continue;
    }
    if (token.match !== undefined && typeof token.match !== 'function') {
      logger.warn('固定链接参数被跳过（命中校验不是函数）', { token: token.token });
      continue;
    }
    accepted.set(token.token, token);
  }

  return [...accepted.values()];
}

/**
 * 解析单个方案：编译生效模板与默认模板。
 *
 * 库里的模板可能在参数被移除后失效（例如第三方插件停用），
 * 这种情况回退到方案默认模板并告警，而不是让插件启动失败。
 */
export function resolveScheme(input: {
  declaration: PermalinkSchemeDeclaration;
  tokens: readonly PermalinkTokenDeclaration[];
  storedTemplate?: string;
  logger: PluginLogger;
}): ResolvedPermalinkScheme {
  const { declaration, tokens, storedTemplate, logger } = input;
  const allowedTokens = allowedTokensFor(declaration, tokens);

  const fallback: CompiledPathTemplate = compilePathTemplate(declaration.defaultTemplate, {
    allowedTokens
  });

  const candidate = storedTemplate?.trim() ?? '';
  let template = declaration.defaultTemplate;
  let compiled = fallback;

  if (candidate.length > 0) {
    const checked = validateSchemeTemplate(declaration, tokens, candidate);
    if (checked.valid) {
      template = checked.normalized;
      compiled = compilePathTemplate(template, { allowedTokens });
    } else {
      logger.warn('固定链接模板已失效，回退到默认模板', {
        scheme: declaration.id,
        template: candidate,
        issues: checked.issues.map((issue) => issue.message)
      });
    }
  }

  return {
    id: declaration.id,
    label: declaration.label,
    routeName: declaration.routeName,
    template,
    defaultTemplate: declaration.defaultTemplate,
    presets: (declaration.presets ?? []).map((preset) => ({ ...preset })),
    tokens: tokensForScheme(declaration, tokens),
    compiled,
    fallback
  };
}

/** 全部方案自带参数名的并集（用于拒绝第三方参数重名）。 */
export function reservedTokenNames(
  declarations: readonly PermalinkSchemeDeclaration[]
): Set<string> {
  const names = new Set<string>();
  for (const declaration of declarations) {
    for (const token of declaration.tokens) names.add(token.name);
  }
  return names;
}

/**
 * 后台实时预览：不落库、不碰路由，纯计算出一条示例地址。
 *
 * 第三方参数在预览时同样要调它的取值来源；取不到值就如实说明"暂不可预览"，
 * 而不是给出一半的地址让人误以为配好了。
 */
export function previewScheme(input: {
  declaration: PermalinkSchemeDeclaration;
  tokens: readonly PermalinkTokenDeclaration[];
  template: string;
}): { valid: boolean; issues: { path: string; message: string }[]; path?: string } {
  const { declaration, tokens, template } = input;
  const checked = validateSchemeTemplate(declaration, tokens, template);
  if (!checked.valid) return { valid: false, issues: checked.issues };

  const allowedTokens = allowedTokensFor(declaration, tokens);
  const compiled = compilePathTemplate(checked.normalized, { allowedTokens });
  const values: Record<string, string | number> = { ...declaration.sample };

  for (const token of tokens) {
    if (!compiled.tokens.includes(token.token)) continue;
    if (token.schemes && !token.schemes.includes(declaration.id)) continue;

    let resolved: string | undefined;
    try {
      resolved = token.resolve({ scheme: declaration.id, values });
    } catch {
      resolved = undefined;
    }

    if (typeof resolved !== 'string' || resolved.length === 0) {
      return {
        valid: false,
        issues: [
          {
            path: checked.normalized,
            message: `参数 {${token.token}} 由其它插件提供，当前取不到值，暂时无法预览`
          }
        ]
      };
    }
    values[token.token] = resolved;
  }

  try {
    return { valid: true, issues: [], path: compiled.build(values) };
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          path: checked.normalized,
          message: error instanceof Error ? error.message : '无法生成示例地址'
        }
      ]
    };
  }
}
