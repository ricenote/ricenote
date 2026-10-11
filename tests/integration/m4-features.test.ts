/**
 * M4 生态稳定的集成测试。
 *
 * 覆盖：
 * - rice.search 接管 `/search` 并跨数据源检索（含中文 ngram 检索）；
 * - rice.comments 的完整闭环（提交 → 待审 → 审核通过 → 前台可见 → 嵌套回复）与反垃圾；
 * - rice.seo 的 meta/JSON-LD 注入与 sitemap/robots 路由；
 * - 第三方插件（仅依赖公共 SDK）能被发现、启动并通过 Slot 注入内容；
 * - 全部插件的资源注销无泄漏。
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import mysql from 'mysql2/promise';
import { ErrorCode, isRiceNoteError } from '@ricenote/shared';
import type {
  ContentCommentsService,
  ContentPostsService,
  ContentSearchService
} from '@ricenote/shared';
import {
  bootstrap,
  discoverPluginsFrom,
  loadConfig,
  readPluginMigrations,
  type RiceNoteKernel
} from '@ricenote/core';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * 独立的测试库。
 *
 * node:test 默认**并行**运行不同测试文件，而每个集成测试都会 drop/create
 * 自己的数据库；因此两个集成测试文件必须使用不同的库名，否则会互相破坏。
 */
const TEST_DB = 'ricenote_test_m4';

const SEED = [
  'identity',
  'authorization',
  'posts',
  'taxonomy',
  'media',
  'comments',
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
    overrides: {
      database: { name: TEST_DB },
      logLevel: 'error',
      seedPlugins: SEED
    }
  });
});

after(async () => {
  if (kernel) await kernel.shutdown();
});

const posts = (): ContentPostsService => kernel!.services.use<ContentPostsService>('content.posts@1');
const comments = (): ContentCommentsService =>
  kernel!.services.use<ContentCommentsService>('content.comments@1');
const search = (): ContentSearchService =>
  kernel!.services.use<ContentSearchService>('content.search@1');

/** 按 HTTP 层的约定渲染一个已注册的页面路由。 */
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
    requestId: 'm4-test',
    raw: {}
  });

  return kernel.renderer.render({
    kind: viewModel.kind,
    title: viewModel.title,
    canonicalUrl: kernel.renderer.absolute(viewModel.canonicalUrl ?? url),
    data: viewModel.data,
    ...(viewModel.cacheTags ? { cacheTags: viewModel.cacheTags } : {}),
    cacheable: page.cacheable
  });
}

/** 发布一篇用于搜索/评论/SEO 验证的文章。 */
async function publishSample(): Promise<{ id: number; slug: string }> {
  const created = await posts().save({
    authorId: 1,
    payload: {
      title: '全文检索与评论的集成验证',
      content: '# 标题\n\n这是一篇用于验证中文全文检索、评论审核与 SEO 输出的长文。\n\n' +
        '正文中还会出现一些占位内容，用来让阅读时长至少有若干分钟。'.repeat(6),
      status: 'published'
    }
  });

  const detail = await posts().findPublishedById(created.id);
  assert.ok(detail);
  return { id: created.id, slug: detail.slug };
}

describe('插件生态：发现与契约', () => {
  it('九个插件全部启动成功，且新契约均已发布', async () => {
    assert.ok(kernel);
    const health = await kernel.health();

    assert.equal(health.plugins.failed, 0, '不应有插件启动失败');
    assert.equal(health.plugins.started, SEED.length);

    const services = kernel.services.list();
    for (const contract of ['content.search@1', 'content.comments@1']) {
      assert.equal(services.includes(contract), true, `缺少服务：${contract}`);
    }

    // has_feature 判定的是 **capability 契约**（主题据此决定是否渲染入口），
    // 因此新插件必须把契约登记在 enabledCapabilities 中
    for (const capability of ['search', 'comments', 'content.search@1', 'content.comments@1']) {
      assert.equal(kernel.hasFeature(capability), true, `has_feature 应识别：${capability}`);
    }
  });

  it('第三方插件出现在插件清单中且标记为非内置', () => {
    assert.ok(kernel);
    const thirdParty = kernel.plugins.summary().find((item) => item.id === 'acme.reading-time');
    assert.ok(thirdParty, '第三方插件应被 plugins/third-party 目录发现');
    assert.equal(thirdParty.builtin, false);
    assert.equal(thirdParty.state, 'STARTED');
  });
});

describe('rice.search：接管 /search 并跨数据源检索', () => {
  it('/search 路由归 search 插件所有', () => {
    assert.ok(kernel);
    const route = kernel.router.pages().find((item) => item.name === 'search');
    assert.ok(route, 'search 路由应由 rice.search 注册');
    assert.equal(route.pluginId, 'rice.search');
    assert.equal(route.path, '/search');
    assert.equal(route.kind, 'search');

    // posts 不再注册 /search，避免路由冲突
    const owned = kernel.router.ownedBy('rice.posts').pages.map((item) => item.name);
    assert.equal(owned.includes('search'), false);
  });

  it('posts 已向 search 注册可搜索数据源', () => {
    const sources = search().listSources();
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.id, 'posts');
  });

  it('中文关键词经 ngram 全文索引命中已发布文章', async () => {
    const sample = await publishSample();
    const result = await search().search({ keyword: '全文检索', page: 1, pageSize: 10 });

    assert.equal(result.total >= 1, true, '应命中刚发布的文章');
    const hit = result.items.find((item) => item.url === `/post/${sample.slug}`);
    assert.ok(hit, '命中结果应包含刚发布的文章');
    assert.equal(hit.type, 'post');
    assert.equal(hit.sourceLabel, '文章');
    assert.ok(hit.title.length > 0);
    assert.ok(hit.excerpt.length > 0);
  });

  it('单字关键词回退 LIKE 后仍能命中', async () => {
    const result = await search().search({ keyword: '评', page: 1, pageSize: 10 });
    assert.equal(result.total >= 1, true);
  });

  it('无匹配关键词返回空结果而非报错', async () => {
    const result = await search().search({ keyword: '绝不存在的词zzz', page: 1, pageSize: 10 });
    assert.equal(result.total, 0);
    assert.deepEqual(result.items, []);
  });

  it('/search 页面渲染出结果卡片', async () => {
    const output = await renderPageRoute('search', {
      url: '/search?q=%E5%85%A8%E6%96%87%E6%A3%80%E7%B4%A2',
      query: { q: '全文检索' }
    });

    assert.equal(output.status, 200);
    assert.equal(output.html.includes('rn-post-card'), true);
    assert.equal(output.html.includes('全文检索与评论的集成验证'), true);
  });
});

describe('rice.comments：闭环与反垃圾', () => {
  it('提交后进入待审，审核通过后前台可见', async () => {
    const sample = await publishSample();
    const service = comments();

    const submitted = await service.submit({
      postId: sample.id,
      authorName: '访客甲',
      authorEmail: 'guest-a@example.com',
      content: '第一条验证评论。',
      ip: '10.0.0.1'
    });
    assert.equal(submitted.status, 'pending');

    const before = await service.listApprovedThreaded({ postId: sample.id, page: 1, pageSize: 10 });
    assert.equal(before.totalApproved, 0, '待审评论不应出现在前台');

    const moderated = await service.moderate({ ids: [submitted.id], action: 'approve' });
    assert.equal(moderated.affected, 1);

    const after = await service.listApprovedThreaded({ postId: sample.id, page: 1, pageSize: 10 });
    assert.equal(after.totalApproved, 1);
    assert.equal(after.items.length, 1);
    assert.equal(after.items[0]?.authorName, '访客甲');
  });

  it('支持嵌套回复并保留层级', async () => {
    const sample = await publishSample();
    const service = comments();
    const ip = '10.0.0.2';

    const parent = await service.submit({
      postId: sample.id,
      authorName: '楼主',
      authorEmail: 'owner@example.com',
      content: '被回复的评论。',
      ip
    });
    await service.moderate({ ids: [parent.id], action: 'approve' });

    const child = await service.submit({
      postId: sample.id,
      parentId: parent.id,
      authorName: '回复者',
      authorEmail: 'reply@example.com',
      content: '这是一条回复。',
      ip
    });
    await service.moderate({ ids: [child.id], action: 'approve' });

    const thread = await service.listApprovedThreaded({ postId: sample.id, page: 1, pageSize: 10 });
    assert.equal(thread.totalApproved, 2);
    assert.equal(thread.items.length, 1, '回复不应作为顶层节点');
    assert.equal(thread.items[0]?.children.length, 1);
    assert.equal(thread.items[0]?.children[0]?.authorName, '回复者');
  });

  it('回复不存在的父评论被拒绝', async () => {
    const sample = await publishSample();
    const error = await comments()
      .submit({
        postId: sample.id,
        parentId: 999999,
        authorName: '回复者',
        authorEmail: 'reply@example.com',
        content: '回复一个不存在的评论。',
        ip: '10.0.0.3'
      })
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.status, 404);
  });

  it('链接超限的评论被自动判为垃圾', async () => {
    const sample = await publishSample();
    const submitted = await comments().submit({
      postId: sample.id,
      authorName: '推广',
      authorEmail: 'spam@example.com',
      content: '看这里 http://a.com http://b.com http://c.com http://d.com',
      ip: '10.0.0.4'
    });

    assert.equal(submitted.status, 'spam');
  });

  it('同一来源超出频率上限时返回 429', async () => {
    const sample = await publishSample();
    const ip = '10.0.0.5';
    const payload = {
      postId: sample.id,
      authorName: '刷屏者',
      authorEmail: 'flood@example.com',
      content: '刷屏内容。',
      ip
    };

    // 默认配置为 60 秒内最多 3 条
    for (let index = 0; index < 3; index += 1) {
      await comments().submit({ ...payload, content: `刷屏内容 ${index}` });
    }

    const error = await comments()
      .submit({ ...payload, content: '第四条' })
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.RATE_LIMITED);
    assert.equal(error.status, 429);
  });

  it('状态统计与后台列表口径一致', async () => {
    const counts = await comments().countByStatus();
    assert.equal(counts.total, counts.pending + counts.approved + counts.spam + counts.trash);

    const pending = await comments().listForAdmin({ status: 'pending', page: 1, pageSize: 50 });
    assert.equal(pending.total, counts.pending);
    assert.equal(pending.items.length, counts.pending);
    if (pending.items.length > 0) {
      assert.ok(pending.items[0]?.postTitle, '后台列表应能解析出所属文章标题');
    }
  });

  it('批量删除后不可再见于任何状态统计', async () => {
    const sample = await publishSample();
    const submitted = await comments().submit({
      postId: sample.id,
      authorName: '待删除',
      authorEmail: 'delete@example.com',
      content: '这条评论会被删除。',
      ip: '10.0.0.6'
    });

    const before = await comments().countByStatus();
    await comments().moderate({ ids: [submitted.id], action: 'delete' });
    const after = await comments().countByStatus();

    assert.equal(after.total, before.total - 1);
  });

  it('文章页渲染评论区与提交表单', async () => {
    const sample = await publishSample();
    const output = await renderPageRoute('post.show', {
      url: `/post/${sample.slug}`,
      params: { slug: sample.slug }
    });

    assert.equal(output.status, 200);
    assert.equal(output.html.includes('data-rn-comments'), true);
    assert.equal(output.html.includes('data-rn-comment-form'), true);
    assert.equal(output.html.includes('action="/comments/submit"'), true);
    assert.equal(output.html.includes('rn-slot:'), false, '不应残留 Slot 占位符');
  });
});

describe('rice.seo：社交卡片、结构化数据与站点地图', () => {
  it('文章页注入 Open Graph、Twitter Card 与 JSON-LD', async () => {
    const sample = await publishSample();
    const output = await renderPageRoute('post.show', {
      url: `/post/${sample.slug}`,
      params: { slug: sample.slug }
    });

    assert.equal(output.html.includes('property="og:type" content="article"'), true);
    assert.equal(output.html.includes('name="twitter:card"'), true);
    assert.equal(output.html.includes('application/ld+json'), true);
    assert.equal(output.html.includes('"@type":"BlogPosting"'), true);
    // JSON-LD 中不得出现裸 `<`，否则会提前闭合 script
    const jsonLd = output.html.slice(output.html.indexOf('application/ld+json'));
    assert.equal(jsonLd.slice(0, jsonLd.indexOf('</script>')).includes('<'), false);
  });

  it('注册了 sitemap.xml 与 robots.txt 公开路由', () => {
    assert.ok(kernel);
    const raw = kernel.router.rawRoutesList().filter((route) => route.pluginId === 'rice.seo');
    const paths = raw.map((route) => `${route.method} ${route.path}`).sort();

    assert.deepEqual(paths, ['GET /robots.txt', 'GET /sitemap.xml']);
    assert.equal(raw.every((route) => route.capability === 'routes:public'), true);
  });
});

describe('插件升级回归：迁移增量应用与校验值', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'ricenote-upgrade-'));
  const pluginDir = path.join(fixtureRoot, 'upgrade-demo');
  const migrationsDir = path.join(pluginDir, 'migrations');
  const SCOPE = 'plugin:fixture.upgrade';

  /** 写入"某个版本"的插件目录（覆盖式）。 */
  function writePlugin(version: string, migrations: Record<string, string>): void {
    rmSync(pluginDir, { recursive: true, force: true });
    mkdirSync(migrationsDir, { recursive: true });

    writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: 'fixture.upgrade',
          name: '升级演示',
          version,
          apiVersion: '^1.0.0',
          entry: './dist/index.js',
          migrations: './migrations'
        },
        null,
        2
      ),
      'utf8'
    );
    mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(path.join(pluginDir, 'dist', 'index.js'), 'export default {};', 'utf8');

    for (const [name, sql] of Object.entries(migrations)) {
      writeFileSync(path.join(migrationsDir, name), sql, 'utf8');
    }
  }

  function readMigrations() {
    const discovery = discoverPluginsFrom([fixtureRoot]);
    const plugin = discovery.plugins.find((item) => item.manifest.id === 'fixture.upgrade');
    assert.ok(plugin, 'fixture 插件应被发现');
    return readPluginMigrations(plugin);
  }

  after(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('1.0.0 → 1.1.0 时只应用新增迁移，历史迁移被跳过', async () => {
    assert.ok(kernel);

    writePlugin('1.0.0', {
      '0001_init.sql': 'CREATE TABLE IF NOT EXISTS rn_fixture_upgrade (id BIGINT UNSIGNED PRIMARY KEY);'
    });
    const first = await kernel.migrations.apply({ scope: SCOPE, migrations: readMigrations() });
    // 迁移名即文件名（含 .sql 后缀），便于日志与人工核对
    assert.deepEqual(first.applied, ['0001_init.sql']);
    assert.deepEqual(first.skipped, []);

    // 升级到 1.1.0：新增一个迁移
    writePlugin('1.1.0', {
      '0001_init.sql': 'CREATE TABLE IF NOT EXISTS rn_fixture_upgrade (id BIGINT UNSIGNED PRIMARY KEY);',
      '0002_add_note.sql': 'ALTER TABLE rn_fixture_upgrade ADD COLUMN note VARCHAR(64) NULL;'
    });

    const second = await kernel.migrations.apply({ scope: SCOPE, migrations: readMigrations() });
    assert.deepEqual(second.applied, ['0002_add_note.sql'], '只应应用新增的迁移');
    assert.deepEqual(second.skipped, ['0001_init.sql'], '历史迁移应被跳过');

    // 列确实被加上
    const columns = await kernel.db.query<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'rn_fixture_upgrade'`,
      [TEST_DB]
    );
    assert.equal(columns.some((row) => row.COLUMN_NAME === 'note'), true);
  });

  it('低版本重复应用（回退场景）不会重复执行或报错', async () => {
    assert.ok(kernel);

    writePlugin('1.0.0', {
      '0001_init.sql': 'CREATE TABLE IF NOT EXISTS rn_fixture_upgrade (id BIGINT UNSIGNED PRIMARY KEY);'
    });

    const rerun = await kernel.migrations.apply({ scope: SCOPE, migrations: readMigrations() });
    assert.deepEqual(rerun.applied, []);
    assert.deepEqual(rerun.skipped, ['0001_init.sql'], '已应用的迁移不应因插件目录回退而重复执行');
  });

  it('已应用迁移的内容被篡改时拒绝启动（校验值防线）', async () => {
    assert.ok(kernel);

    writePlugin('1.1.0', {
      // 内容与首次应用时不同 —— 属于"历史被改写"
      '0001_init.sql': 'CREATE TABLE IF NOT EXISTS rn_fixture_upgrade (id BIGINT UNSIGNED PRIMARY KEY, tampered TINYINT);',
      '0002_add_note.sql': 'ALTER TABLE rn_fixture_upgrade ADD COLUMN note VARCHAR(64) NULL;'
    });

    const error = await kernel.migrations
      .apply({ scope: SCOPE, migrations: readMigrations() })
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.MIGRATION_FAILED);
  });
});

describe('第三方插件：只依赖公共 SDK 也能工作', () => {
  it('通过 post.beforeContent 注入阅读时长', async () => {
    const sample = await publishSample();
    const output = await renderPageRoute('post.show', {
      url: `/post/${sample.slug}`,
      params: { slug: sample.slug }
    });

    assert.equal(output.html.includes('data-acme-reading-time'), true);
    assert.equal(output.html.includes('阅读时长'), true);
    assert.equal(output.html.includes('分钟'), true);
  });

  it('全部插件的路由/服务/Slot/菜单/事件订阅均无泄漏', () => {
    assert.ok(kernel);
    kernel.plugins.assertNoLeaks();
  });
});
