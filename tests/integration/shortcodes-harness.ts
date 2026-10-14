/**
 * 短代码集成测试的公共装置：真实内核 + Fastify + 真实数据库。
 *
 * 为什么必须端到端：本特性的三条关键性质只有装在真实站点上才看得见 ——
 * 正文里保留标记原文（服务端不替换）、页面引入引擎脚本并标注扫描容器、
 * 纯文字场合（订阅源）里标记被剥掉。任何一层用 mock 替掉都会漏掉其中一条。
 *
 * 文件不含 `.test.ts`，因此不会被测试脚本当作用例运行。不联网。
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

/** 独立测试库：与其它集成测试的库名互不重叠（不同文件会并行跑）。 */
export const TEST_DB = 'ricenote_test_shortcodes';

export const SEED = ['identity', 'authorization', 'posts', 'pages', 'taxonomy', 'feed', 'seo'];

/** 默认主题的示例短代码资源（主题自带，内核不内置任何短代码）。 */
export const THEME_SHORTCODE_SCRIPT = '/theme-assets/rice.default/js/shortcodes.js';

/** 引擎产物地址前缀（与 Core 的托管路由一致）。 */
export const RUNTIME_PREFIX = '/theme-sdk/v1/';

export interface ShortcodesKernel {
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

export async function bootKernel(): Promise<ShortcodesKernel> {
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
