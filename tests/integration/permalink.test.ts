/**
 * 「固定链接」端到端：改设置 → 待重启 → 重启 → 新地址生效、旧地址失效、全站链接一起改。
 *
 * 为什么必须端到端：本功能最关键的一条时序约束是"路径接管必须发生在 HTTP 装配之前"。
 * 只测纯函数测不出它 —— 一旦接管时机错位，表现为"设置保存成功、重启后地址却没变"，
 * 这正是最容易交付出去又是最不该出现的缺陷。
 *
 * 装置见同目录 permalink-harness.ts（真实内核 + 真实数据库 + 真实 HTTP）。不联网。
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { data } from './ext-harness.js';
import { bootKernel, resetDatabase, type PermalinkKernel } from './permalink-harness.js';

const POST_SLUG = 'perma-post';
const PAGE_SLUG = 'perma-page';
const TERM_SLUG = 'perma-notes';

let current: PermalinkKernel;
let postId = 0;
let termId = 0;

before(async () => {
  await resetDatabase();
  current = await bootKernel();

  const term = await current.admin.request('POST', '/api/admin/terms', {
    body: { name: '笔记', slug: TERM_SLUG, type: 'category' }
  });
  assert.equal(term.status, 201, term.text);
  termId = data<{ id: number }>(term).id;

  const post = await current.admin.request('POST', '/api/admin/posts', {
    body: {
      title: '固定链接回归',
      slug: POST_SLUG,
      content: '正文',
      status: 'published',
      termIds: [termId]
    }
  });
  assert.equal(post.status, 201, post.text);
  postId = data<{ id: number }>(post).id;

  const page = await current.admin.request('POST', '/api/admin/pages', {
    body: { title: '固定链接页面', slug: PAGE_SLUG, content: '正文', status: 'published' }
  });
  assert.equal(page.status, 201, page.text);
});

after(async () => {
  if (current) await current.stop();
});

describe('扩展点与默认状态：装了不改设置，站点地址与现状一致', () => {
  it('对外声明的两个扩展点都是 server 作用域、由本插件提供', () => {
    const registry = current.kernel.extensions;
    for (const point of ['rice.permalink.schemes', 'rice.permalink.tokens'] as const) {
      const declaration = registry.declarationOf(point);
      assert.ok(declaration, `缺扩展点声明：${point}`);
      assert.equal(declaration.scope, 'server');
      assert.equal(declaration.providerId, 'rice.permalink');
      // 内置方案不是"贡献"，因此默认没有任何第三方贡献
      assert.deepEqual(registry.contributionsOwnedBy('rice.permalink'), []);
    }
  });

  it('后台接口列出三类方案：默认模板即内建路径，且标记未自定义', async () => {
    const res = await current.admin.request('GET', '/api/admin/permalink/settings');
    assert.equal(res.status, 200, res.text);

    const { schemes } = data<{ schemes: { id: string; template: string; defaultTemplate: string }[] }>(res);
    const byId = new Map(schemes.map((scheme) => [scheme.id, scheme]));
    assert.equal(byId.get('post')?.template, '/post/{slug}');
    assert.equal(byId.get('page')?.template, '/page/{slug}');
    assert.equal(byId.get('category')?.template, '/category/{slug}');
    assert.equal(byId.get('post')?.template, byId.get('post')?.defaultTemplate);
  });

  it('默认模板下三条前台地址照常可访问', async () => {
    for (const url of [`/post/${POST_SLUG}`, `/page/${PAGE_SLUG}`, `/category/${TERM_SLUG}`]) {
      const res = await current.admin.request('GET', url);
      assert.equal(res.status, 200, `${url} 应可访问：${res.text.slice(0, 120)}`);
    }
  });

  it('实时预览接口按示例数据给出地址与原因', async () => {
    const ok = await current.admin.request('POST', '/api/admin/permalink/preview', {
      body: { schemeId: 'post', template: '/{year}/{month}/{day}/{slug}' }
    });
    assert.equal(ok.status, 200, ok.text);
    const okData = data<{ valid: boolean; path?: string }>(ok);
    assert.equal(okData.valid, true);
    assert.equal(okData.path, '/2026/10/14/hello-world');

    const bad = await current.admin.request('POST', '/api/admin/permalink/preview', {
      body: { schemeId: 'post', template: '/archives/{directory}/' }
    });
    const badData = data<{ valid: boolean; issues: { message: string }[] }>(bad);
    assert.equal(badData.valid, false);
    assert.ok(badData.issues.length > 0);
  });
});

describe('保存校验：非法模板被拒绝且不改动已存配置', () => {
  it('未声明参数（{directory}）、缺参数、未知方案一律 400', async () => {
    const cases: Record<string, string>[] = [
      { post: '/archives/{directory}/' },
      { post: '/archives/' },
      { page: '/{category}/{slug}' },
      { unknown: '/x/{slug}' }
    ];

    for (const templates of cases) {
      const res = await current.admin.request('PUT', '/api/admin/permalink/settings', { body: { templates } });
      assert.equal(res.status, 400, `应拒绝：${JSON.stringify(templates)}`);
      assert.match(res.text, /RN_VALIDATION_FAILED/);
    }

    // 被拒绝的写入没有落库：读取仍是默认模板
    const settings = await current.admin.request('GET', '/api/admin/permalink/settings');
    const { schemes } = data<{ schemes: { id: string; template: string }[] }>(settings);
    assert.equal(schemes.find((scheme) => scheme.id === 'post')?.template, '/post/{slug}');
  });
});

describe('改设置 → 待重启 → 重启后新地址生效', () => {
  it('保存三类模板成功，并标记需要重启', async () => {
    const res = await current.admin.request('PUT', '/api/admin/permalink/settings', {
      body: {
        templates: {
          post: '/archives/{cid}/',
          page: '/{slug}.html',
          category: '/c/{mid}/'
        }
      }
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(data<{ restartRequired: boolean }>(res).restartRequired, true);
    // 「待重启」是既有机制：后台顶栏据此出现重启入口
    assert.equal(current.kernel.runtime.state().restartRequired, true);
  });

  it('重启前旧地址仍然可用（新地址尚未装配）', async () => {
    const res = await current.admin.request('GET', `/post/${POST_SLUG}`);
    assert.equal(res.status, 200);
  });

  it('重启后：新地址可访问、旧地址 404、canonical/订阅源/站点地图一致', async () => {
    await current.stop();
    current = await bootKernel();

    // 文章：模板 /archives/{cid}/ —— 带与不带尾斜杠都应命中（尾斜杠宽容）
    for (const url of [`/archives/${postId}/`, `/archives/${postId}`]) {
      const res = await current.admin.request('GET', url);
      assert.equal(res.status, 200, `${url} 应可访问：${res.text.slice(0, 120)}`);
    }
    const html = (await current.admin.request('GET', `/archives/${postId}/`)).text;
    assert.match(html, new RegExp(`rel="canonical" href="[^"]*\\/archives\\/${postId}\\/"`));

    // 旧地址失效（本次不做 301 兼容，与 Typecho 一致）
    assert.equal((await current.admin.request('GET', `/post/${POST_SLUG}`)).status, 404);

    // 页面：模板 /{slug}.html —— 必须带后缀才算命中
    assert.equal((await current.admin.request('GET', `/${PAGE_SLUG}.html`)).status, 200);
    assert.equal((await current.admin.request('GET', `/${PAGE_SLUG}`)).status, 404);
    assert.equal((await current.admin.request('GET', `/page/${PAGE_SLUG}`)).status, 404);

    // 分类：模板 /c/{mid}/ —— 由分类 ID 命中
    assert.equal((await current.admin.request('GET', `/c/${termId}/`)).status, 200);
    assert.equal((await current.admin.request('GET', `/category/${TERM_SLUG}`)).status, 404);

    // 全站联动：订阅源与站点地图必须跟着改，否则会出现"页面地址变了、RSS 还指旧地址"
    const feed = (await current.admin.request('GET', '/feed.xml')).text;
    assert.match(feed, new RegExp(`/archives/${postId}/`));
    const sitemap = (await current.admin.request('GET', '/sitemap.xml')).text;
    assert.match(sitemap, new RegExp(`/archives/${postId}/`));

    // 分类归档页里的文章链接同样使用新地址
    const archive = (await current.admin.request('GET', `/c/${termId}/`)).text;
    assert.match(archive, new RegExp(`/archives/${postId}/`));

    // 首页仍可访问（未被接管的路由不受影响）
    assert.equal((await current.admin.request('GET', '/')).status, 200);
  });

  it('重启后方案视图反映新模板，且标记为已自定义', async () => {
    const res = await current.admin.request('GET', '/api/admin/permalink/settings');
    const { schemes } = data<{
      schemes: { id: string; template: string; configured: boolean }[];
    }>(res);
    const post = schemes.find((scheme) => scheme.id === 'post');
    assert.equal(post?.template, '/archives/{cid}/');
    assert.equal(post?.configured, true);
  });

  it('停用固定链接插件后回到内建地址', async () => {
    await current.kernel.plugins.disable('rice.permalink');
    await current.stop();
    current = await bootKernel();

    assert.equal((await current.admin.request('GET', `/post/${POST_SLUG}`)).status, 200);
    assert.equal((await current.admin.request('GET', `/archives/${postId}/`)).status, 404);
    assert.equal((await current.admin.request('GET', `/page/${PAGE_SLUG}`)).status, 200);
    assert.equal((await current.admin.request('GET', `/category/${TERM_SLUG}`)).status, 200);
  });
});
