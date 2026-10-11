/**
 * v0.3.0 架构改造的集成测试。
 *
 * 覆盖四条新的端到端链路：
 * 1. `rice.pages` 的完整闭环（新建 → 渲染 `/page/:slug` → 导航插槽 → 删除）与页面模板选择；
 * 2. 站点信息运行时覆盖：改完**立即**反映到渲染结果与 `core.site@1`（无需重启）；
 * 3. 插件设置：声明式表单 DTO、字段级校验、以及"保存后需重启"的状态标记；
 * 4. 待生效标记跨启动的持久化与清除（模拟一次软重启）。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import mysql from 'mysql2/promise';
import { isRiceNoteError } from '@ricenote/shared';
import type {
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
async function renderNavigationSlot(): Promise<string> {
  assert.ok(kernel);
  return kernel.slots.render('header.navigation', { kind: 'home', data: {} });
}

describe('rice.pages：独立页面闭环', () => {
  it('插件注册了页面路由、导航插槽、服务契约与后台菜单', () => {
    assert.ok(kernel);
    assert.ok(kernel.router.pages().some((route) => route.name === 'page.show'));
    assert.ok(kernel.services.has('content.pages@1'));
    assert.ok(kernel.slots.list().some((entry) => entry.slot === 'header.navigation'));
    assert.ok(kernel.adminMenu.list().some((item) => item.id === 'pages.list'));
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

  it('已发布页面出现在导航插槽中，草稿不出现在导航', async () => {
    await pages().save({
      payload: { title: '草稿页', slug: 'draft-page', content: '未公开内容', status: 'draft' }
    });

    const html = await renderNavigationSlot();
    assert.match(html, /href="\/page\/about"/);
    assert.match(html, /关于我们/);
    assert.doesNotMatch(html, /draft-page/);
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
    assert.deepEqual(keys, ['cacheEnabled', 'listPageSize', 'navLimit']);
    assert.equal(dto.values.navLimit, 20);
    assert.equal(dto.values.cacheEnabled, true);
  });

  it('旧写法插件退化为非声明式（后台显示键值预览）', async () => {
    assert.ok(kernel);
    const dto = await kernel.plugins.settingsDto('rice.identity');
    assert.equal(dto.declarative, false);
    assert.equal(dto.groups.length, 0);
    assert.equal(dto.values.sessionTtlSeconds, 7200);
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
      () => kernel!.plugins.writeSettings('rice.pages', 'default', { navLimit: 999 }),
      (error: unknown) => isRiceNoteError(error) && error.code === 'RN_PLUGIN_SETTING_INVALID'
    );
  });

  it('合法值被合并保存，revision 递增', async () => {
    assert.ok(kernel);
    const first = await kernel.plugins.writeSettings('rice.pages', 'default', { navLimit: 5 });
    assert.equal(first.revision, 1);

    const second = await kernel.plugins.writeSettings('rice.pages', 'default', { cacheEnabled: false });
    assert.equal(second.revision, 2);

    const dto = await kernel.plugins.settingsDto('rice.pages');
    assert.equal(dto.values.navLimit, 5, '合并写入：先前的字段不被清空');
    assert.equal(dto.values.cacheEnabled, false);
    assert.equal(dto.revision, 2);
  });

  it('失败的保存不会污染已保存的值', async () => {
    assert.ok(kernel);
    await kernel.plugins
      .writeSettings('rice.pages', 'default', { navLimit: -1 })
      .catch(() => undefined);
    const dto = await kernel.plugins.settingsDto('rice.pages');
    assert.equal(dto.values.navLimit, 5);
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
    assert.equal(dto.values.navLimit, 5);
    assert.equal(dto.values.cacheEnabled, false);

    // 站点信息覆盖同样跨重启保持
    assert.equal(siteService().info().title, '新标题');
    const about: PageDetail | undefined = await pages().findPublishedBySlug('about');
    assert.equal(about?.title, '关于我们');
  });
});
