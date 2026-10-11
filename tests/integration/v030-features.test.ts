/**
 * v0.3.0 架构改造的集成测试。
 *
 * 覆盖新的端到端链路：
 * 1. `rice.pages` 的完整闭环（新建 → 渲染 `/page/:slug` → 删除）与页面模板选择；
 * 2. `rice.navigation` 的导航栏（引用页面 / 文章 / 自定义链接，顺序与失效处理）；
 * 3. 站点信息运行时覆盖：改完**立即**反映到渲染结果与 `core.site@1`（无需重启）；
 * 4. 插件设置：声明式表单 DTO、字段级校验、以及"保存后需重启"的状态标记；
 * 5. 待生效标记跨启动的持久化与清除（模拟一次软重启）。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import mysql from 'mysql2/promise';
import { isRiceNoteError } from '@ricenote/shared';
import type {
  ContentNavigationService,
  ContentPagesService,
  ContentPostsService,
  CoreSiteService,
  CoreThemeService,
  PageDetail
} from '@ricenote/shared';
import { bootstrap, loadConfig, type RiceNoteKernel } from '@ricenote/core';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** 独立测试库：node:test 并行跑不同文件，库名必须互不重叠。 */
const TEST_DB = 'ricenote_test_v030';

const SEED = [
  'identity',
  'authorization',
  'posts',
  'taxonomy',
  'media',
  'pages',
  'navigation',
  'search',
  'seo',
  'reading-time'
];

let kernel: RiceNoteKernel | undefined;

async function recreateTestDatabase(): Promise<void> {
  const base = loadConfig({ rootDir });
  const connection = await mysql.createConnection({
    host: base.database.host,
    port: base.database.port,
    user: base.database.user,
    password: base.database.password
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await connection.query(
      `CREATE DATABASE \`${TEST_DB}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

before(async () => {
  await recreateTestDatabase();
  kernel = await bootstrap({
    rootDir,
    overrides: { database: { name: TEST_DB }, logLevel: 'error', seedPlugins: SEED }
  });
});

after(async () => {
  if (kernel) await kernel.shutdown();
});

const pages = (): ContentPagesService => kernel!.services.use<ContentPagesService>('content.pages@1');
const posts = (): ContentPostsService => kernel!.services.use<ContentPostsService>('content.posts@1');
const navigation = (): ContentNavigationService =>
  kernel!.services.use<ContentNavigationService>('content.navigation@1');
const siteService = (): CoreSiteService => kernel!.services.use<CoreSiteService>('core.site@1');
const themeService = (): CoreThemeService => kernel!.services.use<CoreThemeService>('core.theme@1');

const REQUEST = {
  method: 'GET',
  url: '/',
  params: {} as Record<string, string>,
  query: {} as Record<string, unknown>,
  body: undefined,
  headers: {},
  requestId: 'v030-test',
  raw: {}
};

/** 按 HTTP 层的约定渲染一个已注册的页面路由（与 m4-features 测试一致）。 */
async function renderPageRoute(
  name: string,
  options: { url?: string; params?: Record<string, string> } = {}
) {
  assert.ok(kernel);
  const page = kernel.router.pages().find((route) => route.name === name);
  assert.ok(page, `页面路由未注册：${name}`);

  const url = options.url ?? '/';
  const viewModel = await page.handler({ ...REQUEST, url, params: options.params ?? {} });

  const output = await kernel.renderer.render({
    kind: viewModel.kind,
    title: viewModel.title,
    canonicalUrl: kernel.renderer.absolute(viewModel.canonicalUrl ?? url),
    data: viewModel.data,
    ...(viewModel.template ? { template: viewModel.template } : {}),
    ...(viewModel.status ? { status: viewModel.status } : {}),
    ...(viewModel.cacheTags ? { cacheTags: viewModel.cacheTags } : {}),
    cacheable: page.cacheable
  });

  return { viewModel, output };
}

/** 渲染导航插槽（模拟主题中的 `{{ slot('header.navigation') }}`）。 */
async function renderNavigationSlot(url = '/'): Promise<string> {
  assert.ok(kernel);
  return kernel.slots.render('header.navigation', {
    kind: 'home',
    data: {},
    request: { ...REQUEST, url }
  });
}

describe('rice.pages：独立页面闭环', () => {
  it('插件注册了页面路由、服务契约与后台菜单', () => {
    assert.ok(kernel);
    assert.ok(kernel.router.pages().some((route) => route.name === 'page.show'));
    assert.ok(kernel.services.has('content.pages@1'));
    assert.ok(kernel.adminMenu.list().some((item) => item.id === 'pages.list'));
    // 导航插槽已交还 navigation 插件：页面插件不再自行往导航里塞链接
    assert.ok(
      !kernel.slots.ownedBy('rice.pages').includes('header.navigation'),
      'pages 不应再注册 header.navigation'
    );
  });

  it('新建页面后可按别名渲染，正文经消毒输出', async () => {
    const created = await pages().save({
      payload: {
        title: '关于我们',
        slug: 'about',
        content: '# 我们是谁\n\n这是一段**说明**文字。\n\n<script>alert(1)</script>',
        status: 'published'
      }
    });
    assert.ok(created.id > 0);

    const { viewModel, output } = await renderPageRoute('page.show', { params: { slug: 'about' } });

    assert.equal(viewModel.kind, 'page');
    assert.equal(viewModel.title, '关于我们');
    assert.equal(output.status, 200);
    assert.match(output.html, /我们是谁/);
    assert.match(output.html, /这是一段/);
    // XSS 载荷被消毒层移除
    assert.doesNotMatch(output.html, /<script>alert\(1\)<\/script>/);
  });

  it('页面不再自动出现在导航插槽（导航交由 navigation 插件决定）', async () => {
    await pages().save({
      payload: { title: '草稿页', slug: 'draft-page', content: '未公开内容', status: 'draft' }
    });

    const html = await renderNavigationSlot();
    assert.equal(html, '', '未添加导航项时导航插槽应为空');
  });

  it('未发布或不存在时返回 404 视图模型（走主题的 404 模板）', async () => {
    const { viewModel, output } = await renderPageRoute('page.show', { params: { slug: 'draft-page' } });
    assert.equal(viewModel.kind, '404');
    assert.equal(output.status, 404);
  });

  it('地址冲突被拒绝', async () => {
    await assert.rejects(
      () =>
        pages().save({
          payload: { title: '重复地址', slug: 'about', content: 'x', status: 'draft' }
        }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_PAGE_SLUG_CONFLICT'
    );
  });

  it('删除后前台不再可见', async () => {
    const created = await pages().save({
      payload: { title: '临时页', slug: 'temp', content: 'x', status: 'published' }
    });
    await pages().remove(created.id);

    const found = await pages().findPublishedBySlug('temp');
    assert.equal(found, undefined);
  });
});

describe('rice.navigation：导航栏', () => {
  /** 按别名查任意状态的页面 ID（草稿不在 navItems() 里）。 */
  async function anyPageId(slug: string): Promise<number> {
    const result = await pages().listForAdmin({ page: 1, pageSize: 100, status: 'all' });
    const found = result.items.find((item) => item.slug === slug);
    assert.ok(found, `未找到页面：${slug}`);
    return found.id;
  }

  /** 在描述体内共享的已发布文章（后续用例引用它）。 */
  let postId = 0;

  it('插件注册了服务契约、导航插槽、管理路由与后台菜单', () => {
    assert.ok(kernel);
    assert.ok(kernel.services.has('content.navigation@1'));
    assert.ok(kernel.slots.ownedBy('rice.navigation').includes('header.navigation'));
    assert.ok(
      kernel.router.adminRoutesList().some((route) => route.path.startsWith('/navigation')),
      '管理 API 应注册在 /navigation 前缀下'
    );
  });

  it('后台界面由 manifest 声明：菜单带 entryUrl，界面由插件自带', () => {
    assert.ok(kernel);
    const items = kernel.adminMenu.list();
    const navigation = items.find((item) => item.path === '/navigation');

    assert.ok(navigation, '声明了 admin.pages 的插件应自动注册菜单');
    assert.equal(navigation?.pluginId, 'rice.navigation');
    assert.equal(navigation?.permission, 'nav.view');
    assert.equal(
      navigation?.entryUrl,
      '/plugin-admin/rice.navigation/main.js',
      'Core 应把 ./admin/main.js 换算成前端可直接 import 的托管 URL'
    );

    // 已启动插件的入口默认可用（不显式设置 available）
    const declared = kernel.plugins.declaredAdminPages();
    assert.equal(declared.find((item) => item.path === '/navigation')?.available, true);
  });

  it('自定义链接、页面与文章都能加入导航，并按后台顺序渲染', async () => {
    const created = await posts().save({
      authorId: 0,
      payload: { title: '导航测试文章', slug: 'nav-post', content: '正文', status: 'published' }
    });
    postId = created.id;

    await navigation().save({ payload: { type: 'page', refId: await anyPageId('about') } });
    // 引用文章时可以覆盖文案；页面则不填文案以跟随标题
    await navigation().save({ payload: { type: 'post', refId: postId, label: '精选文章' } });
    await navigation().save({
      payload: { type: 'custom', label: 'GitHub', href: 'https://github.com/ricenote', newTab: true }
    });

    const items = await navigation().listForAdmin();
    assert.deepEqual(
      items.map((item) => item.type),
      ['page', 'post', 'custom']
    );
    assert.deepEqual(
      items.map((item) => item.displayLabel),
      ['关于我们', '精选文章', 'GitHub'],
      '页面项跟随目标标题，文章项使用覆盖文案'
    );

    const html = await renderNavigationSlot('/');
    assert.match(html, /<a href="\/page\/about" class="rn-nav-link">关于我们<\/a>/);
    assert.match(html, /href="\/post\/nav-post"/);
    assert.match(html, /href="https:\/\/github.com\/ricenote"/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/, '新窗口链接必须带 rel 防护');
  });

  it('当前页面高亮：只有匹配项带 aria-current', async () => {
    const active = await renderNavigationSlot('/page/about');
    assert.match(active, /class="rn-nav-link rn-nav-link--active" aria-current="page"/);

    const elsewhere = await renderNavigationSlot('/');
    assert.doesNotMatch(elsewhere, /aria-current/);
    // 外部链接永远不算"当前页"
    assert.doesNotMatch(await renderNavigationSlot('/github.com/ricenote'), /aria-current/);
  });

  it('高亮对中文地址同样生效（请求行是编码过的，导航地址是原始字符）', async () => {
    const page = await pages().save({
      payload: { title: '中文地址页', slug: '关于', content: 'x', status: 'published' }
    });
    await navigation().save({ payload: { type: 'page', refId: page.id } });

    // 编码后的请求路径（与真实 HTTP 请求行一致）
    const encoded = await renderNavigationSlot('/page/%E5%85%B3%E4%BA%8E');
    assert.match(encoded, /href="\/page\/关于"[^>]*aria-current="page"/);
  });

  it('停用项不渲染，但配置保留', async () => {
    const custom = (await navigation().listForAdmin()).find((item) => item.type === 'custom');
    assert.ok(custom);

    await navigation().save({
      id: custom.id,
      payload: {
        type: 'custom',
        label: 'GitHub',
        href: 'https://github.com/ricenote',
        newTab: true,
        enabled: false
      }
    });

    assert.doesNotMatch(await renderNavigationSlot('/'), /github\.com/);
    const after = (await navigation().listForAdmin()).find((item) => item.id === custom.id);
    assert.equal(after?.enabled, false);
    assert.equal(after?.href, 'https://github.com/ricenote', '停用不影响配置本身');
  });

  it('目标未发布：可以保存引用，但前台跳过且后台给出状态', async () => {
    const draftId = await anyPageId('draft-page');
    const created = await navigation().save({
      payload: { type: 'page', refId: draftId, label: '草稿页入口' }
    });

    const item = (await navigation().listForAdmin()).find((row) => row.id === created.id);
    assert.equal(item?.target?.exists, true, '目标存在（只是没发布）');
    assert.equal(item?.target?.published, false);
    assert.equal(item?.href, null, '未发布时不给地址');

    const html = await renderNavigationSlot('/');
    assert.doesNotMatch(html, /draft-page/, '未发布目标不出现在前台');
    assert.doesNotMatch(html, /草稿页入口/);
  });

  it('目标被删除：后台标记不存在，前台自动跳过', async () => {
    const temp = await pages().save({
      payload: { title: '待删除页面', slug: 'nav-temp', content: 'x', status: 'published' }
    });
    const item = await navigation().save({ payload: { type: 'page', refId: temp.id } });
    assert.match(await renderNavigationSlot('/'), /nav-temp/);

    await pages().remove(temp.id);

    const after = (await navigation().listForAdmin()).find((row) => row.id === item.id);
    assert.equal(after?.target?.exists, false);
    assert.equal(after?.href, null);
    assert.equal(after?.displayLabel, '', '没有文案且目标已删除时无从展示');
    assert.doesNotMatch(await renderNavigationSlot('/'), /nav-temp/);
  });

  it('目标选择器只给出已发布内容，并附别名用于区分同名项', async () => {
    const pageOptions = await navigation().targets({ type: 'page' });
    assert.ok(pageOptions.some((item) => item.title === '关于我们' && item.subtitle === 'about'));
    assert.ok(
      !pageOptions.some((item) => item.subtitle === 'draft-page'),
      '草稿不应出现在候选中（选了也不会显示）'
    );

    const postOptions = await navigation().targets({ type: 'post' });
    assert.ok(postOptions.some((item) => item.id === postId));

    // 关键词过滤交给内容插件（页面走后台查询、文章走全文检索）
    const filtered = await navigation().targets({ type: 'post', keyword: '导航' });
    assert.ok(filtered.some((item) => item.id === postId));
  });

  it('顺序调整：上移/下移改变顺序，边界处幂等', async () => {
    const before = (await navigation().listForAdmin()).map((item) => item.id);
    const second = before[1];
    assert.ok(second);

    const moved = await navigation().move({ id: second, direction: 'up' });
    assert.equal(moved[0]?.id, second);

    // 已在首位再上移：顺序不变，且不产生副作用
    const idempotent = await navigation().move({ id: second, direction: 'up' });
    assert.deepEqual(idempotent.map((item) => item.id), moved.map((item) => item.id));

    // 下移回原位，方便后续用例的顺序断言
    const restored = await navigation().move({ id: second, direction: 'down' });
    assert.deepEqual(restored.map((item) => item.id), before);
  });

  it('安全：非法地址一律拒绝', async () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', 'about', '']) {
      await assert.rejects(
        () => navigation().save({ payload: { type: 'custom', label: 'x', href } }),
        (error: unknown) => isRiceNoteError(error) && error.code === 'RN_VALIDATION_FAILED',
        `应拒绝地址：${href}`
      );
    }

    // 自定义链接必须同时有文案与地址
    await assert.rejects(
      () => navigation().save({ payload: { type: 'custom', href: '/about' } }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_VALIDATION_FAILED'
    );
  });

  it('引用不存在的内容或非法类型被拒绝', async () => {
    await assert.rejects(
      () => navigation().save({ payload: { type: 'page', refId: 999999 } }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_VALIDATION_FAILED'
    );
    await assert.rejects(
      () => navigation().save({ payload: { type: 'post', refId: 999999 } }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_VALIDATION_FAILED'
    );
    await assert.rejects(
      () => navigation().save({ payload: { type: 'nope' } as never }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_VALIDATION_FAILED'
    );
  });

  it('删除与更新不存在的导航项返回 404', async () => {
    await assert.rejects(
      () => navigation().remove(999999),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_NOT_FOUND'
    );
    await assert.rejects(
      () => navigation().move({ id: 999999, direction: 'up' }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_NOT_FOUND'
    );
  });

  /**
   * 放在本 describe 的最后：禁用后本插件不再工作，后续用例不能再依赖导航。
   * 这是"可独立启停"的可验证承诺，也让新插件的句柄回收进入 assertNoLeaks 的校验范围。
   */
  it('禁用后插槽/服务/路由/菜单零残留', async () => {
    assert.ok(kernel);
    await kernel.plugins.disable('rice.navigation');

    assert.ok(
      !kernel.slots.ownedBy('rice.navigation').includes('header.navigation'),
      '导航插槽应随插件一起注销'
    );
    assert.equal(kernel.services.has('content.navigation@1'), false);
    assert.ok(!kernel.adminMenu.list().some((item) => item.id === 'navigation.items'));
    assert.equal(
      kernel.router.adminRoutesList().some((route) => route.pluginId === 'rice.navigation'),
      false
    );
    assert.equal(await renderNavigationSlot('/'), '', '禁用后导航插槽为空');

    // 后台界面：菜单条目消失，但声明仍在并标记为不可用（前台据此给出"未启用"提示）
    assert.ok(
      !kernel.adminMenu.list().some((item) => item.path === '/navigation'),
      '停用后注册的菜单项应被回收'
    );
    const declaredAfter = kernel.plugins.declaredAdminPages().find((item) => item.path === '/navigation');
    assert.equal(declaredAfter?.available, false, '声明仍在，但标记为不可用');
    assert.equal(declaredAfter?.entryUrl, '/plugin-admin/rice.navigation/main.js');

    // 覆盖 rice.navigation 的句柄回收（assertNoLeaks 只校验已停止的插件）
    kernel.plugins.assertNoLeaks();
  });
});

describe('页面模板选择（ADR-010）', () => {
  it('当前主题声明了可选模板清单', async () => {
    const templates = await themeService().pageTemplates();
    const keys = templates.map((item) => item.key);
    assert.deepEqual(keys.sort(), ['default', 'narrow', 'plain']);
    assert.ok(templates.every((item) => item.template.endsWith('.njk')));
    assert.ok(templates.every((item) => item.label.length > 0));
  });

  it('选择模板键后渲染使用对应模板文件', async () => {
    const created = await pages().save({
      payload: {
        title: '隐私政策',
        slug: 'privacy',
        content: '条款正文',
        status: 'published',
        template: 'narrow'
      }
    });

    const narrative = await renderPageRoute('page.show', { params: { slug: 'privacy' } });
    assert.equal(narrative.viewModel.template, 'narrow');
    // narrow 版式的标记类
    assert.match(narrative.output.html, /rn-page--narrow/);

    // 切换模板只改版式，不改内容：地址与正文都不变
    await pages().save({
      id: created.id,
      payload: {
        title: '隐私政策',
        slug: 'privacy',
        content: '条款正文',
        status: 'published',
        template: 'plain'
      }
    });

    const plain = await renderPageRoute('page.show', { params: { slug: 'privacy' } });
    assert.match(plain.output.html, /rn-page--plain/);
    // plain 版式不输出标题块
    assert.doesNotMatch(plain.output.html, /rn-post__title/);
    assert.match(plain.output.html, /条款正文/);
  });

  it('清单外的模板键被拒绝保存', async () => {
    await assert.rejects(
      () =>
        pages().save({
          payload: {
            title: '非法模板',
            slug: 'bad-template',
            content: 'x',
            status: 'draft',
            template: 'landing'
          }
        }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_CONTENT_TEMPLATE_INVALID'
    );
  });

  it('文章保存模板键后透传到渲染（同一份清单可用于文章）', async () => {
    const saved = await posts().save({
      authorId: 0,
      payload: {
        title: '带版式的文章',
        slug: 'styled-post',
        content: '正文',
        status: 'published',
        template: 'narrow'
      }
    });

    const detail = await posts().findForAdmin(saved.id);
    assert.equal(detail?.template, 'narrow');

    const list = await posts().listPublished({ page: 1, pageSize: 10 });
    assert.equal(list.items.find((item) => item.id === saved.id)?.template, 'narrow');
  });

  it('文章保存未声明的模板键被拒绝', async () => {
    await assert.rejects(
      () =>
        posts().save({
          authorId: 0,
          payload: { title: 'x', content: 'y', status: 'draft', template: 'nope' }
        }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_CONTENT_TEMPLATE_INVALID'
    );
  });
});

describe('站点信息运行时覆盖（ADR-011）', () => {
  it('修改后立即影响 core.site@1 与渲染结果，且无需重启', async () => {
    assert.ok(kernel);
    const before = siteService().info();
    assert.equal(before.overridden.length, 0);

    const result = await kernel.site.update({
      title: '新标题',
      description: '新描述',
      logoUrl: '/uploads/2026/10/logo.png',
      icpText: '京ICP备00000000号',
      revision: before.revision
    });

    assert.equal(result.info.title, '新标题');
    assert.equal(result.info.revision, before.revision + 1);
    assert.deepEqual(result.info.overridden.sort(), ['description', 'icpText', 'logoUrl', 'title']);

    // 同步读取路径（渲染器与 ctx.site 使用的就是它）
    assert.equal(siteService().info().title, '新标题');

    const { output } = await renderPageRoute('page.show', { params: { slug: 'about' } });
    assert.match(output.html, /新标题/);
    // 主题模板读取 site.icpText 渲染页脚
    assert.doesNotMatch(output.html, /旧描述/);
  });

  it('revision 不一致时拒绝写入（乐观锁）', async () => {
    assert.ok(kernel);
    await assert.rejects(
      () => kernel!.site.update({ title: '冲突标题', revision: 0 }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_REVISION_CONFLICT'
    );
  });

  it('字段白名单之外的键被拒绝', async () => {
    assert.ok(kernel);
    await assert.rejects(
      () => kernel!.site.update({ theme: 'rice.default' } as never),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_SITE_SETTING_INVALID'
    );
  });

  it('空字符串清除覆盖并回落到 .env 默认值', async () => {
    assert.ok(kernel);
    const current = siteService().info();
    const result = await kernel.site.update({ logoUrl: '', revision: current.revision });
    assert.equal(result.info.logoUrl, undefined);
    assert.ok(!result.info.overridden.includes('logoUrl'));
  });
});

describe('插件设置（ADR-011）', () => {
  it('声明式插件返回可渲染的分组与字段', async () => {
    assert.ok(kernel);
    const dto = await kernel.plugins.settingsDto('rice.pages');

    assert.equal(dto.declarative, true);
    assert.equal(dto.restartRequiredOnSave, true);
    assert.equal(dto.pluginId, 'rice.pages');
    assert.ok(dto.groups.length > 0);
    const keys = dto.groups.flatMap((group) => group.fields.map((field) => field.key)).sort();
    assert.deepEqual(keys, ['cacheEnabled', 'listPageSize']);
    assert.equal(dto.values.listPageSize, 20);
    assert.equal(dto.values.cacheEnabled, true);
  });

  it('官方插件均已声明设置表单（含列表型字段）', async () => {
    assert.ok(kernel);

    const identity = await kernel.plugins.settingsDto('rice.identity');
    assert.equal(identity.declarative, true);
    assert.deepEqual(identity.groups.map((group) => group.key), ['session']);
    assert.equal(identity.values.sessionTtlSeconds, 7200);

    const seo = await kernel.plugins.settingsDto('rice.seo');
    const disallow = seo.groups
      .flatMap((group) => group.fields)
      .find((field) => field.key === 'robotsDisallow');
    assert.equal(disallow?.type, 'stringList');
    assert.deepEqual(disallow?.value, ['/admin', '/api']);

    // 未声明设置的插件（如分类与标签）没有 settingsSchema，后台不显示设置入口
    const taxonomy = await kernel.plugins.settingsDto('rice.taxonomy');
    assert.equal(taxonomy.declarative, false);
    assert.equal(taxonomy.groups.length, 0);
  });

  it('未声明的字段被拒绝保存', async () => {
    assert.ok(kernel);
    await assert.rejects(
      () => kernel!.plugins.writeSettings('rice.pages', 'default', { unknownKey: 1 }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_PLUGIN_SETTING_INVALID'
    );
  });

  it('越界值被拒绝保存', async () => {
    assert.ok(kernel);
    await assert.rejects(
      () => kernel!.plugins.writeSettings('rice.pages', 'default', { listPageSize: 999 }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_PLUGIN_SETTING_INVALID'
    );
  });

  it('合法值被合并保存，revision 递增', async () => {
    assert.ok(kernel);
    const first = await kernel.plugins.writeSettings('rice.pages', 'default', { listPageSize: 5 });
    assert.equal(first.revision, 1);

    const second = await kernel.plugins.writeSettings('rice.pages', 'default', { cacheEnabled: false });
    assert.equal(second.revision, 2);

    const dto = await kernel.plugins.settingsDto('rice.pages');
    assert.equal(dto.values.listPageSize, 5, '合并写入：先前的字段不被清空');
    assert.equal(dto.values.cacheEnabled, false);
    assert.equal(dto.revision, 2);
  });

  it('失败的保存不会污染已保存的值', async () => {
    assert.ok(kernel);
    await kernel.plugins
      .writeSettings('rice.pages', 'default', { listPageSize: -1 })
      .catch(() => undefined);
    const dto = await kernel.plugins.settingsDto('rice.pages');
    assert.equal(dto.values.listPageSize, 5);
  });
});

describe('待生效标记与软重启（ADR-012）', () => {
  it('标记待生效后 state() 可读，并落库到 rn_site_state', async () => {
    assert.ok(kernel);
    assert.equal(kernel.runtime.state().restartRequired, false);

    await kernel.runtime.markRestartRequired({ reason: '插件设置已保存，重启后生效' });
    const state = kernel.runtime.state();
    assert.equal(state.restartRequired, true);
    assert.equal(state.reason, '插件设置已保存，重启后生效');
    assert.ok(state.requestedAt);

    const rows = await kernel.db.query<{ restart_required: number; restart_reason: string }>(
      'SELECT restart_required, restart_reason FROM rn_site_state WHERE site_id = ?',
      ['default']
    );
    assert.equal(Number(rows[0]?.restart_required), 1);
    assert.equal(rows[0]?.restart_reason, '插件设置已保存，重启后生效');
  });

  it('未注册重启执行器时 requestRestart 明确报错而不是静默', async () => {
    assert.ok(kernel);
    await assert.rejects(
      () => kernel!.runtime.requestRestart({ reason: '测试' }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_RESTART_UNAVAILABLE'
    );
  });

  it('注册重启执行器后 requestRestart 会调用它（并短暂置位 restarting）', async () => {
    assert.ok(kernel);
    let called = 0;
    let reasonSeen = '';

    kernel.runtime.registerRestartHandler((input) => {
      called += 1;
      reasonSeen = input.reason;
    });

    const result = await kernel.runtime.requestRestart({ reason: '执行器测试' });
    assert.equal(result.accepted, true);
    // 宽限期内对外表现为"正在重启"，前端据此快速失败而不是连接被重置
    assert.equal(kernel.runtime.state().restarting, true);

    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(called, 1, '宽限期后执行器被调用一次');
    assert.equal(reasonSeen, '执行器测试');
    assert.equal(kernel.runtime.state().restarting, false, '执行器返回后恢复为可服务状态');
  });

  it('重新 bootstrap（模拟软重启）后待生效标记被清除，设置值仍然生效', async () => {
    assert.ok(kernel);
    await kernel.shutdown();

    kernel = await bootstrap({
      rootDir,
      overrides: { database: { name: TEST_DB }, logLevel: 'error', seedPlugins: SEED }
    });

    assert.equal(kernel.runtime.state().restartRequired, false, '启动成功即消费掉待生效标记');

    // 设置值来自数据库，重启后新进程应读到同一份配置
    const dto = await kernel.plugins.settingsDto('rice.pages');
    assert.equal(dto.values.listPageSize, 5);
    assert.equal(dto.values.cacheEnabled, false);

    // 站点信息覆盖同样跨重启保持
    assert.equal(siteService().info().title, '新标题');
    const about: PageDetail | undefined = await pages().findPublishedBySlug('about');
    assert.equal(about?.title, '关于我们');
  });
});
