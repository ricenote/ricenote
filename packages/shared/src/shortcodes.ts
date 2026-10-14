/**
 * 短代码（Shortcode）语法内核。
 *
 * 定位：**语法规则的唯一事实源**。浏览器端的短代码引擎（`@ricenote/theme-sdk`）
 * 与两个内容插件的纯文本提取都从这里取规则，避免"同一段正文在不同场合
 * 解析结果不同"——这类差异排查起来最费时间。
 *
 * 语法（与主题 API 文档一致）：
 * - 开标记 `[name]`、带参数 `[name key="value" flag]`；
 * - 闭标记 `[/name]`；
 * - 自闭合 `[name ... /]`。
 *
 * 名字限定为**小写字母开头、可含数字与连字符**：`[Text]` 不算短代码，
 * 从而不会与 Markdown 的链接文本混淆。
 */

/** 正文容器的扫描根属性名：主题在正文容器上标注，引擎据此定位（也可显式 scan）。 */
export const SHORTCODE_SCAN_ATTRIBUTE = 'data-rn-shortcodes';

/** 引擎浏览器产物的托管前缀（与 `apps/server` 的静态托管路由一致）。 */
export const SHORTCODE_RUNTIME_PREFIX = '/theme-sdk/v1';

/** 引擎产物文件名。 */
export const SHORTCODE_RUNTIME_FILE = 'ricenote-shortcodes.js';

/**
 * 拼出引擎脚本地址。
 *
 * 带版本查询串（同 `theme_asset` 的做法）：升级后浏览器不会继续使用旧引擎，
 * 否则会出现"改了引擎却仍是旧行为"这类难查的问题。
 */
export function shortcodeRuntimeUrl(version: string): string {
  return `${SHORTCODE_RUNTIME_PREFIX}/${SHORTCODE_RUNTIME_FILE}?v=${encodeURIComponent(version)}`;
}

/** 名字片段（捕获组 1）：小写字母开头，可含数字与连字符。 */
const NAME_SOURCE = String.raw`([a-z][a-z0-9-]*)`;

/**
 * 标记片段。
 *
 * 捕获组：1 = 闭合斜杠（`[/name]` 时有值）、2 = 名字、3 = 属性原文（含前导空白）、
 * 4 = 自闭合斜杠（`[name /]` 时有值）。
 */
const TAG_SOURCE =
  String.raw`\[(\/)?` + NAME_SOURCE + String.raw`((?:\s+[^\]]*?)?)\s*(\/)?\]`;

/** 属性片段：`key="value"` / `key='value'` / `key=value` / 仅 `key`。 */
const ATTRIBUTE_SOURCE = String.raw`([a-zA-Z][a-zA-Z0-9_-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"']+)))?`;

/** 判断字符串是否可用作短代码名。 */
export function isShortcodeName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

/**
 * 新建一个「匹配任意短代码标记」的全局正则。
 *
 * 返回新实例而不是共享常量：全局正则带 `lastIndex` 状态，
 * 共享会让递归/嵌套扫描互相干扰。
 */
export function createShortcodeTagPattern(): RegExp {
  return new RegExp(TAG_SOURCE, 'g');
}

/**
 * 解析标记里的参数原文。
 *
 * 只写键名时**取键名本身**作为值，于是 `[warn bold]` 里 `attributes.bold === 'bold'`，
 * 主题侧用 `'bold' in attributes` 判断即可，不必区分"有无值的布尔参数"。
 */
export function parseShortcodeAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!source || source.trim().length === 0) return attributes;

  const pattern = new RegExp(ATTRIBUTE_SOURCE, 'g');
  let match = pattern.exec(source);
  while (match !== null) {
    const name = match[1] ?? '';
    if (name.length > 0) {
      const quoted = match[3] ?? match[4];
      const bare = match[5];
      attributes[name] = quoted ?? bare ?? name;
    }
    match = pattern.exec(source);
  }
  return attributes;
}

/**
 * 剥离短代码标记、只保留内部文字（面向纯文字场合）。
 *
 * 用于列表摘要、搜索摘要、SEO 描述与订阅源：这些地方不该出现 `[warn]` 字样，
 * 而正文存储本身不做任何改写。
 *
 * 调用时机：**建议在代码块、链接与图片处理之后**（`markdownToPlainText` 即如此），
 * 此时正文里只剩真正的短代码与普通方括号文字。两个兜底守卫负责挡住误伤：
 * 被 `!`（图片）或反斜杠（转义）引导的、以及紧跟 `(` 的（Markdown 行内链接的
 * 文字部分可能恰好是一个合法短代码名）。
 */
export function stripShortcodeMarks(text: string): string {
  if (!text || !text.includes('[')) return text;
  const pattern = new RegExp(String.raw`(^|[^!\\])` + TAG_SOURCE + String.raw`(?!\()`, 'g');
  return text.replace(pattern, '$1');
}

/** 因剥离标记而完全变空的块级元素（含仅剩空白的情况）。 */
const EMPTY_BLOCK = /<(p|div|section|blockquote|li)(?:\s[^>]*)?>\s*<\/\1>/gi;

/**
 * 剥离已渲染 HTML 里的短代码标记，并清掉因此变空的块级元素。
 *
 * 典型场景：`<p>[warn]</p><p>正文</p><p>[/warn]</p>` 剥离标记后会留下两个
 * 空段落；订阅源必须清掉它们，否则阅读器里会出现无意义的空行。
 */
export function stripShortcodeMarksFromHtml(html: string): string {
  if (!html) return html;
  let output = stripShortcodeMarks(html);
  // 嵌套的空块（例如 <blockquote><p></p></blockquote>）需要多轮才能清干净
  for (let round = 0; round < 3; round += 1) {
    const next = output.replace(EMPTY_BLOCK, '');
    if (next === output) break;
    output = next;
  }
  return output;
}
