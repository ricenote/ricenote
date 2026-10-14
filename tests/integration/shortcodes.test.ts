/**
 * 短代码端到端：正文保留标记 → 页面交付引擎 → 纯文字场合不留标记 → 未改造主题优雅降级。
 *
 * 这套用例守的是"分工"本身：内核只交付机制（引擎 + 扫面约定），展示完全由主题决定。
 * 因此最该钉住的不是渲染结果（那是浏览器的事），而是**服务端到底交付了什么**：
 * 正文里标记必须原样保留、页面必须带上引擎脚本与扫描容器、纯文字场合必须没有标记。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { data } from './ext-harness.js';
import {
  bootKernel,
  resetDatabase,
  RUNTIME_PREFIX,
  THEME_SHORTCODE_SCRIPT,
  type ShortcodesKernel
} from './shortcodes-harness.js';

const POST_SLUG = 'shortcode-post';
const PAGE_SLUG = 'shortcode-page';

/** 仓库根目录：用于读取主题清单，断言资源地址的指纹与清单版本一致。 */
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 覆盖"行内 / 整段带参数 / 跨段落 / 代码块"四类最典型的写法。 */
const POST_CONTENT = [
  '正文开始。',
  '',
  '行内用法：提示 [warn]行内[/warn] 结束。',
  '',
  '[warn title="注意"]这是**警示**内容[/warn]',
  '',
  '[warn]',
  '',
  '跨段落第一段。',
  '',
  '- 列表项一',
  '- 列表项二',
  '',
  '跨段落第二段。',
  '',
  '[/warn]',
  '',
  '```',
  '[warn]示例代码里的标记不该被解析[/warn]',
  '```'
].join('\n');

let current: ShortcodesKernel;
let postId = 0;

before(async () => {
  await resetDatabase();
  current = await bootKernel();

  /*
   * 明确激活默认主题：.env 的默认主题可被本地环境改掉（本机就是 rice.minimal），
   * 而短代码示例在 rice.default 里，不锚定它这条用例会"测了另一个主题"却看不出来。
   */
  const activated = await current.admin.request('POST', '/api/admin/themes/rice.default/activate');
  assert.equal(activated.status, 200, activated.text);

  const post = await current.admin.request('POST', '/api/admin/posts', {
    body: { title: '短代码回归', slug: POST_SLUG, content: POST_CONTENT, status: 'published' }
  });
  assert.equal(post.status, 201, post.text);
  postId = data<{ id: number }>(post).id;

  const page = await current.admin.request('POST', '/api/admin/pages', {
    body: {
      title: '短代码页面',
      slug: PAGE_SLUG,
      content: '[warn]页面警示[/warn]',
      status: 'published'
    }
  });
  assert.equal(page.status, 201, page.text);
});

after(async () => {
  if (current) await current.stop();
});

describe('文章：标记原样保留，页面交付引擎与扫描容器', () => {
  it('正文里的标记不被服务端替换（含参数、跨段落、代码块）', async () => {
    const res = await current.admin.request('GET', `/post/${POST_SLUG}`);
    assert.equal(res.status, 200, res.text.slice(0, 200));

    // 标记原文都在：行内、带参数、跨段落、代码块
    assert.match(res.text, /\[warn\]行内\[\/warn\]/);
    assert.match(res.text, /\[warn title="注意"\]/);
    // 跨段落：两个标记各自被 Markdown 包成独立段落
    assert.match(res.text, /\[warn\]<\/p>\s*<p>跨段落第一段/);
    assert.match(res.text, /\[warn\]示例代码里的标记不该被解析\[\/warn\]/);

    // 标记之外的排版照常渲染（内容里的 Markdown 由服务端处理）
    assert.match(res.text, /这是<strong>警示<\/strong>内容/);
    assert.match(res.text, /<li>列表项一<\/li>/);
  });

  it('正文容器带扫描根标记，且引入引擎脚本与主题自己的定义脚本', async () => {
    const res = await current.admin.request('GET', `/post/${POST_SLUG}`);
    assert.match(res.text, /class="df-prose" data-rn-shortcodes/);
    assert.match(res.text, new RegExp(`<script src="${RUNTIME_PREFIX}ricenote-shortcodes\\.js\\?v=`));
    // 主题自己的定义脚本：内核只交付引擎，具体短代码来自主题
    assert.ok(
      res.text.includes(`${THEME_SHORTCODE_SCRIPT}?v=`),
      '页面应引入主题自带的短代码定义脚本'
    );
  });

  it('主题资源地址带当前主题版本指纹（改了资源就必须提升版本，否则访客拿到旧文件）', async () => {
    const manifest = JSON.parse(
      readFileSync(path.join(rootDir, 'themes/default/theme.json'), 'utf8')
    ) as { version: string };

    const res = await current.admin.request('GET', `/post/${POST_SLUG}`);
    const version = manifest.version;
    assert.ok(version.length > 0, '主题清单应有版本号');
    // 样式与脚本都要带指纹：只带一半等于改另一半时访客拿不到新文件
    assert.ok(
      res.text.includes(`/theme-assets/rice.default/css/style.css?v=${version}`),
      `样式地址应带主题版本指纹（期望 ?v=${version}）`
    );
    assert.ok(
      res.text.includes(`${THEME_SHORTCODE_SCRIPT}?v=${version}`),
      `脚本地址应带主题版本指纹（期望 ?v=${version}）`
    );
  });
});

describe('独立页面：与文章同一条链路', () => {
  it('页面正文同样保留标记并交付引擎', async () => {
    const res = await current.admin.request('GET', `/page/${PAGE_SLUG}`);
    assert.equal(res.status, 200, res.text.slice(0, 200));
    assert.match(res.text, /\[warn\]页面警示\[\/warn\]/);
    assert.match(res.text, /class="df-prose" data-rn-shortcodes/);
    assert.match(res.text, new RegExp(`<script src="${RUNTIME_PREFIX}ricenote-shortcodes\\.js\\?v=`));
  });
});

describe('引擎产物与主题示例脚本可获取', () => {
  it('引擎产物是可直接执行的脚本，且不经过站点兜底', async () => {
    const asset = await fetch(`${current.origin}${RUNTIME_PREFIX}ricenote-shortcodes.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);

    const code = await asset.text();
    // 全局名是主题侧的注册入口；扫描根属性说明约定的常量已打进产物
    assert.match(code, /RiceNoteShortcodes/);
    assert.match(code, /data-rn-shortcodes/);
  });

  it('路径穿越写法拿不到目录外的文件', async () => {
    const escaped = await fetch(`${current.origin}${RUNTIME_PREFIX}%2e%2e%2fpackage.json`);
    assert.notEqual(escaped.status, 200);
  });

  it('默认主题自带的示例脚本可获取', async () => {
    const asset = await fetch(`${current.origin}${THEME_SHORTCODE_SCRIPT}`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
    assert.match(await asset.text(), /define\(\{[\s\S]*name: 'warn'/);
  });
});

describe('纯文字场合不留标记', () => {
  it('文章摘录不含标记（SEO 描述与列表摘要都取自它）', async () => {
    const res = await current.admin.request('GET', `/api/admin/posts/${postId}`);
    assert.equal(res.status, 200, res.text);

    // 只针对摘录本身：正文与渲染结果里当然保留着标记，那正是前台解析的依据
    const { excerpt } = data<{ excerpt: string }>(res);
    assert.doesNotMatch(excerpt, /\[warn/);
    assert.match(excerpt, /正文开始/);
    assert.match(excerpt, /跨段落第二段/);
  });

  it('独立页面的 meta description 不含标记', async () => {
    const res = await current.admin.request('GET', `/page/${PAGE_SLUG}`);
    const description = /<meta name="description" content="([^"]*)"/.exec(res.text)?.[1] ?? '';
    assert.ok(description.length > 0, '页面应输出 description');
    assert.doesNotMatch(description, /\[warn/);
    assert.match(description, /页面警示/);
  });

  it('订阅源里既没有标记、也没有因剥离而变空的段落', async () => {
    const feed = (await current.admin.request('GET', '/feed.xml')).text;
    assert.equal(feed.includes('[warn'), false, feed.slice(0, 400));
    assert.match(feed, /正文开始/);
    assert.doesNotMatch(feed, /<p><\/p>/);
  });
});

describe('未改造主题的降级：短代码原样显示为文字，页面不报错', () => {
  it('切到未引入引擎的主题后，页面正常但不再交付引擎', async () => {
    const activated = await current.admin.request('POST', '/api/admin/themes/rice.minimal/activate');
    assert.equal(activated.status, 200, activated.text);

    const res = await current.admin.request('GET', `/post/${POST_SLUG}`);
    assert.equal(res.status, 200, res.text.slice(0, 200));
    // 标记仍在正文里，只是没有人解析它 —— 显示为文字，功能不受影响
    assert.match(res.text, /\[warn\]行内\[\/warn\]/);
    assert.equal(res.text.includes('ricenote-shortcodes.js'), false);
  });

  it('切回默认主题后引擎重新交付（激活即时生效，无需重启）', async () => {
    const activated = await current.admin.request('POST', '/api/admin/themes/rice.default/activate');
    assert.equal(activated.status, 200, activated.text);

    const res = await current.admin.request('GET', `/post/${POST_SLUG}`);
    assert.match(res.text, /ricenote-shortcodes\.js\?v=/);
  });
});
