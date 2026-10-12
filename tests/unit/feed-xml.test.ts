/**
 * RSS 订阅插件的纯逻辑单元测试 —— 离线、无需数据库。
 *
 * 压着的性质：
 * - 订阅源必须是**合法 XML**：标题、链接、摘要里的 `&`、`<`、引号都要转义，
 *   否则一个带 `&` 的站点标题就会让整个订阅源解析失败（阅读器直接报错）；
 * - `pubDate` 必须符合 RSS 2.0 要求的 RFC 822 且带时区，否则阅读器会按本地时区猜测，
 *   发布时间出现偏差；
 * - **posts 插件未启用时不能报错**：要返回结构合法的空订阅源 —— 这是"插件可独立启停"的承诺；
 * - 摘要要截断，避免个别超长摘要把订阅源撑到阅读器拒绝解析。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFeedDiscoverySlot } from '../../plugins/official/feed/src/discovery.js';
import { createFeedRoute } from '../../plugins/official/feed/src/feed.js';
import type { FeedRuntimeLike, FeedSettings } from '../../plugins/official/feed/src/types.js';
import { clampInt, clip, escapeXml, formatRfc822 } from '../../plugins/official/feed/src/util.js';

/* ------------------------------ 测试替身 ------------------------------ */

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** 极简的响应替身：只实现订阅路由真正用到的那几个方法（header 需可链式调用）。 */
function createReply(captured: Captured): Record<string, unknown> {
  const reply: Record<string, unknown> = {
    header(name: string, value: string) {
      captured.headers[name] = value;
      return reply;
    },
    send(payload?: string) {
      captured.body = payload ?? '';
    },
    json() {},
    html() {},
    redirect() {}
  };

  // 路由会写 `reply.statusCode = 200`，这里把它同步到 captured 供断言
  Object.defineProperty(reply, 'statusCode', {
    get: () => captured.status,
    set: (value: number) => {
      captured.status = value;
    }
  });

  return reply;
}

interface PostLike {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  publishedAt?: string;
  updatedAt?: string;
  createdAt: string;
  terms: { id: number; name: string; slug: string; type: string }[];
}

const POST: PostLike = {
  id: 1,
  title: 'RSS & 订阅 <入门>',
  slug: 'rss-guide',
  excerpt: '一篇介绍订阅的短文',
  publishedAt: '2026-10-12T08:00:00.000Z',
  updatedAt: '2026-10-12T09:00:00.000Z',
  createdAt: '2026-10-10T00:00:00.000Z',
  terms: [{ id: 3, name: '教程', slug: 'howto', type: 'category' }]
};

const SETTINGS: FeedSettings = {
  enableFeed: true,
  itemLimit: 20,
  fullText: false,
  cacheMaxAge: 1800
};

/** 构造运行时替身：`settings` 允许只覆盖部分字段（其余用默认值补齐）。 */
function runtimeOf(
  overrides: Omit<Partial<FeedRuntimeLike>, 'settings'> & { settings?: Partial<FeedSettings> } = {}
) {
  return {
    siteTitle: '我的站点 & 笔记',
    siteDescription: '记录 <思考> 的地方',
    siteUrl: 'https://example.com',
    language: 'zh-CN',
    settings: { ...SETTINGS, ...(overrides.settings ?? {}) },
    posts: () => undefined,
    ...overrides
  } as FeedRuntimeLike;
}

/** 文章服务替身：只实现订阅路由用到的方法。 */
function postsStub(items: PostLike[], detailHtml = '<p>全文</p>') {
  return {
    async listPublished() {
      return { items, total: items.length };
    },
    async findPublishedById(id: number) {
      const row = items.find((item) => item.id === id);
      return row ? { ...row, html: detailHtml } : undefined;
    }
  } as never;
}

async function renderFeed(runtime: FeedRuntimeLike, logs: string[] = []) {
  const captured: Captured = { status: 0, headers: {}, body: '' };
  const spec = createFeedRoute({
    runtime,
    log: (message) => logs.push(message)
  });

  assert.equal(spec.method, 'GET');
  assert.equal(spec.path, '/feed.xml');

  const reply = createReply(captured);
  await spec.handler({} as never, reply as never);
  return captured;
}

/* ------------------------------ 工具函数 ------------------------------ */

describe('feed 工具函数', () => {
  it('XML 转义覆盖 & < > 引号', () => {
    assert.equal(escapeXml('a & b < c > d "e" \'f\''), 'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;');
  });

  it('RFC 822 时间戳带星期、英文月份与 GMT 时区', () => {
    assert.equal(formatRfc822('2026-10-12T08:00:00.000Z'), 'Mon, 12 Oct 2026 08:00:00 GMT');
    assert.equal(formatRfc822(new Date('2026-01-01T00:00:00.000Z')), 'Thu, 01 Jan 2026 00:00:00 GMT');
  });

  it('无法解析的时间与缺省值返回 undefined（由调用方省略该标签）', () => {
    assert.equal(formatRfc822(undefined), undefined);
    assert.equal(formatRfc822('not-a-date'), undefined);
  });

  it('摘要超长时截断并以省略号收尾', () => {
    assert.equal(clip('abcdef', 4), 'abc…');
    assert.equal(clip('  ab  ', 10), 'ab');
  });

  it('clampInt 收敛为闭区间内的整数，非法值回退', () => {
    assert.equal(clampInt('7', 1, 100, 20), 7);
    assert.equal(clampInt(0, 1, 100, 20), 1);
    assert.equal(clampInt(9999, 1, 100, 20), 100);
    assert.equal(clampInt('abc', 1, 100, 20), 20);
    assert.equal(clampInt(undefined, 1, 100, 20), 20);
  });
});

/* ------------------------------ 订阅源输出 ------------------------------ */

describe('GET /feed.xml', () => {
  it('输出合法 RSS 2.0 骨架，站点标题与描述中的 & < 被转义', async () => {
    const captured = await renderFeed(runtimeOf({ posts: () => postsStub([]) }));

    assert.equal(captured.status, 200);
    assert.equal(captured.headers['content-type'], 'application/rss+xml; charset=utf-8');
    assert.equal(captured.headers['cache-control'], 'public, max-age=1800');

    assert.ok(captured.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(captured.body.includes('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">'));
    assert.ok(captured.body.includes('<title>我的站点 &amp; 笔记</title>'));
    assert.ok(captured.body.includes('<description>记录 &lt;思考&gt; 的地方</description>'));
    assert.ok(captured.body.includes('<link>https://example.com</link>'));
    assert.ok(captured.body.includes('<language>zh-CN</language>'));
    // 自引用地址：供阅读器做"订阅源已迁移"判断
    assert.ok(
      captured.body.includes(
        '<atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>'
      )
    );
    assert.ok(captured.body.includes('</channel>\n</rss>'));
  });

  it('条目含标题、链接、guid、RFC 822 时间与分类，且逐个转义', async () => {
    const captured = await renderFeed(runtimeOf({ posts: () => postsStub([POST]) }));

    assert.ok(captured.body.includes('<title>RSS &amp; 订阅 &lt;入门&gt;</title>'));
    assert.ok(captured.body.includes('<link>https://example.com/post/rss-guide</link>'));
    assert.ok(
      captured.body.includes('<guid isPermaLink="true">https://example.com/post/rss-guide</guid>')
    );
    assert.ok(captured.body.includes('<pubDate>Mon, 12 Oct 2026 08:00:00 GMT</pubDate>'));
    assert.ok(captured.body.includes('<category>教程</category>'));
    assert.ok(captured.body.includes('<description>一篇介绍订阅的短文</description>'));
  });

  it('缺 publishedAt 时回退到 updatedAt / createdAt 作为发布时间', async () => {
    const { publishedAt: _published, ...row } = POST;
    const captured = await renderFeed(runtimeOf({ posts: () => postsStub([row as PostLike]) }));
    assert.ok(captured.body.includes('<pubDate>Mon, 12 Oct 2026 09:00:00 GMT</pubDate>'));
  });

  it('开启全文输出时用渲染结果填充 description', async () => {
    const captured = await renderFeed(
      runtimeOf({
        settings: { fullText: true },
        posts: () => postsStub([POST], '<p>正文 &amp; 更多</p>')
      })
    );
    assert.ok(captured.body.includes('<description>&lt;p&gt;正文 &amp;amp; 更多&lt;/p&gt;</description>'));
  });

  it('只取前 itemLimit 条（超出部分不出现）', async () => {
    const rows: PostLike[] = [POST, { ...POST, id: 2, slug: 'second', title: '第二篇' }];
    const captured = await renderFeed(
      runtimeOf({ settings: { itemLimit: 1 }, posts: () => postsStub(rows) })
    );

    assert.ok(captured.body.includes('/post/rss-guide'));
    assert.equal(captured.body.includes('/post/second'), false);
  });

  it('cacheMaxAge 为 0 时输出 no-cache', async () => {
    const captured = await renderFeed(
      runtimeOf({ settings: { cacheMaxAge: 0 }, posts: () => postsStub([]) })
    );
    assert.equal(captured.headers['cache-control'], 'no-cache');
  });

  it('posts 插件未启用时返回空订阅源并记日志，而不是报错', async () => {
    const logs: string[] = [];
    const captured = await renderFeed(runtimeOf(), logs);

    assert.equal(captured.body.includes('<item>'), false);
    assert.ok(captured.body.includes('<title>我的站点 &amp; 笔记</title>'));
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? '', /posts/);
  });
});

/* ------------------------------ 自动发现链接 ------------------------------ */

describe('head.end 自动发现插槽', () => {
  it('输出指向 /feed.xml 的 alternate 链接，并转义站点标题里的引号', () => {
    const slot = createFeedDiscoverySlot({
      runtime: runtimeOf(),
      html: { escape: escapeXml } as never
    });

    assert.equal(slot.name, 'feed.discovery');
    const html = slot.render({ data: {}, kind: 'home' }) as string;

    assert.ok(html.includes('type="application/rss+xml"'));
    assert.ok(html.includes('href="https://example.com/feed.xml"'));
    assert.ok(html.includes('title="我的站点 &amp; 笔记"'));
  });
});
