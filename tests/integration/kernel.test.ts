/**
 * 内核集成测试：在独立测试库上完整启动 RiceNote，验证 M1/M2 的关键行为。
 *
 * 覆盖：
 * - 核心独立启动 + 官方插件全部启动（无 FAILED）；
 * - capability 解析与短名 has_feature；
 * - 前台页面渲染（首页 / 文章页 / 404）与 HTML 缓存；
 * - 内容写入 → 缓存失效 → 重新渲染；
 * - 主题切换不影响业务插件；
 * - 插件停用前置校验（反向依赖会被拒绝）；
 * - 资源注销无泄漏。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import mysql from 'mysql2/promise';
import {
  bootstrap,
  loadConfig,
  type RiceNoteKernel
} from '@ricenote/core';
import type { ContentPostsService, TaxonomyService } from '@ricenote/shared';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_DB = 'ricenote_test';

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
    overrides: {
      database: { name: TEST_DB },
      logLevel: 'warn',
      seedPlugins: ['identity', 'authorization', 'posts', 'taxonomy', 'media']
    }
  });
});

after(async () => {
  if (kernel) await kernel.shutdown();
});

/**
 * 按 HTTP 层的约定渲染一个已注册的页面路由。
 *
 * 这里刻意不直接调用 `renderer.render({ data: {} })`，而是先执行插件的页面处理器：
 * 只有这样才能获得真实的 ViewModel 数据与 `cacheTags`，
 * 而 `cacheTags` 正是"内容变更 → 精确失效 HTML 缓存"的关键。
 */
async function renderPageRoute(
  name: string,
  options: { url?: string; params?: Record<string, string>; query?: Record<string, unknown> } = {}
) {
  assert.ok(kernel);
  const page = kernel.router.pages().find((route) => route.name === name);
  assert.ok(page, `页面路由未注册：${name}`);

  const url = options.url ?? '/';

  const viewModel = await page.handler({
    method: 'GET',
    url,
    params: options.params ?? {},
    query: options.query ?? {},
    body: undefined,
    headers: {},
    requestId: 'test-request',
    raw: {}
  });

  const template = viewModel.template ?? page.template;

  return kernel.renderer.render({
    kind: viewModel.kind,
    title: viewModel.title,
    canonicalUrl: kernel.renderer.absolute(viewModel.canonicalUrl ?? url),
    data: viewModel.data,
    ...(template ? { template } : {}),
    ...(viewModel.status ? { status: viewModel.status } : {}),
    ...(viewModel.cacheTags ? { cacheTags: viewModel.cacheTags } : {}),
    cacheable: page.cacheable
  });
}

describe('内核启动', () => {
  it('数据库可达且插件全部启动成功', async () => {
    assert.ok(kernel);
    const health = await kernel.health();

    assert.equal(health.database.reachable, true);
    assert.equal(health.plugins.failed, 0, '不应有插件启动失败');
    assert.equal(health.plugins.started, 5);
    assert.equal(health.plugins.invalid, 0);
  });

  it('发布了全部核心服务契约', () => {
    assert.ok(kernel);
    const services = kernel.services.list();
    for (const contract of [
      'core.security@1',
      'core.theme@1',
      'core.setup@1',
      'core.html@1',
      'identity.auth@1',
      'identity.users@1',
      'identity.authorization@1',
      'content.posts@1',
      'content.taxonomy@1',
      'media.library@1'
    ]) {
      assert.equal(services.includes(contract), true, `缺少服务：${contract}`);
    }
  });

  it('注册了前台页面路由与标准能力', () => {
    assert.ok(kernel);
    const routes = kernel.router.pages().map((route) => route.name).sort();
    // 注意：本用例未启用 rice.search，因此 posts 不再注册 /search
    // （路由名与路径归 rice.search 所有，posts 只注册可搜索数据源）
    assert.deepEqual(routes, ['home', 'post.show', 'term.category', 'term.tag']);

    assert.equal(kernel.hasFeature('posts'), true);
    assert.equal(kernel.hasFeature('content.posts@1'), true);
    assert.equal(kernel.hasFeature('comments'), false);
    assert.equal(kernel.hasFeature('search'), false);
  });

  it('search 插件未启用时 /search 不注册，模板引用该可选路由也不会中断渲染', async () => {
    assert.ok(kernel);
    assert.equal(kernel.router.findPageByName('search'), undefined);
    assert.equal(kernel.hasFeature('search'), false);

    // 主题布局用 has_feature('search') 把关，因此搜索入口整体不渲染
    const home = await renderPageRoute('home', { url: '/' });
    assert.equal(home.status, 200);
    assert.equal(home.html.includes('href="#"'), false, '搜索入口应被能力判断隐藏');

    // 关键回归：模板若直接引用未注册的可选路由（如搜索模板自身的表单 action），
    // url() 必须降级为 '#' 而不是抛错——否则禁用 search 插件会让整页白屏
    const search = await kernel.renderer.render({
      kind: 'search',
      title: '搜索',
      canonicalUrl: kernel.renderer.absolute('/search'),
      data: {
        keyword: '',
        posts: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 },
        pagination: null
      }
    });
    assert.equal(search.status, 200);
    assert.ok(search.html.includes('action="#"'), '缺失路由应降级为 #');

    // 本次渲染会写入 HTML 缓存；清空以免影响后续"首次渲染未命中缓存"的断言
    kernel.cache.clear();
  });

  it('启动时创建了初始管理员并被分派 administrator 角色', async () => {
    assert.ok(kernel);
    const rows = await kernel.db.query<{ total: number }>('SELECT COUNT(*) AS total FROM rn_identity_users');
    assert.equal(Number(rows[0]?.total ?? 0), 1);

    const roles = await kernel.db.query<{ name: string }>(
      `SELECT r.name AS name
         FROM rn_authz_user_roles ur
         JOIN rn_authz_roles r ON r.id = ur.role_id`
    );
    assert.deepEqual(roles.map((row) => row.name), ['administrator']);
  });
});

describe('前台渲染与缓存', () => {
  it('首次渲染首页命中内置主题模板', async () => {
    assert.ok(kernel);
    const output = await renderPageRoute('home');

    assert.equal(output.themeId, 'rice.minimal');
    assert.equal(output.fromCache, false);
    assert.equal(output.html.includes('rn-post-card') || output.html.includes('还没有文章'), true);
  });

  it('第二次渲染命中 HTML 缓存', async () => {
    const output = await renderPageRoute('home');
    assert.equal(output.fromCache, true);
  });

  it('未知 kind 回退到内置兼容模板而非报错', async () => {
    assert.ok(kernel);
    const output = await kernel.renderer.render({
      kind: 'totally-unknown-kind',
      title: '未知页面',
      canonicalUrl: kernel.renderer.absolute('/x'),
      data: { note: 'fallback' },
      cacheable: false
    });
    assert.equal(output.html.includes('内置兼容模板'), true);
  });

  it('404 页面由主题模板渲染', async () => {
    assert.ok(kernel);
    const output = await kernel.renderer.render({
      kind: '404',
      title: '页面不存在',
      canonicalUrl: kernel.renderer.absolute('/missing'),
      data: { message: '未找到' },
      status: 404,
      cacheable: false
    });
    assert.equal(output.status, 404);
    assert.equal(output.html.includes('页面不存在'), true);
  });

  it('插槽由插件注入并被渲染器替换为真实片段', async () => {
    assert.ok(kernel);
    const output = await kernel.renderer.render({
      kind: 'post',
      title: '文章',
      canonicalUrl: kernel.renderer.absolute('/post/x'),
      data: {
        post: {
          id: 1,
          title: '文章',
          slug: 'x',
          html: { value: '' },
          excerpt: '',
          updatedAt: new Date().toISOString(),
          url: '/post/x',
          terms: [{ id: 1, name: '插件系统', slug: 'tagslug', type: 'tag' }]
        }
      },
      cacheable: false
    });

    assert.equal(output.html.includes('rn-post-terms'), true);
    assert.equal(output.html.includes('rn-slot:'), false, '不应残留占位符');
  });
});

describe('内容闭环：写入 → 缓存失效 → 前台可见', () => {
  it('通过服务创建分类、文章并能在前台渲染', async () => {
    assert.ok(kernel);
    const taxonomy = kernel.services.use<TaxonomyService>('content.taxonomy@1');
    const posts = kernel.services.use<ContentPostsService>('content.posts@1');

    const term = await taxonomy.save({ name: '架构设计', type: 'category' });
    const created = await posts.save({
      authorId: 1,
      payload: {
        title: '集成测试文章',
        content: '# 标题\n\n这是**正文**。\n\n- 一\n- 二',
        status: 'published',
        termIds: [term.id]
      }
    });

    const detail = await posts.findPublishedById(created.id);
    assert.ok(detail);
    assert.equal(detail.title, '集成测试文章');
    assert.equal(detail.html.includes('<strong>正文</strong>'), true, 'Markdown 应被渲染');
    assert.equal(detail.terms.length, 1);

    const listed = await posts.listPublished({ page: 1, pageSize: 10 });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0]?.authorName, 'admin');
  });

  it('首页渲染出刚发布的文章标题（内容变更后缓存已失效）', async () => {
    const output = await renderPageRoute('home');

    assert.equal(output.fromCache, false, '内容变更后缓存应已失效');
    assert.equal(output.html.includes('集成测试文章'), true);
  });

  it('文章页渲染正文，并通过 Slot 注入插件区块', async () => {
    assert.ok(kernel);
    const posts = kernel.services.use<ContentPostsService>('content.posts@1');
    const rows = await posts.listPublished({ page: 1, pageSize: 10 });
    const slug = rows.items[0]?.slug ?? '';
    assert.equal(slug.length > 0, true);

    const output = await renderPageRoute('post.show', {
      url: `/post/${slug}`,
      params: { slug }
    });
    assert.equal(output.html.includes('<strong>正文</strong>'), true);
    assert.equal(output.html.includes('rn-post-terms'), true, 'posts 插件应通过 Slot 注入词条区块');
  });

  it('不存在（或未发布）的文章渲染 404 页面而非抛错', async () => {
    const output = await renderPageRoute('post.show', {
      url: '/post/not-exists',
      params: { slug: 'not-exists' }
    });
    assert.equal(output.status, 404);
    assert.equal(output.html.includes('页面不存在'), true);
  });

  it('CSS 注入尝试被消毒后不会出现在输出中', async () => {
    assert.ok(kernel);
    const posts = kernel.services.use<ContentPostsService>('content.posts@1');

    const created = await posts.save({
      authorId: 1,
      payload: {
        title: 'XSS 尝试',
        content: '<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[坏链接](javascript:alert(3))',
        status: 'published'
      }
    });

    const detail = await posts.findPublishedById(created.id);
    assert.ok(detail);
    assert.equal(detail.html.includes('<script'), false);
    assert.equal(detail.html.includes('onerror'), false);
    assert.equal(detail.html.includes('javascript:'), false);
  });
});

describe('主题系统', () => {
  it('切换到第二套主题后，插件注册的路由与服务保持不变', async () => {
    assert.ok(kernel);
    const before = kernel.router.pages().length;

    await kernel.themeManager.activate('rice.default');
    const active = await kernel.themeManager.getActive();
    assert.equal(active.manifest.id, 'rice.default');

    const output = await renderPageRoute('home');
    assert.equal(output.themeId, 'rice.default');
    assert.equal(output.html.includes('df-card'), true, '应使用 default 主题的标记结构');
    assert.equal(output.html.includes('集成测试文章'), true, '同一内容在新主题下依然可见');
    assert.equal(kernel.router.pages().length, before, '切换主题不应影响插件路由');

    await kernel.themeManager.activate('rice.minimal');
    assert.equal((await kernel.themeManager.getActive()).manifest.id, 'rice.minimal');
  });

  it('设置三层合成：默认值 + 已发布覆盖，草稿仅在预览时叠加', async () => {
    assert.ok(kernel);
    const theme = kernel.themeManager.getTheme('rice.minimal');
    assert.ok(theme);

    const defaults = await kernel.themeManager.resolveSettings(theme);
    assert.equal(defaults.values.footerText, 'Powered by RiceNote');
    assert.equal(defaults.revision, 0);

    await kernel.themeManager.settings.publish(
      kernel.config.site.id,
      'rice.minimal',
      { footerText: '集成测试页脚' },
      0
    );

    const published = await kernel.themeManager.resolveSettings(theme);
    assert.equal(published.values.footerText, '集成测试页脚');
    assert.equal(published.revision, 1);

    const preview = await kernel.themeManager.resolveSettings(theme, { footerText: '草稿页脚' });
    assert.equal(preview.values.footerText, '草稿页脚');

    // 乐观锁：revision 过期必须拒绝
    await assert.rejects(() =>
      kernel!.themeManager.settings.publish(kernel!.config.site.id, 'rice.minimal', { footerText: 'x' }, 0)
    );
  });

  it('主题识别支持短名', () => {
    assert.ok(kernel);
    assert.equal(kernel.themeManager.resolveThemeId('minimal'), 'rice.minimal');
    assert.equal(kernel.themeManager.resolveThemeId('rice.default'), 'rice.default');
  });
});

describe('插件生命周期与依赖前置校验', () => {
  it('禁用被依赖的插件会被拒绝（identity 被 posts 依赖）', async () => {
    assert.ok(kernel);
    await assert.rejects(() => kernel!.plugins.disable('rice.identity'), /依赖|RN_DEPENDENCY_DISABLED/);
  });

  it('未被依赖的插件可以禁用，并且注册项被完整注销', async () => {
    assert.ok(kernel);
    const servicesBefore = kernel.services.list();

    /*
     * 先覆盖"启用"这条状态变更：**不写死具体插件** —— 官方插件集的组成会变
     * （例如示例插件被移除），写死 ID 会让用例跟着一起碎。改为挑一个默认未启用的，
     * 启用后确认记录确实翻成 enabled。
     */
    const target = kernel.plugins.summary().find((item) => !item.enabled);
    assert.ok(target, '应当存在一个默认未启用的插件用于本用例');
    await kernel.plugins.enable(target.id);
    assert.equal(kernel.plugins.summary().find((item) => item.id === target.id)?.enabled, true);

    // 关闭 posts（无反向依赖）后，其页面路由与服务应消失
    await kernel.plugins.disable('rice.posts');
    assert.equal(kernel.router.pages().some((route) => route.name === 'home'), false);
    assert.equal(kernel.services.list().includes('content.posts@1'), false);
    assert.equal(kernel.services.list().length < servicesBefore.length, true);
  });

  it('插件停止后不残留句柄（无泄漏断言）', () => {
    assert.ok(kernel);
    kernel.plugins.assertNoLeaks();
  });
});
