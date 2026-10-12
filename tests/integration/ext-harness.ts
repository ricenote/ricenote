/**
 * 扩展点 / 内容字段集成测试的公共装置：真实内核 + Fastify + 双会话。
 *
 * 抽到单独文件只为让主测试文件（extension-points.test.ts）保持在 300 行以内，
 * 不引入任何新依赖、不联网。文件名不含 `.test.ts`，因此不会被测试脚本当作用例运行。
 */

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { bootstrap, loadConfig, type RiceNoteKernel } from '@ricenote/core';
import { startHttpServer, type RunningServer } from '@ricenote/server/dist/server.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** 独立测试库：node:test 并行跑不同文件，库名必须与其它集成测试互不重叠。 */
export const TEST_DB = 'ricenote_test_extpoints';
export const SEED = [
  'identity', 'authorization', 'posts', 'taxonomy', 'media', 'pages', 'reading-time', 'editor-enhance',
  // feed / friend-links 也进 SEED：它们的 start() 只在"装上即失败"这类运行时问题（能力门漏声明、
  // 路由冲突、迁移失败）上暴露，不启它们就等于不测。
  'feed', 'friend-links'
];

export interface JsonResponse {
  status: number;
  json: Record<string, unknown> | undefined;
  text: string;
}
export interface Session {
  request(method: string, url: string, options?: { body?: unknown; csrf?: boolean }): Promise<JsonResponse>;
}

/** 每个会话持有独立的 Cookie 罐：admin 与受限用户必须互不污染。 */
export function createSession(origin: string): Session {
  const jar = new Map<string, string>();
  return {
    async request(method, url, options = {}) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      // 双提交 CSRF：写操作带上登录时下发的 token（与 http-surface 测试一致）
      if (options.csrf ?? method !== 'GET') {
        const token = jar.get('ricenote_csrf');
        if (token) headers['x-csrf-token'] = decodeURIComponent(token);
      }
      if (options.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
      if (jar.size > 0) headers.Cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');

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
  };
}

export function data<T>(response: { json: Record<string, unknown> | undefined }): T {
  return response.json?.data as T;
}

export async function login(session: Session, username: string, password: string): Promise<void> {
  const res = await session.request('POST', '/api/admin/session', { body: { username, password } });
  assert.equal(res.status, 200, `登录失败（${username}）：${res.text}`);
}

export interface ExtHarness {
  kernel: RiceNoteKernel;
  admin: Session;
  /** 无任何角色的受限会话，用于验证"未授权即不可见"的过滤。 */
  limited: Session;
  stop(): Promise<void>;
}

export async function bootExtHarness(): Promise<ExtHarness> {
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

  const kernel = await bootstrap({
    rootDir,
    overrides: { database: { name: TEST_DB }, http: { port: 0 }, logLevel: 'error', seedPlugins: SEED }
  });

  /*
   * SEED 里的插件必须全部启动成功。
   * 少了这条断言，把插件加进 SEED 只是"加载了"：能力门漏声明（例如订阅了未声明的
   * `events:subscribe`）、迁移失败、路由冲突都只会把插件标记为 failed，测试照样全绿。
   */
  assert.equal((await kernel.health()).plugins.failed, 0, '不应有插件启动失败');

  const server: RunningServer = await startHttpServer(kernel, { trustProxy: false });
  const origin = `http://127.0.0.1:${(server.app.server.address() as AddressInfo).port}`;

  const admin = createSession(origin);
  await login(admin, 'admin', 'admin12345');

  // 受限会话：新用户默认**不分配角色**，因此不具备任何权限点
  const limited = createSession(origin);
  const created = await admin.request('POST', '/api/admin/users', {
    body: { username: 'viewer01', email: 'viewer01@example.com', password: 'viewer12345' }
  });
  assert.equal(created.status, 201, created.text);
  await login(limited, 'viewer01', 'viewer12345');

  return {
    kernel,
    admin,
    limited,
    async stop() {
      await server.close();
      await kernel.shutdown();
    }
  };
}
