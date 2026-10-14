/**
 * 短代码引擎（浏览器端）。
 *
 * 分工：**内核只提供机制，语义全部由主题定义**。内核不内置任何短代码，
 * 主题用 `define()` 声明自己支持的标记与展示方式（返回什么结构不受限制）。
 *
 * 交付方式：本文件经 Vite 打包为 `dist/browser/ricenote-shortcodes.js`
 * （IIFE，全局名 `RiceNoteShortcodes`），由 Core 以 `/theme-sdk/v1/**` 托管，
 * 主题通过模板 helper `shortcode_runtime()` 引入。
 *
 * 加载顺序：主题脚本与引擎同为 `defer` 时按文档顺序执行，先用 `define()` 注册、
 * 引擎在 `DOMContentLoaded` 统一扫描即可。若主题脚本先于引擎执行（例如内联脚本），
 * 可把定义推进 `window.RiceNoteShortcodesQueue` 数组，引擎加载时会消费它。
 *
 * 安全边界：短代码的展示由主题代码产出，主题本身已能在这张页面上执行任意脚本，
 * 因此这里是**既有信任边界**，不额外收紧；但 `bodyHtml` 是作者内容经服务端渲染
 * 并消毒后的片段，要当纯文本用请改用 `bodyText` 或先 `escapeHtml()`。
 * 客户端产出的 HTML 不会再经过服务端消毒。
 */

import { SHORTCODE_SCAN_ATTRIBUTE, isShortcodeName } from '@ricenote/shared/shortcodes';
import { escapeHtml, tokenizeShortcodes, type ShortcodeToken } from './tokenizer.js';

export type { ShortcodeToken } from './tokenizer.js';
export { escapeHtml, htmlToSourceText, tokenizeShortcodes } from './tokenizer.js';

/** 短代码渲染上下文：主题的展示逻辑据此产出结构。 */
export interface ShortcodeRenderContext {
  /** 短代码名（小写）。 */
  name: string;
  /** 标记上的参数，如 `[warn title="注意"]`。 */
  attributes: Readonly<Record<string, string>>;
  /** 整体原文（含标记），可直接用于"不处理、保留原文"。 */
  raw: string;
  /** 标记之间的内容：已消毒的 HTML 片段（可能跨段落）。 */
  bodyHtml: string;
  /** `bodyHtml` 的纯文本形式，当作文字使用时优先用它。 */
  bodyText: string;
  /** 当前扫描的容器元素。 */
  container: Element;
  /** HTML 转义工具：把作者文字安全地放进结构里。 */
  escapeHtml: (value: unknown) => string;
}

/** 主题注册的短代码定义。 */
export interface ShortcodeDefinition {
  /** 短代码名：小写字母开头，可含数字与连字符（与标记语法一致）。 */
  name: string;
  /** 仅接受自闭合形态（`[name /]`）；配对的写法会原样保留。 */
  selfClosing?: boolean;
  /**
   * 产出要插入正文的结构。
   *
   * - 返回字符串：按 HTML 解析后插入；
   * - 返回 DOM 节点：直接插入；
   * - 返回 `null` / `undefined`：**保留标记原文**（适合"这一条不处理"）；
   * - 返回空串：什么都不输出（有意为之的隐藏）。
   */
  render(context: ShortcodeRenderContext): string | Node | null | undefined;
}

/** 引擎对外暴露的 API（`window.RiceNoteShortcodes`）。 */
export interface ShortcodeApi {
  define(definition: ShortcodeDefinition): void;
  define(name: string, render: ShortcodeDefinition['render']): void;
  scan(root: Element): void;
  escapeHtml: (value: unknown) => string;
  list(): string[];
}

const registry = new Map<string, ShortcodeDefinition>();

/** 全局预注册队列：主题脚本先于引擎执行时使用。 */
const QUEUE_KEY = 'RiceNoteShortcodesQueue';

/** 注册一个短代码。同名重复注册以最后一次为准（并留下告警便于排查）。 */
export function define(
  definitionOrName: ShortcodeDefinition | string,
  render?: ShortcodeDefinition['render']
): void {
  const definition: ShortcodeDefinition =
    typeof definitionOrName === 'string'
      ? { name: definitionOrName, render: render as ShortcodeDefinition['render'] }
      : definitionOrName;

  const name = String(definition?.name ?? '').trim().toLowerCase();
  if (!isShortcodeName(name)) {
    console.error(`[ricenote] 短代码名不合法，已忽略：${String(definition?.name ?? '')}`, {
      hint: '名字需为小写字母开头，可含数字与连字符'
    });
    return;
  }
  if (typeof definition.render !== 'function') {
    console.error(`[ricenote] 短代码 [${name}] 缺少 render 函数，已忽略`);
    return;
  }

  if (registry.has(name)) {
    console.warn(`[ricenote] 短代码 [${name}] 被重复定义，已使用最后一次的定义`);
  }
  registry.set(name, { ...definition, name });

  // 注册晚于首次扫描时补扫一次（主题脚本用 async 注入等场景）
  if (typeof document !== 'undefined') scheduleAutoScan();
}

/** 当前已注册的短代码名。 */
export function list(): string[] {
  return [...registry.keys()];
}

/** 用 `<template>` 解析一段 HTML 为文档片段（不触发图片等资源的立即加载）。 */
function fragmentFromHtml(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/**
 * 渲染单个短代码，返回要插入的节点。
 *
 * 返回 `null` 表示"保留原文"，由调用方插入 `token.raw`。
 */
function renderToken(token: Extract<ShortcodeToken, { kind: 'shortcode' }>, container: Element): Node | null {
  const definition = registry.get(token.name);
  if (!definition) return null;
  // 声明为自闭合却写成配对形态：保留原文，避免把后面的正文卷进结构
  if (definition.selfClosing && !token.selfClosing) return null;

  const context: ShortcodeRenderContext = {
    name: token.name,
    attributes: Object.freeze({ ...token.attributes }),
    raw: token.raw,
    bodyHtml: token.bodyHtml,
    bodyText: token.bodyText,
    container,
    escapeHtml
  };

  try {
    const result = definition.render(context);
    if (result === null || result === undefined) return null;
    if (typeof result === 'string') return fragmentFromHtml(result);
    if (result instanceof Node) return result;
    return fragmentFromHtml(String(result));
  } catch (error) {
    // 单个短代码出错不该让整页正文消失：保留原文并留下可排查的日志
    console.error(`[ricenote] 短代码 [${token.name}] 渲染失败，已保留原文`, error);
    return null;
  }
}

/**
 * 扫描容器并就地渲染其中的短代码。
 *
 * 只处理传入的容器，不扫描整页：避免导航、标题等无关文本里的方括号被误判。
 */
export function scan(root: Element): void {
  if (registry.size === 0) return;

  let tokens: ShortcodeToken[];
  try {
    tokens = tokenizeShortcodes(root.innerHTML, { known: new Set(registry.keys()) });
  } catch (error) {
    console.error('[ricenote] 短代码解析失败，已保留原文', error);
    return;
  }

  if (!tokens.some((token) => token.kind === 'shortcode')) return;

  const output = document.createDocumentFragment();
  for (const token of tokens) {
    if (token.kind === 'html') {
      output.append(fragmentFromHtml(token.value));
      continue;
    }
    const rendered = renderToken(token, root);
    output.append(rendered ?? fragmentFromHtml(token.raw));
  }

  root.replaceChildren(output);
}

/** 消费全局预注册队列（主题脚本先于引擎执行时使用）。 */
function consumeQueue(): void {
  const scope = globalThis as typeof globalThis & { [QUEUE_KEY]?: unknown };
  const queue = scope[QUEUE_KEY];
  if (!Array.isArray(queue)) return;

  // 先清空再注册：注册过程中若又有人入队，下一轮能看到
  scope[QUEUE_KEY] = [];
  for (const item of queue) {
    try {
      define(item as ShortcodeDefinition);
    } catch (error) {
      console.error('[ricenote] 预注册的短代码定义无效，已忽略', error);
    }
  }
}

/** 扫描页面上全部被标注为正文容器的元素。 */
function autoScan(): void {
  const containers = document.querySelectorAll(`[${SHORTCODE_SCAN_ATTRIBUTE}]`);
  containers.forEach((container) => {
    try {
      scan(container);
    } catch (error) {
      console.error('[ricenote] 短代码容器处理失败，已跳过', error);
    }
  });
}

let scanQueued = false;

/** 合并到下一帧再扫一次，避免连续注册多个短代码时反复扫描。 */
function scheduleAutoScan(): void {
  // 文档还在解析时不扫：那时容器里只有前半段内容，扫完会把后半段漏下
  if (scanQueued || document.readyState === 'loading') return;
  scanQueued = true;

  const run = (): void => {
    scanQueued = false;
    autoScan();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

/**
 * 启动引擎：消费预注册队列，并在多个时机扫描正文容器。
 *
 * **反复扫描是必须的，不是保守做法**：`defer` 脚本执行时 `document.readyState`
 * 已经是 `interactive`，而排在引擎之后的主题脚本此刻还没执行 —— 只扫一次会得到
 * "引擎装了、短代码却没生效"的结果：页面不报错、标记原样显示，看起来就像主题写错了。
 *
 * 重复扫描是安全的：没有短代码的容器会被 `scan()` 直接放过，不产生任何 DOM 写入。
 */
export function bootstrap(): void {
  consumeQueue();
  autoScan();

  if (document.readyState === 'complete') return;
  document.addEventListener('DOMContentLoaded', autoScan, { once: true });
  // DOMContentLoaded 已经过去、而资源仍在加载（或主题脚本是 async 注入）时的兜底
  window.addEventListener('load', autoScan, { once: true });
}

// 在浏览器里加载即启动；在 Node（类型检查、SSR 场景）下只导出 API。
if (typeof document !== 'undefined') {
  bootstrap();
}
