/**
 * 第三方示例插件：阅读时长。
 *
 * 存在意义：证明"第三方可以只依赖 `@ricenote/plugin-sdk` 与 `@ricenote/shared`
 * 独立开发一个插件"——本插件：
 * - **不**依赖任何其他插件（没有 `requires`）；
 * - **不**持有数据表（没有 `database:own`，也只有因此不会产生迁移）；
 * - **不**注册路由或后台菜单；
 * - 只做一件事：向标准 Slot `post.beforeContent` 注入一行元信息。
 *
 * 禁用时 Slot 自动为空、主题无需改动，这也是"低耦合"最直接的体现。
 */

import { definePlugin, type PluginContext } from '@ricenote/plugin-sdk';

/** 中日韩统一表意文字（含扩展 A 区与兼容区）。 */
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
/** 拉丁字母与数字组成的"词"。 */
const LATIN_WORD_PATTERN = /[A-Za-z0-9]+/g;

/**
 * 估算字数。
 *
 * 中文按"字"计数、拉丁文按"词"计数，这是中英混排博客最接近直觉的算法
 * （用空格分词会把整句中文当成一个词，严重低估）。
 */
export function countWords(input: string): number {
  const text = input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');

  const cjk = (text.match(CJK_PATTERN) ?? []).length;
  const latin = (text.match(LATIN_WORD_PATTERN) ?? []).length;
  return cjk + latin;
}

/** 阅读分钟数：至少 1 分钟，向上取整。 */
export function readingMinutes(words: number, wordsPerMinute: number): number {
  const rate = Number.isFinite(wordsPerMinute) && wordsPerMinute > 0 ? wordsPerMinute : 300;
  return Math.max(1, Math.ceil(words / rate));
}

export default definePlugin({
  async start(ctx: PluginContext) {
    const wordsPerMinute = clampInt(ctx.config.get('wordsPerMinute', 300), 50, 2000, 300);
    const showWordCount = ctx.config.get<boolean>('showWordCount', true);
    const label = normalizeLabel(ctx.config.get('label', '阅读时长'));

    ctx.slots.register('post.beforeContent', {
      name: 'acme.reading-time',
      render(context) {
        const post = context.data.post as { html?: unknown; title?: unknown } | undefined;
        const text = extractText(post?.html);
        if (text.length === 0) return '';

        const words = countWords(text);
        const minutes = readingMinutes(words, wordsPerMinute);
        const wordsPart = showWordCount ? ` · 约 ${words} 字` : '';

        return `<p class="acme-reading-time" data-acme-reading-time>${label} 约 ${minutes} 分钟${wordsPart}</p>`;
      }
    });

    ctx.logger.info('阅读时长插件已就绪（第三方示例）', { wordsPerMinute, showWordCount, label });
  },

  async stop(ctx: PluginContext) {
    // Slot 由 Core 统一注销，这里只需报告状态
    ctx.logger.info('阅读时长插件已停止');
  }
});

/**
 * 取正文纯文本。
 *
 * `post.html` 可能是渲染器注入的受信句柄（含 `value`），
 * 也可能是普通字符串——两种形态都要兼容，否则第三方插件很容易踩坑。
 */
function extractText(html: unknown): string {
  if (typeof html === 'string') return html;
  if (html && typeof html === 'object' && 'value' in html) {
    const value = (html as { value?: unknown }).value;
    return typeof value === 'string' ? value : '';
  }
  return '';
}

function normalizeLabel(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text.slice(0, 20) : '阅读时长';
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
