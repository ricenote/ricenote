/**
 * HTTP 面集成测试：真实装配 Fastify（不通过 CLI 入口），验证路由与守卫。
 *
 * 为什么需要它（一次真实故障换来的教训）：
 * 新增 Core 管理路由时，若与既有路由重复，Fastify 会在**注册期**直接抛
 * `Method 'GET' already declared for route '...'`，整个进程起不来。
 * 只测 core 的集成测试（不装配 HTTP）发现不了这类回归，
 * 因此这里显式构建一次完整的 HTTP 服务并打几个关键请求。
 *
 * 端口使用 0（由系统分配）：node:test 会并行跑不同文件，固定端口会互相干扰。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import mysql from 'mysql2/promise';
import { bootstrap, loadConfig, type RiceNoteKernel } from '@ricenote/core';
import { startHttpServer, type RunningServer } from '@ricenote/server/dist/server.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_DB = 'ricenote_test_http';

const SEED = ['identity', 'authorization', 'posts', 'taxonomy', 'media', 'pages', 'search', 'seo'];

let kernel: RiceNoteKernel | undefined;
let server: RunningServer | undefined;
let origin = '';

/** 会话 Cookie 罐（服务端会同时下发会话与 CSRF 双提交 Cookie）。 */
const jar = new Map<string, string>();

/** 启动内核与 HTTP 服务（`http.port: 0` 让系统分配空闲端口）。 */
async function launch(): Promise<void> {
  kernel = await bootstrap({
    rootDir,
    overrides: {
      database: { name: TEST_DB },
      http: { port: 0 },
      logLevel: 'error',
      seedPlugins: SEED
    }
  });

  // 这一步会因路由冲突而抛错 —— 正是我们要防的回归
  server = await startHttpServer(kernel, { trustProxy: false });
  const address = server.app.server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
}

/**
 * 模拟后台「一键重启」：关服务 → 关内核 → 重新 bootstrap → 重新监听。
 *
 * 测试里没有 `ServerSupervisor`（它在 CLI 入口里），但重启的**语义**
 * 完全一致：插件在 `start()` 时读取一次 `ctx.config`，因此只有重跑一遍
 * 才能验证"设置真的被插件读到了"。
 */
async function relaunch(): Promise<void> {
  assert.ok(server);
  assert.ok(kernel);
  await server.close();
  await kernel.shutdown();
  await launch();
}

before(async () => {
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

  await launch();
});

after(async () => {
  if (server) await server.close();
  if (kernel) await kernel.shutdown();
});

function cookieHeader(): string {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function request(
  method: string,
  url: string,
  options: { body?: unknown; csrf?: boolean } = {}
): Promise<{ status: number; json: Record<string, unknown> | undefined; text: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.csrf ?? method !== 'GET') {
    const token = jar.get('ricenote_csrf');
    if (token) headers['x-csrf-token'] = decodeURIComponent(token);
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  if (jar.size > 0) headers.Cookie = cookieHeader();

  const response = await fetch(`${origin}${url}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });

  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(';')[0] ?? '';
    const at = pair.indexOf('=');
    if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }

  const text = await response.text();
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text };
}

function data<T>(response: { json: Record<string, unknown> | undefined }): T {
  return response.json?.data as T;
}

describe('HTTP 装配与公开面', () => {
  it('装配成功且健康检查可用（路由冲突会在装配期直接失败）', async () => {
    const health = await request('GET', '/api/health');
    assert.equal(health.status, 200);
    // /api/health 直接返回报告体，没有 { data } 信封
    assert.equal(health.json?.status, 'ok');
    assert.equal(health.json?.restartRequired, false);
  });

  it('公开站点首页可渲染', async () => {
    const home = await request('GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.text, /<!doctype html>/i);
  });

  it('未登录访问管理接口一律 401（fail-closed）', async () => {
    for (const url of ['/api/admin/me', '/api/admin/site', '/api/admin/pages', '/api/admin/system/state']) {
      const response = await request('GET', url);
      assert.equal(response.status, 401, `${url} 应返回 401`);
    }
  });

  it('登录后 /api/admin/me 返回角色与权限', async () => {
    const wrong = await request('POST', '/api/admin/session', {
      body: { username: 'admin', password: 'wrong-password' }
    });
    assert.equal(wrong.status, 401);

    const login = await request('POST', '/api/admin/session', {
      body: { username: 'admin', password: 'admin12345' }
    });
    assert.equal(login.status, 200);
    assert.ok(jar.has('ricenote_session'));
    assert.ok(jar.has('ricenote_csrf'));

    const me = await request('GET', '/api/admin/me');
    assert.equal(me.status, 200);
    const user = data<{ username: string; permissions: string[] }>(me);
    assert.equal(user.username, 'admin');
    assert.ok(user.permissions.includes('*'));
  });

  it('写操作缺少 CSRF 头被拒绝', async () => {
    const response = await request('PUT', '/api/admin/site', {
      body: { title: '无 CSRF' },
      csrf: false
    });
    assert.equal(response.status, 403);
  });
});

describe('站点信息与插件设置（HTTP 面）', () => {
  it('站点信息可读可写，且校验失败有字段级问题', async () => {
    const before = await request('GET', '/api/admin/site');
    assert.equal(before.status, 200);

    const saved = await request('PUT', '/api/admin/site', {
      body: {
        title: 'HTTP 冒烟站点',
        language: 'zh-CN',
        url: 'https://example.com/',
        revision: data<{ revision: number }>(before).revision
      }
    });
    assert.equal(saved.status, 200);
    const info = data<{ title: string; url: string; overridden: string[] }>(saved);
    assert.equal(info.title, 'HTTP 冒烟站点');
    assert.equal(info.url, 'https://example.com');
    assert.ok(info.overridden.includes('title'));

    const invalid = await request('PUT', '/api/admin/site', {
      body: { title: '' }
    });
    assert.equal(invalid.status, 400);
  });

  it('插件设置返回声明式分组，并在保存后标记待重启', async () => {
    const dto = await request('GET', '/api/admin/plugins/rice.pages/settings');
    assert.equal(dto.status, 200);
    assert.equal(data<{ declarative: boolean }>(dto).declarative, true);

    const saved = await request('PUT', '/api/admin/plugins/rice.pages/settings', {
      body: { values: { navLimit: 9 } }
    });
    assert.equal(saved.status, 200);

    const state = await request('GET', '/api/admin/system/state');
    const snapshot = data<{ restartRequired: boolean; reason: string; startedAt: string }>(state);
    assert.equal(snapshot.restartRequired, true);
    assert.match(snapshot.reason, /重启后生效/);
    assert.ok(snapshot.startedAt.length > 0);
  });

  it('未注册重启执行器时重启端点返回 503（而不是假装成功）', async () => {
    const response = await request('POST', '/api/admin/system/restart', { body: { reason: '测试' } });
    assert.equal(response.status, 503);
    assert.match(response.text, /RN_RESTART_UNAVAILABLE/);
  });

  it('seo 设置经重启真正生效（stringList 与布尔开关都改变实际行为）', async () => {
    // 默认值：拒绝 /admin 与 /api，且提供 /sitemap.xml
    const before = await request('GET', '/robots.txt');
    assert.equal(before.status, 200);
    assert.match(before.text, /Disallow: \/admin/);
    assert.equal((await request('GET', '/sitemap.xml')).status, 200);

    const saved = await request('PUT', '/api/admin/plugins/rice.seo/settings', {
      body: {
        values: {
          // 以"多行文本"提交，验证服务端会归一化成 string[]
          robotsDisallow: '/private\n\n  /draft  ',
          enableSitemap: false,
          twitterSite: '@ricenote'
        }
      }
    });
    assert.equal(saved.status, 200);

    // 未重启时插件仍按启动期快照运行（ADR-004 的既有语义）
    const stale = await request('GET', '/robots.txt');
    assert.match(stale.text, /Disallow: \/api/, '重启前沿用旧配置');

    await relaunch();

    const after = await request('GET', '/robots.txt');
    assert.equal(after.status, 200);
    assert.match(after.text, /Disallow: \/private/, '新配置里的路径应出现');
    assert.match(after.text, /Disallow: \/draft/, '空行与首尾空白应被丢弃');
    assert.doesNotMatch(after.text, /Disallow: \/api/, '旧配置里的路径应消失');
    assert.equal((await request('GET', '/sitemap.xml')).status, 404, '关闭后路由不再注册');

    // 保存的是归一化后的数组，而不是原始多行字符串
    const dto = await request('GET', '/api/admin/plugins/rice.seo/settings');
    const values = data<{ values: Record<string, unknown> }>(dto).values;
    assert.deepEqual(values.robotsDisallow, ['/private', '/draft']);
    assert.equal(values.enableSitemap, false);
  });
});

describe('页面 HTTP 闭环', () => {
  it('创建 → 渲染 → 导航 → 删除', async () => {
    // 先访问首页把 HTML 缓存"预热"，用于验证"新增页面后缓存被失效"
    const primed = await request('GET', '/');
    assert.equal(primed.status, 200);
    assert.doesNotMatch(primed.text, /\/page\/http-page/);

    const created = await request('POST', '/api/admin/pages', {
      body: {
        title: 'HTTP 页面',
        slug: 'http-page',
        content: '# 标题\n\n正文',
        status: 'published',
        template: 'plain'
      }
    });
    assert.equal(created.status, 201);
    const pageId = data<{ id: number }>(created).id;

    const rendered = await request('GET', '/page/http-page');
    assert.equal(rendered.status, 200);
    // 版式标记随主题而异，至少应命中当前主题的 page-plain 模板类
    assert.match(rendered.text, /page--plain/);
    assert.match(rendered.text, /正文/);

    /*
     * 导航插槽注入 + 缓存失效回归：
     * 页面出现在 header.navigation（每个页面都会渲染），因此写入后必须整体清缓存，
     * 否则这里会继续拿到预热时那份"没有该链接"的旧 HTML。
     */
    const home = await request('GET', '/');
    assert.match(home.text, /\/page\/http-page/);

    const removed = await request('DELETE', `/api/admin/pages/${pageId}`);
    assert.equal(removed.status, 200);

    const afterRemove = await request('GET', '/page/http-page');
    assert.equal(afterRemove.status, 404);

    // 删除后导航里也不应再有该链接（同样依赖缓存失效）
    const homeAfterRemove = await request('GET', '/');
    assert.doesNotMatch(homeAfterRemove.text, /\/page\/http-page/);
  });

  it('清单外的模板键被拒绝', async () => {
    const response = await request('POST', '/api/admin/pages', {
      body: { title: 'x', slug: 'bad-tpl', content: 'y', status: 'draft', template: 'nope' }
    });
    assert.equal(response.status, 400);
    assert.match(response.text, /RN_CONTENT_TEMPLATE_INVALID/);
  });
});
