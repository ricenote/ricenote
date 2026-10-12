/**
 * 命名扩展点 + 主题「内容自定义字段」的端到端集成测试。
 *
 * 必须端到端（而非 unit）：扩展点的过滤语义只在"内核装配 + 后台会话 + 权限"三者齐备时
 * 才成立，mock 任何一层都测不出"points 不按权限过滤、contributions 却按权限过滤"的非对称；
 * 内容字段的声明来自主题、校验靠白名单、渲染落在模板，横跨 Core / 插件 / 主题。
 *
 * 装置（真实内核 + Fastify + 双会话）见同目录 ext-harness.ts。不新增依赖、不联网。
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bootExtHarness, data, type ExtHarness } from './ext-harness.js';

let h: ExtHarness;
before(async () => {
  h = await bootExtHarness();
});
after(async () => {
  if (h) await h.stop();
});

describe('内核装配：扩展点注册表', () => {
  it('官方插件声明的命名扩展点进入注册表，提供方与作用域正确', () => {
    // 媒体选择器：media 自己声明并贡献；replaceable:false = 只许提供方提供默认实现
    const picker = h.kernel.extensions.declarationOf('rice.media.picker');
    assert.ok(picker, '缺 rice.media.picker 声明');
    assert.equal(picker.scope, 'admin');
    assert.equal(picker.providerId, 'rice.media');
    assert.equal(picker.replaceable, false);
    for (const [point, provider] of [
      ['rice.posts.listActions', 'rice.posts'],
      ['rice.posts.editorBody', 'rice.posts'],
      ['rice.pages.editorBody', 'rice.pages']
    ] as const) {
      const declaration = h.kernel.extensions.declarationOf(point);
      assert.ok(declaration, `缺扩展点声明：${point}`);
      assert.equal(declaration.scope, 'admin');
      assert.equal(declaration.providerId, provider);
    }
  });

  it('editor-enhance 作为贡献方向 posts/pages 的扩展点注册贡献', () => {
    const owned = h.kernel.extensions.contributionsOwnedBy('rice.editor-enhance');
    for (const point of ['rice.posts.listActions', 'rice.posts.editorBody', 'rice.pages.editorBody']) {
      assert.equal(owned.includes(point), true, `editor-enhance 未贡献 ${point}`);
    }
  });
});

describe('GET /api/admin/extensions：points 与 contributions 的非对称过滤', () => {
  it('正常态：admin 会话下 media.picker 的 point 与 contribution 同时下发', async () => {
    const res = await h.admin.request('GET', '/api/admin/extensions');
    assert.equal(res.status, 200);
    const payload = data<{
      points: { name: string; provider: string }[];
      contributions: { point: string; pluginId: string; entryUrl: string }[];
    }>(res);

    assert.ok(payload.points.some((item) => item.name === 'rice.media.picker' && item.provider === 'rice.media'));
    const contribution = payload.contributions.find((item) => item.point === 'rice.media.picker');
    assert.ok(contribution, 'admin 持有 * 权限，media.picker 贡献应下发');
    assert.equal(contribution?.pluginId, 'rice.media');
    assert.equal(contribution?.entryUrl, '/plugin-admin/rice.media/picker.js');
    // 提供方（posts）声明的点也在，与是否存在贡献无关
    assert.ok(payload.points.some((item) => item.name === 'rice.posts.listActions' && item.provider === 'rice.posts'));
  });
  it('权限不足态：受限会话仍看到 point，但看不到需 media.manage 的 contribution', async () => {
    const me = await h.limited.request('GET', '/api/admin/me');
    assert.equal(data<{ permissions: string[] }>(me).permissions.includes('media.manage'), false);

    const res = await h.limited.request('GET', '/api/admin/extensions');
    assert.equal(res.status, 200);
    const payload = data<{ points: { name: string }[]; contributions: { point: string }[] }>(res);
    // points 只按"提供方插件是否启动"过滤：media 已启动 → point 仍在
    assert.ok(payload.points.some((item) => item.name === 'rice.media.picker'), 'points 不应按当前用户权限过滤');
    // contributions 额外按权限过滤：无 media.manage → 该贡献被剔除
    assert.equal(payload.contributions.some((item) => item.point === 'rice.media.picker'), false);
  });
  it('提供方未启用态：media 停用后 point 与 contribution 一并消失且零残留', async () => {
    await h.kernel.plugins.disable('rice.media');
    const res = await h.admin.request('GET', '/api/admin/extensions');
    const payload = data<{ points: { name: string }[]; contributions: { point: string }[] }>(res);
    assert.equal(payload.points.some((item) => item.name === 'rice.media.picker'), false);
    assert.equal(payload.contributions.some((item) => item.point === 'rice.media.picker'), false);
    h.kernel.plugins.assertNoLeaks();
  });
});

describe('render 作用域兼容：SlotRegistry 仍是扩展注册表的门面', () => {
  it('门面与注册表口径一致，第三方插件插槽仍按标准路径渲染', async () => {
    const owned = h.kernel.slots.ownedBy('acme.reading-time');
    assert.deepEqual(owned, ['post.beforeContent']);
    // 门面即别名：插件视角与注册表视角必须指向同一份贡献
    assert.deepEqual(h.kernel.extensions.contributionsOwnedBy('acme.reading-time', 'render'), owned);

    const fragment = await h.kernel.slots.render('post.beforeContent', {
      kind: 'post',
      data: { post: { html: { value: '这是一段用于估算阅读时长的中文正文，重复以形成足够字数。' } } }
    });
    assert.match(fragment, /data-acme-reading-time/);
    assert.match(fragment, /阅读时长/);
  });
  it('主题模板里的标准插槽路径未变：文章页仍渲染出第三方贡献', async () => {
    const created = await h.admin.request('POST', '/api/admin/posts', {
      body: {
        title: '插槽回归',
        slug: 'ext-slot-regression',
        content: '正文足够长以触发阅读时长插槽的估算。'.repeat(8),
        status: 'published'
      }
    });
    assert.equal(created.status, 201, created.text);

    const rendered = await h.admin.request('GET', '/post/ext-slot-regression');
    assert.equal(rendered.status, 200);
    assert.match(rendered.text, /data-acme-reading-time/);
    assert.doesNotMatch(rendered.text, /rn-slot:/, '不应残留 Slot 占位符');
  });
});

describe('server 作用域钩子：串行与错误策略', () => {
  type ChainPayload = { steps: string[] };
  const appendHook = (label: string, seen: string[]) => ({
    name: label,
    apply: async (payload: ChainPayload) => {
      seen.push(label);
      return { steps: [...payload.steps, label] };
    }
  });
  const BOOM = { name: 'boom', apply: async () => { throw new Error('钩子故意失败'); } };

  it('多个钩子按 order 升序串行传递 payload（filter 语义）', async () => {
    const seen: string[] = [];
    const disposers = [
      h.kernel.extensions.contribute('test.hook', 'exttest.server.chain', appendHook('second', seen), { scope: 'server', order: 2 }),
      h.kernel.extensions.contribute('test.hook', 'exttest.server.chain', appendHook('first', seen), { scope: 'server', order: 1 }),
      h.kernel.extensions.contribute('test.hook', 'exttest.server.chain', appendHook('third', seen), { scope: 'server', order: 3 })
    ];
    try {
      const result = await h.kernel.extensions.apply<ChainPayload>('exttest.server.chain', { steps: [] });
      assert.deepEqual(seen, ['first', 'second', 'third']);
      assert.deepEqual(result.steps, ['first', 'second', 'third']);
    } finally {
      for (const dispose of disposers) dispose();
    }
  });
  it('默认 onError=abort：钩子抛错直接上抛，后续钩子不再执行', async () => {
    const seen: string[] = [];
    const disposers = [
      h.kernel.extensions.contribute('test.hook', 'exttest.server.abort', appendHook('ok', seen), { scope: 'server', order: 1 }),
      h.kernel.extensions.contribute('test.hook', 'exttest.server.abort', BOOM, { scope: 'server', order: 2 }),
      h.kernel.extensions.contribute('test.hook', 'exttest.server.abort', appendHook('after', seen), { scope: 'server', order: 3 })
    ];
    try {
      // 数据校验类钩子必须 fail-closed：静默跳过会让未经验证的数据进库
      await assert.rejects(
        () => h.kernel.extensions.apply('exttest.server.abort', { steps: [] }),
        /扩展点 exttest\.server\.abort 的钩子/
      );
      assert.deepEqual(seen, ['ok'], 'abort 后不应继续执行后续钩子（BOOM 未写 seen）');
    } finally {
      for (const dispose of disposers) dispose();
    }
  });
  it('显式 onError=skip：记录后沿用上一版 payload 继续后续钩子', async () => {
    const disposers = [
      h.kernel.extensions.contribute('test.hook', 'exttest.server.skip', appendHook('first', []), { scope: 'server', order: 1 }),
      h.kernel.extensions.contribute('test.hook', 'exttest.server.skip', BOOM, { scope: 'server', order: 2 }),
      h.kernel.extensions.contribute('test.hook', 'exttest.server.skip', appendHook('last', []), { scope: 'server', order: 3 })
    ];
    try {
      const result = await h.kernel.extensions.apply<ChainPayload>('exttest.server.skip', { steps: [] }, { onError: 'skip' });
      // boom 失败被跳过；last 基于 first 产生的 payload 继续，而不是从头再来
      assert.deepEqual(result.steps, ['first', 'last']);
    } finally {
      for (const dispose of disposers) dispose();
    }
  });
});

describe('内容字段端到端：文章与页面', () => {
  let postId = 0;
  let pageId = 0;
  const POST_URL = 'https://cdn.example.com/cover-post.jpg';
  const PAGE_URL = 'https://cdn.example.com/cover-page.jpg';

  it('default 主题声明的字段经 /content-fields 下发', async () => {
    await h.kernel.themeManager.activate('rice.default');
    const res = await h.admin.request('GET', '/api/admin/content-fields');
    assert.equal(res.status, 200);
    const dto = data<{ themeId: string; fields: { key: string; type: string }[] }>(res);
    assert.equal(dto.themeId, 'rice.default');
    const featured = dto.fields.find((field) => field.key === 'featuredImage');
    assert.ok(featured, 'default 主题应声明 featuredImage');
    assert.equal(featured?.type, 'image');
  });
  it('文章：保存已声明字段成功、后台读回、前台渲染出图片', async () => {
    const created = await h.admin.request('POST', '/api/admin/posts', {
      body: { title: '带特色图片的文章', slug: 'ext-post-cover', content: '正文', status: 'published', fields: { featuredImage: POST_URL } }
    });
    assert.equal(created.status, 201, created.text);
    postId = data<{ id: number }>(created).id;

    const detail = await h.admin.request('GET', `/api/admin/posts/${postId}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(data<{ fields: Record<string, unknown> }>(detail).fields, { featuredImage: POST_URL });

    const rendered = await h.admin.request('GET', '/post/ext-post-cover');
    assert.equal(rendered.status, 200);
    assert.match(rendered.text, /df-article__feature/);
    assert.equal(rendered.text.includes(POST_URL), true, '文章页应出现填写的特色图片 URL');
  });
  it('页面：保存已声明字段成功、后台读回、前台渲染出图片', async () => {
    const created = await h.admin.request('POST', '/api/admin/pages', {
      body: { title: '带特色图片的页面', slug: 'ext-page-cover', content: '正文', status: 'published', fields: { featuredImage: PAGE_URL } }
    });
    assert.equal(created.status, 201, created.text);
    pageId = data<{ id: number }>(created).id;

    const detail = await h.admin.request('GET', `/api/admin/pages/${pageId}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(data<{ fields: Record<string, unknown> }>(detail).fields, { featuredImage: PAGE_URL });

    const rendered = await h.admin.request('GET', '/page/ext-page-cover');
    assert.equal(rendered.status, 200);
    assert.match(rendered.text, /df-article__feature/);
    assert.equal(rendered.text.includes(PAGE_URL), true, '页面 HTML 应出现填写的特色图片 URL');
  });
  it('未声明的字段键被拒绝（文章与页面各一遍，400 而非静默丢弃）', async () => {
    // 静默丢弃会让作者以为"填了却没生效"；这里必须有可定位的字段校验失败
    const post = await h.admin.request('POST', '/api/admin/posts', {
      body: { title: '非法字段', content: 'x', status: 'draft', fields: { notDeclared: 'x' } }
    });
    assert.equal(post.status, 400);
    assert.match(post.text, /RN_VALIDATION_FAILED/);
    assert.match(post.text, /notDeclared/);

    const page = await h.admin.request('POST', '/api/admin/pages', {
      body: { title: '非法字段页', slug: 'ext-page-bad', content: 'x', status: 'draft', fields: { notDeclared: 'x' } }
    });
    assert.equal(page.status, 400);
    assert.match(page.text, /RN_VALIDATION_FAILED/);
    assert.match(page.text, /notDeclared/);
  });
  it('为空不渲染：未填写字段的内容前台不输出特色图片', async () => {
    const created = await h.admin.request('POST', '/api/admin/posts', {
      body: { title: '无特色图片', slug: 'ext-post-plain', content: '正文', status: 'published' }
    });
    assert.equal(created.status, 201, created.text);
    const rendered = await h.admin.request('GET', '/post/ext-post-plain');
    assert.equal(rendered.status, 200);
    // "为空不渲染"是可回退契约：主题升级后也不能凭空插一张图
    assert.doesNotMatch(rendered.text, /df-article__feature/);
  });
  it('换主题后旧键不展示：读取按当前声明过滤，但库里旧值保留', async () => {
    await h.kernel.themeManager.activate('rice.minimal');

    const fieldsRes = await h.admin.request('GET', '/api/admin/content-fields');
    assert.equal(data<{ themeId: string }>(fieldsRes).themeId, 'rice.minimal');
    assert.deepEqual(data<{ fields: unknown[] }>(fieldsRes).fields, []);

    // 后台读取被当前声明过滤：换到未声明该字段的主题后不再暴露旧键
    const post = await h.admin.request('GET', `/api/admin/posts/${postId}`);
    assert.deepEqual(data<{ fields: Record<string, unknown> }>(post).fields, {});
    const page = await h.admin.request('GET', `/api/admin/pages/${pageId}`);
    assert.deepEqual(data<{ fields: Record<string, unknown> }>(page).fields, {});

    // 切回 default：旧值仍在库里（过滤只作用于读取，不会删数据）
    await h.kernel.themeManager.activate('rice.default');
    const restored = await h.admin.request('GET', `/api/admin/posts/${postId}`);
    assert.deepEqual(data<{ fields: Record<string, unknown> }>(restored).fields, { featuredImage: POST_URL });
  });
});

describe('零残留：插件停用后扩展点与贡献消失', () => {
  it('editor-enhance 停用后其贡献消失，提供方的声明保留', async () => {
    assert.equal(h.kernel.extensions.contributionsOwnedBy('rice.editor-enhance').includes('rice.posts.editorBody'), true);

    await h.kernel.plugins.disable('rice.editor-enhance');
    assert.deepEqual(h.kernel.extensions.contributionsOwnedBy('rice.editor-enhance'), []);
    // 贡献方消失，但 posts 声明的扩展点仍在（后台据此仍能渲染默认内容）
    assert.equal(h.kernel.extensions.declarationOf('rice.posts.editorBody')?.providerId, 'rice.posts');

    const res = await h.admin.request('GET', '/api/admin/extensions');
    const payload = data<{ points: { name: string }[]; contributions: { pluginId: string }[] }>(res);
    assert.equal(payload.contributions.some((item) => item.pluginId === 'rice.editor-enhance'), false);
    assert.ok(payload.points.some((item) => item.name === 'rice.posts.editorBody'));
    h.kernel.plugins.assertNoLeaks();
  });
  it('reading-time 停用后标准插槽贡献消失，门面渲染为空', async () => {
    await h.kernel.plugins.disable('acme.reading-time');
    assert.deepEqual(h.kernel.slots.ownedBy('acme.reading-time'), []);
    assert.equal(
      await h.kernel.slots.render('post.beforeContent', { kind: 'post', data: { post: { html: { value: '中文正文' } } } }),
      ''
    );
    h.kernel.plugins.assertNoLeaks();
  });
});
