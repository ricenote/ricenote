/**
 * 路径模板引擎（与业务无关的纯函数实现）。
 *
 * 它只认识「字面量 + `{参数}`」，不认识文章/页面/分类，也不带任何预设或默认模板 ——
 * 预设清单、默认模板与后台界面属于「固定链接」插件（`rice.permalink`），
 * 这里只提供四处共用的实现：
 *
 * - **解析**：模板 → 段与参数的结构（`parsePathTemplate`）；
 * - **校验**：合法性（前缀、至少一个参数、未知/重复参数、空白与查询串、长度）；
 * - **编译**：模板 → 路由匹配模式 + 地址生成模式（`compilePathTemplate`）；
 * - **取值**：按数据生成地址（`build`）与从路由参数还原取值（`extract`）。
 *
 * 两种模式的差别（这是本引擎存在的理由）：
 * - `routePattern` 供路由注册使用，「参数」独占一段（`{slug}.html` → `:slug`），
 *   因此 Fastify 会把 `.html` 一起捕获进参数值；
 * - `urlPattern` 供地址生成使用，保留段内字面量（`/archives/:slug.html`），
 *   这样 `buildPath()` 与 `build()` 都能拼出带后缀的正确地址；
 * - `extract()` 负责把捕获到的字面量剥离掉，并**强制要求后缀存在**
 *   （缺失即返回 `undefined`，由调用方判 404），避免 `/archives/foo`
 *   这类缺少 `.html` 的地址也被当成合法命中。
 */

import { ErrorCode, RiceNoteError } from './errors.js';

/** 参数名合法形态：小写字母开头，后接小写字母、数字或下划线。 */
const TOKEN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
/** 花括号引用（不允许嵌套）。 */
const TOKEN_REFERENCE_PATTERN = /\{([^{}]*)\}/g;
const DEFAULT_MAX_LENGTH = 200;
const DEFAULT_MIN_TOKENS = 1;

export interface PathTemplateIssue {
  /** 出错位置（模板片段），便于后台定位。 */
  path: string;
  message: string;
  keyword?: string;
}

/** 段内的结构：`literal0 token0 literal1`，`literals.length === tokens.length + 1`。 */
export interface ParsedPathSegment {
  /** 段原始文本（不含两侧斜杠）。 */
  raw: string;
  /** 段内出现的参数名（按出现顺序）。 */
  tokens: string[];
  /** 段内的字面量片段，长度为 `tokens.length + 1`。 */
  literals: string[];
}

export interface ParsedPathTemplate {
  /** 归一化（去首尾空白）后的模板。 */
  template: string;
  segments: ParsedPathSegment[];
  /** 模板中出现的全部参数名（按出现顺序，可能重复）。 */
  tokens: string[];
  /** 模板是否以 `/` 结尾（根路径不算）。 */
  trailingSlash: boolean;
  /** 结构层面的问题（语义校验见 `validatePathTemplate`）。 */
  issues: PathTemplateIssue[];
}

export interface ValidatePathTemplateOptions {
  /** 允许出现的参数名。 */
  allowedTokens: readonly string[];
  /** 至少需要出现的参数个数，默认 1。 */
  minTokens?: number;
  /** 模板长度上限，默认 200。 */
  maxLength?: number;
}

export interface ValidatePathTemplateResult {
  valid: boolean;
  issues: PathTemplateIssue[];
  /** 归一化后的模板（校验通过时应原样写回）。 */
  normalized: string;
}

export interface CompilePathTemplateOptions {
  /** 允许出现的参数名；给出时，未知参数会直接抛错。 */
  allowedTokens?: readonly string[];
}

/** 编译结果：同一份模板的「匹配」与「生成」两种视角。 */
export interface CompiledPathTemplate {
  template: string;
  /** 供路由注册：参数独占一段，段内字面量被剥离。 */
  routePattern: string;
  /** 供地址生成：保留段内字面量（含 `.html` 等后缀）。 */
  urlPattern: string;
  /** 模板中出现的参数名（按出现顺序）。 */
  tokens: string[];
  /** 生成地址；缺失取值时抛错，不产出坏链接。 */
  build(values: Record<string, string | number>): string;
  /** 从路由参数还原取值（剥离字面量）；字面量不匹配时返回 undefined。 */
  extract(params: Record<string, string>): Record<string, string> | undefined;
}

/* ------------------------------ 解析 ------------------------------ */

/** 解析路径模板为段结构；结构问题放进 `issues`，本函数不抛错。 */
export function parsePathTemplate(template: string): ParsedPathTemplate {
  const text = typeof template === 'string' ? template.trim() : '';
  const issues: PathTemplateIssue[] = [];

  if (text.length === 0) {
    return {
      template: text,
      segments: [],
      tokens: [],
      trailingSlash: false,
      issues: [{ path: '/', message: '路径不能为空', keyword: 'minLength' }]
    };
  }

  if (!text.startsWith('/')) {
    issues.push({ path: text, message: '路径必须以 / 开头', keyword: 'format' });
  }

  if (/\s/.test(text)) {
    issues.push({ path: text, message: '路径不能包含空格或换行', keyword: 'format' });
  }

  if (text.includes('?') || text.includes('#')) {
    issues.push({ path: text, message: '路径不能包含查询串（?）或锚点（#）', keyword: 'format' });
  }

  const trailingSlash = text.length > 1 && text.endsWith('/');
  const body = text.startsWith('/') ? text.slice(1) : text;
  const rawSegments = body === '' ? [] : body.split('/');
  // 尾斜杠会在 split 后留下一个空段，先摘掉它再判定「连续斜杠」
  if (trailingSlash) rawSegments.pop();

  const segments: ParsedPathSegment[] = [];
  const tokens: string[] = [];

  for (const raw of rawSegments) {
    if (raw === '') {
      issues.push({ path: text, message: '路径中不能出现连续的 /', keyword: 'format' });
      segments.push({ raw, tokens: [], literals: [''] });
      continue;
    }

    const segment = parseSegment(raw);
    // 花括号配对：把已识别的引用挖掉后仍有花括号即为写法错误
    const leftover = raw.replace(new RegExp(TOKEN_REFERENCE_PATTERN), '');
    if (leftover.includes('{') || leftover.includes('}')) {
      issues.push({ path: `/${raw}`, message: '参数写法不正确：花括号未配对', keyword: 'format' });
    }

    for (const name of segment.tokens) {
      if (!TOKEN_NAME_PATTERN.test(name)) {
        issues.push({
          path: `/${raw}`,
          message: `参数名不合法：{${name}}（只允许小写字母、数字与下划线，且以字母开头）`,
          keyword: 'format'
        });
      }
    }

    if (segment.tokens.length > 1) {
      issues.push({
        path: `/${raw}`,
        message: '同一段路径中最多只能出现一个参数（如 /{year}/{slug}.html）',
        keyword: 'format'
      });
    }

    segments.push(segment);
    tokens.push(...segment.tokens);
  }

  return { template: text, segments, tokens, trailingSlash, issues };
}

function parseSegment(raw: string): ParsedPathSegment {
  const tokens: string[] = [];
  const literals: string[] = [];
  const pattern = new RegExp(TOKEN_REFERENCE_PATTERN);
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    literals.push(raw.slice(cursor, match.index));
    tokens.push(match[1] ?? '');
    cursor = match.index + match[0].length;
  }
  literals.push(raw.slice(cursor));

  return { raw, tokens, literals };
}

/* ------------------------------ 校验 ------------------------------ */

/** 校验路径模板；不修改模板，只报告问题（非法写法一律拒绝而不是静默修正）。 */
export function validatePathTemplate(
  template: string,
  options: ValidatePathTemplateOptions
): ValidatePathTemplateResult {
  const parsed = parsePathTemplate(template);
  const issues: PathTemplateIssue[] = [...parsed.issues];
  const normalized = parsed.template;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const minTokens = options.minTokens ?? DEFAULT_MIN_TOKENS;
  const allowed = new Set(options.allowedTokens);

  if (normalized.length > maxLength) {
    issues.push({ path: '/', message: `路径长度不得超过 ${maxLength} 个字符`, keyword: 'maxLength' });
  }

  const seen = new Set<string>();
  for (const name of parsed.tokens) {
    if (seen.has(name)) {
      issues.push({ path: normalized, message: `参数重复：{${name}}`, keyword: 'uniqueItems' });
      continue;
    }
    seen.add(name);

    if (!allowed.has(name)) {
      issues.push({
        path: normalized,
        message: `不支持的参数：{${name}}（可用参数：${[...allowed].map((item) => `{${item}}`).join(' ') || '无'}）`,
        keyword: 'enum'
      });
    }
  }

  if (seen.size < minTokens) {
    issues.push({
      path: normalized,
      message: `路径中至少需要包含一个参数（如 {${options.allowedTokens[0] ?? 'slug'}}）`,
      keyword: 'minItems'
    });
  }

  return { valid: issues.length === 0, issues, normalized };
}

/* ------------------------------ 编译 ------------------------------ */

/**
 * 编译路径模板。
 *
 * 传入的模板应当已通过 `validatePathTemplate`；这里的再次校验只是兜底，
 * 失败时抛错而不是产出会漂移的模式。
 */
export function compilePathTemplate(
  template: string,
  options: CompilePathTemplateOptions = {}
): CompiledPathTemplate {
  const parsed = parsePathTemplate(template);
  if (parsed.issues.length > 0) {
    throw invalidTemplate(template, parsed.issues[0]?.message ?? '路径模板不合法');
  }

  const duplicates = parsed.tokens.filter((name, index) => parsed.tokens.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw invalidTemplate(template, `参数重复：{${duplicates[0]}}`);
  }

  if (options.allowedTokens) {
    const allowed = new Set(options.allowedTokens);
    const unknown = parsed.tokens.find((name) => !allowed.has(name));
    if (unknown !== undefined) throw invalidTemplate(template, `不支持的参数：{${unknown}}`);
  }

  const routeSegments: string[] = [];
  const urlSegments: string[] = [];
  const tokenSegments: { index: number; token: string; prefix: string; suffix: string }[] = [];

  for (const [index, segment] of parsed.segments.entries()) {
    if (segment.tokens.length === 0) {
      routeSegments.push(segment.raw);
      urlSegments.push(segment.raw);
      continue;
    }

    const token = segment.tokens[0] as string;
    const prefix = segment.literals[0] ?? '';
    const suffix = segment.literals[1] ?? '';
    routeSegments.push(`:${token}`);
    urlSegments.push(`${prefix}:${token}${suffix}`);
    tokenSegments.push({ index, token, prefix, suffix });
  }

  const routePattern = `/${routeSegments.join('/')}`;
  const urlPattern = `/${urlSegments.join('/')}${parsed.trailingSlash ? '/' : ''}`;

  return {
    template: parsed.template,
    routePattern,
    urlPattern,
    tokens: parsed.tokens,
    build(values) {
      const out = parsed.segments.map((segment) => {
        if (segment.tokens.length === 0) return segment.raw;
        const token = segment.tokens[0] as string;
        const value = values[token];
        if (value === undefined || value === null || value === '') {
          throw invalidTemplate(parsed.template, `生成地址失败：缺少参数 {${token}}`);
        }
        return `${segment.literals[0] ?? ''}${encodeURIComponent(String(value))}${
          segment.literals[1] ?? ''
        }`;
      });

      return `/${out.join('/')}${parsed.trailingSlash ? '/' : ''}`;
    },
    extract(params) {
      const extracted: Record<string, string> = {};

      for (const { token, prefix, suffix } of tokenSegments) {
        const raw = params[token];
        if (typeof raw !== 'string' || raw.length === 0) return undefined;
        if (raw.length <= prefix.length + suffix.length) return undefined;
        if (!raw.startsWith(prefix) || !raw.endsWith(suffix)) return undefined;

        const value = raw.slice(prefix.length, raw.length - suffix.length);
        if (value.length === 0) return undefined;
        extracted[token] = value;
      }

      return extracted;
    }
  };
}

function invalidTemplate(template: string, message: string): RiceNoteError {
  return new RiceNoteError(ErrorCode.VALIDATION_FAILED, `路径模板不合法（${template}）：${message}`, {
    status: 400,
    details: { template, message }
  });
}
