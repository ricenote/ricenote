/**
 * 「固定链接」集成测试的公共装置：真实内核 + Fastify + 真实数据库。
 *
 * 为什么必须端到端：本功能的关键性质横跨"设置落库 → 重启后重新装配 → 路由注册 →
 * 前台渲染 → 订阅源/站点地图"，任何一层用 mock 替掉都测不出真实行为
 * （例如"路径接管发生在 HTTP 装配之前"这条时序约束）。
 *
 * 文件不含 `.test.ts`，因此不会被测试脚本当作用例运行。
 */

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { bootstrap, loadConfig, type RiceNoteKernel } from '@ricenote/core';
import { startHttpServer, type RunningServer } from '@ricenote/server/dist/server.js';
import { createSession, login, type Session } from './ext-harness.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 独立测试库：与其它集成测试的库名互不重叠（并发跑不同文件时不会互相 DROP）。 */
export const TEST_DB = 'ricenote_test_permalink';

/**
 * 参与装配的插件。
 *
 * 固定链接依赖的三个内容插件（posts / pages / taxonomy）必须都在 ——
 * 少了任何一个，对应方案就会在装配阶段被跳过，测试会变成"测了但没测到"。
 * feed / seo 用于验证"地址改了，订阅源与站点地图跟着改"。
 */
export const SEED = [
  'identity',
  'authorization',
  'posts',
  'pages',
  'taxonomy',
  'permalink',
  'feed',
  'seo'
];

export interface PermalinkKernel {
  kernel: RiceNoteKernel;
  origin: string;
  admin: Session;
  stop(): Promise<void>;
}

/** 重建一个干净的测试库（只在用例开始时调用一次）。 */
export async function resetDatabase(): Promise<void> {
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

/**
 * 装配一个内核并起 HTTP。
 *
 * 同一个测试用例会调用两次（改设置 → "重启"）：第二次沿用同一个库，
 * 因此 `rn_plugins` 里已有启用记录，插件会照常启动 —— 这正是"重启后生效"的语义。
 */
export async function bootKernel(): Promise<PermalinkKernel> {
  // overrides 是**浅** Partial：嵌套片段要整块给出，因此以 .env 解析结果为底再覆盖
  const base = loadConfig({ rootDir });
  const kernel = await bootstrap({
    rootDir,
    overrides: {
      ...base,
      database: { ...base.database, name: TEST_DB },
      http: { ...base.http, port: 0 },
      logLevel: 'error',
      seedPlugins: SEED
    }
  });

  assert.equal((await kernel.health()).plugins.failed, 0, '不应有插件启动失败');

  const server: RunningServer = await startHttpServer(kernel, { trustProxy: false });
  const origin = `http://127.0.0.1:${(server.app.server.address() as AddressInfo).port}`;

  const admin = createSession(origin);
  await login(admin, 'admin', 'admin12345');

  return {
    kernel,
    origin,
    admin,
    async stop() {
      await server.close();
      await kernel.shutdown();
    }
  };
}
