/**
 * 短代码分词器（**纯函数**，不依赖 DOM）。
 *
 * 为什么单独拆出来：仓库没有 DOM 测试环境，只有纯函数才能被 `node --test`
 * 直接断言。DOM 相关的事情只剩"把片段挂到容器上"这一层薄适配
 * （见 `browser.ts`）。
 *
 * 输入是**正文容器里已经渲染好的 HTML**（服务端 Markdown 渲染 + 消毒的产物），
 * 因为短代码的展示发生在前台浏览器，正文存储与后台预览都保持标记原文。
 *
 * 块级与跨段落：`[warn]` 与 `[/warn]` 在被 Markdown 渲染后往往各自独占一个
 * 段落（`<p>[warn]</p>`），因此识别后要把这两个**只剩标记的空壳段落**一起吃掉，
 * 否则替换结果会变成 `<div>` 嵌在 `<p>` 里的非法结构。
 */

import { createShortcodeTagPattern, parseShortcodeAttributes } from '@ricenote/shared/shortcodes';

/** 分词产物：一段原样 HTML，或一个已识别的短代码。 */
export type ShortcodeToken =
  | { kind: 'html'; value: string }
  | {
      kind: 'shortcode';
      /** 短代码名（小写）。 */
      name: string;
      /** 标记上的参数（`[warn title="注意"]` → `{ title: '注意' }`）。 */
      attributes: Record<string, string>;
      /** 标记之间的内容：已消毒的 HTML 片段（可能跨段落）。 */
      bodyHtml: string;
      /** `bodyHtml` 的纯文本近似形式（去标签、解基本实体、压缩空白）。 */
      bodyText: string;
      /** 整体原文（含标记与空壳段落），用于"保留原文不处理"的回退。 */
      raw: string;
      /** 标记是否写成自闭合形态（`[name /]`）。 */
      selfClosing: boolean;
    };

export interface TokenizeOptions {
  /** 已注册的短代码名。未注册的名字一律当普通文字处理。 */
  known: ReadonlySet<string>;
}

/**
 * 不参与解析的区域：代码块 / 行内代码 / 脚本 / 样式 / 文本域 / HTML 注释。
 *
 * 这些地方出现 `[warn]` 属于"内容本身"，把它渲染成结构会毁掉示例（例如
 * 一篇讲短代码用法的文章里的示例代码）。
 */
const PROTECTED_REGION =
  /<!--[\s\S]*?-->|<(pre|code|script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** 遮罩占位符。内容里的 `\u0000` 已被消毒层过滤，因此不会与正文冲突。 */
const PLACEHOLDER_PATTERN = /\u0000rnsc(\d+)\u0000/g;

/** 判断"标记前后是否只有一个空壳段落"时，最多回看/前瞻的字符数。 */
const SHELL_WINDOW = 64;

interface MaskedSource {
  masked: string;
  /** 把占位符换回原文。 */
  restore: (value: string) => string;
}

/** 标记前紧邻的段落开标签（与标记之间只有空白）。 */
const LEADING_PARAGRAPH = /<p(?:\s[^>]*)?>\s*$/;

/** 标记后紧邻的段落闭标签（与标记之间只有空白）。 */
const TRAILING_PARAGRAPH = /^\s*<\/p\s*>/;

/** 遮罩不可解析区域。 */
function maskProtectedRegions(source: string): MaskedSource {
  const originals: string[] = [];
  const masked = source.replace(PROTECTED_REGION, (match) => {
    originals.push(match);
    return `\u0000rnsc${originals.length - 1}\u0000`;
  });

  const restore = (value: string): string =>
    value.replace(PLACEHOLDER_PATTERN, (_match, index: string) => originals[Number(index)] ?? '');

  return { masked, restore };
}

interface Marker {
  start: number;
  end: number;
}

/**
 * 标记前紧邻的段落开标签区间（`<p>[warn]…`）。
 *
 * 只认 `<p>`：这是 Markdown 给独立段落加的包裹。其余块级容器（`<li>`、`<blockquote>`）
 * 本来就该保留，短代码结构落进去即可。
 */
function leadingParagraph(source: string, marker: Marker): Marker | null {
  const before = source.slice(Math.max(0, marker.start - SHELL_WINDOW), marker.start);
  const open = LEADING_PARAGRAPH.exec(before);
  if (!open) return null;
  return { start: marker.start - open[0].length, end: marker.start };
}

/** 标记后紧邻的段落闭标签区间（`…[/warn]</p>`）。 */
function trailingParagraph(source: string, marker: Marker): Marker | null {
  const after = source.slice(marker.end, marker.end + SHELL_WINDOW);
  const close = TRAILING_PARAGRAPH.exec(after);
  if (!close) return null;
  return { start: marker.end, end: marker.end + close[0].length };
}

/**
 * 从 `fromIndex` 起找与开标记配对的闭标记。
 *
 * 同名的嵌套按深度计数配对（`[warn]a[warn]b[/warn]c[/warn]` 的外层能正确闭合）；
 * **不同名交叉嵌套不支持**（`[a][b][/a][/b]` 会配成 `[a]...[b][/a]`），
 * 这与"短代码体里可以写排版语法"的定位一致，文档中如实说明。
 */
function findClosing(source: string, name: string, fromIndex: number): Marker | null {
  const pattern = createShortcodeTagPattern();
  pattern.lastIndex = fromIndex;

  let depth = 1;
  let match = pattern.exec(source);
  while (match !== null) {
    if ((match[2] ?? '') === name) {
      if (match[1]) {
        depth -= 1;
        if (depth === 0) {
          return { start: match.index, end: match.index + match[0].length };
        }
      } else if (!match[4]) {
        depth += 1;
      }
    }
    match = pattern.exec(source);
  }
  return null;
}

/**
 * HTML 转义：把任意值安全地放进拼出来的结构里。
 *
 * 放在本模块（而非浏览器入口）是为了可测：仓库没有 DOM 测试环境，
 * 而这是纯字符串函数。
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 把已渲染的 HTML 片段近似转成纯文本（供主题当作文字使用）。 */
export function htmlToSourceText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    // `&amp;` 最后解，避免把 `&amp;lt;` 解成 `<`
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 把正文 HTML 切分为「HTML 片段 / 短代码」序列。
 *
 * 复杂度 O(n)：只在容器里出现 `[` 且已注册短代码时才进入扫描；
 * 未注册任何短代码时直接短路返回，不产生额外开销。
 */
export function tokenizeShortcodes(html: string, options: TokenizeOptions): ShortcodeToken[] {
  if (!html) return [];
  if (options.known.size === 0 || !html.includes('[')) {
    return [{ kind: 'html', value: html }];
  }

  const { masked, restore } = maskProtectedRegions(html);
  const pattern = createShortcodeTagPattern();
  const collected: ShortcodeToken[] = [];

  let cursor = 0;
  let match = pattern.exec(masked);

  while (match !== null) {
    const name = match[2] ?? '';
    const isClosing = Boolean(match[1]);
    const isSelfClosing = Boolean(match[4]);
    const openMarker: Marker = { start: match.index, end: match.index + match[0].length };

    // 闭标记、未注册的名字：都当普通文字，继续往后找下一个开标记
    if (isClosing || !options.known.has(name)) {
      match = pattern.exec(masked);
      continue;
    }

    let closeMarker: Marker | null = null;
    if (!isSelfClosing) {
      closeMarker = findClosing(masked, name, openMarker.end);
      // 未闭合：整段当普通文字，避免把后面的正文吃掉
      if (!closeMarker) {
        match = pattern.exec(masked);
        continue;
      }
    }

    /*
     * 吃掉被 Markdown 拆出来的空壳段落。
     *
     * 左壳（`<p>`）与右壳（`</p>`）分别判定：最常见的写法
     * `<p>[warn]正文[/warn]</p>` 里标记并不"独占段落"，但整段本来就该被结构替换，
     * 两壳都要吃掉，否则会留下空段落（空 `<p>` 自带外边距，页面上看得出多余空白）。
     * 只有"标记与其它文字同处一行"时两壳才保留，此时浏览器解析会自行把段落规整开。
     */
    const openLeading = leadingParagraph(masked, openMarker);
    const openTrailing = openLeading ? trailingParagraph(masked, openMarker) : null;
    const closeTrailing = closeMarker ? trailingParagraph(masked, closeMarker) : null;
    const closeLeading =
      closeMarker && closeTrailing ? leadingParagraph(masked, closeMarker) : null;

    const regionStart = openLeading ? openLeading.start : openMarker.start;
    const bodyStart = openTrailing ? openTrailing.end : openMarker.end;
    const bodyEnd = closeMarker
      ? (closeLeading ? closeLeading.start : closeMarker.start)
      : bodyStart;
    const regionEnd = closeMarker
      ? (closeTrailing ? closeTrailing.end : closeMarker.end)
      : (openTrailing ? openTrailing.end : openMarker.end);

    const bodyHtml = restore(
      masked.slice(Math.min(bodyStart, bodyEnd), Math.max(bodyStart, bodyEnd))
    );

    collected.push({ kind: 'html', value: masked.slice(cursor, regionStart) });
    collected.push({
      kind: 'shortcode',
      name,
      attributes: parseShortcodeAttributes(match[3] ?? ''),
      bodyHtml,
      bodyText: htmlToSourceText(bodyHtml),
      raw: restore(masked.slice(regionStart, regionEnd)),
      selfClosing: isSelfClosing
    });

    cursor = regionEnd;
    pattern.lastIndex = regionEnd;
    match = pattern.exec(masked);
  }

  collected.push({ kind: 'html', value: masked.slice(cursor) });

  // 还原遮罩并合并相邻的 HTML 片段，让消费方拿到最少的片段数
  const output: ShortcodeToken[] = [];
  for (const token of collected) {
    if (token.kind !== 'html') {
      output.push(token);
      continue;
    }
    const value = restore(token.value);
    if (value.length === 0) continue;

    const last = output[output.length - 1];
    if (last && last.kind === 'html') {
      output[output.length - 1] = { kind: 'html', value: last.value + value };
      continue;
    }
    output.push({ kind: 'html', value });
  }

  return output;
}
