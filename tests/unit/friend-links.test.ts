/**
 * 友情链接插件的纯逻辑单元测试 —— 离线、无需数据库。
 *
 * 压着的性质：
 * - **地址必须自证**：`url` 只能是 `http(s)://` 完整地址（否则前台会输出 `javascript:`
 *   这类可执行链接）；头像额外允许媒体库相对路径，其余一律拒绝；
 * - **写入必须失效缓存**：`/links` 是可缓存的 HTML，改完不清缓存就会一直显示旧友链；
 * - **停用 ≠ 删除**：停用项保留在库里（前台不展示），因此列表接口要能同时给出两类；
 * - 排序值要收敛，非法输入不能写进库（负数、NaN、字符串）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createFriendLinksService,
  isHttpUrl,
  isMediaPath
} from '../../plugins/official/friend-links/src/service.js';
import type { FriendLinksRuntime } from '../../plugins/official/friend-links/src/types.js';

/* ------------------------------ 测试替身 ------------------------------ */

interface RecordedCall {
  sql: string;
  params: readonly unknown[];
}

interface FakeDbOptions {
  /** `query` 的返回值（默认空数组 = 查不到记录）。 */
  rows?: unknown[];
  affectedRows?: number;
  insertId?: number;
}

/** 记录 SQL 调用的极简数据库替身：只关心"被调用了什么、参数是什么"。 */
function createFakeDb(options: FakeDbOptions = {}) {
  const calls: RecordedCall[] = [];

  const db = {
    pluginId: 'rice.friend-links',
    orm: {},
    async query(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      return (options.rows ?? []) as never[];
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      return { affectedRows: options.affectedRows ?? 1, insertId: options.insertId ?? 7 };
    },
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
    table(name: string) {
      return `rn_friend_links_${name}`;
    }
  };

  return { db, calls };
}

interface Harness {
  service: ReturnType<typeof createFriendLinksService>;
  calls: RecordedCall[];
  invalidations: string[][];
}

function createHarness(options: FakeDbOptions = {}): Harness {
  const { db, calls } = createFakeDb(options);
  const invalidations: string[][] = [];

  const runtime = {
    db,
    siteId: 'default',
    theme: {
      invalidate(tags: string[]) {
        invalidations.push(tags);
        return tags.length;
      },
      clearCache() {}
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  } as unknown as FriendLinksRuntime;

  return {
    calls,
    invalidations,
    service: createFriendLinksService({ runtime, log: () => {} })
  };
}

const ROW = {
  id: 5,
  site_id: 'default',
  name: '示例站点',
  url: 'https://friend.example',
  avatar_url: null as string | null,
  description: null as string | null,
  sort_order: 3,
  enabled: 1 as number | boolean,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z'
};

async function errorCodeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

/* ------------------------------ 地址判定 ------------------------------ */

describe('友链地址判定', () => {
  it('只接受 http(s):// 完整地址', () => {
    assert.equal(isHttpUrl('https://example.com'), true);
    assert.equal(isHttpUrl('http://example.com/a?b=1'), true);
    assert.equal(isHttpUrl('//example.com'), false);
    assert.equal(isHttpUrl('/about'), false);
    assert.equal(isHttpUrl('javascript:alert(1)'), false);
    assert.equal(isHttpUrl('https://'), false);
  });

  it('头像额外允许媒体库相对路径', () => {
    assert.equal(isMediaPath('/uploads/2026/10/a.png'), true);
    assert.equal(isMediaPath('/media/12'), true);
    assert.equal(isMediaPath('uploads/a.png'), false);
    assert.equal(isMediaPath('/etc/passwd'), false);
  });
});

/* ------------------------------ 列表映射 ------------------------------ */

describe('友链列表映射', () => {
  it('前台只取启用项，空头像与空描述回退为空串', async () => {
    const { service } = createHarness({ rows: [ROW] });
    const items = await service.listRenderable();

    assert.deepEqual(items, [
      {
        name: '示例站点',
        url: 'https://friend.example',
        avatarUrl: '',
        description: ''
      }
    ]);
  });

  it('后台列表保留停用项，并把 0/1 还原为布尔与 ISO 时间', async () => {
    const { service } = createHarness({ rows: [{ ...ROW, enabled: 0 }] });
    const items = await service.listForAdmin();

    assert.equal(items.length, 1);
    assert.equal(items[0]?.enabled, false);
    assert.equal(items[0]?.sortOrder, 3);
    assert.equal(items[0]?.updatedAt, '2026-10-02T00:00:00.000Z');
  });
});

/* ------------------------------ 保存校验 ------------------------------ */

describe('友链保存校验', () => {
  it('缺少名称被拒绝', async () => {
    const { service } = createHarness();
    const code = await errorCodeOf(() => service.save({ payload: { name: '   ', url: 'https://a.com' } }));
    assert.equal(code, 'RN_VALIDATION_FAILED');
  });

  it('地址不是完整 http(s) 地址被拒绝', async () => {
    const { service } = createHarness();
    for (const url of ['example.com', '/about', 'javascript:alert(1)']) {
      const code = await errorCodeOf(() => service.save({ payload: { name: '友链', url } }));
      assert.equal(code, 'RN_VALIDATION_FAILED', `${url} 应被拒绝`);
    }
  });

  it('头像既不是完整地址也不是媒体库路径时被拒绝', async () => {
    const { service } = createHarness();
    const code = await errorCodeOf(() =>
      service.save({ payload: { name: '友链', url: 'https://a.com', avatarUrl: '/etc/passwd' } })
    );
    assert.equal(code, 'RN_VALIDATION_FAILED');
  });

  it('合法新建写库、追加到末尾并失效缓存', async () => {
    const { service, calls, invalidations } = createHarness();
    const result = await service.save({
      payload: { name: '  新友链  ', url: 'https://a.com', avatarUrl: '', description: ' ' }
    });

    assert.equal(result.id, 7);

    const insert = calls.find((call) => call.sql.includes('INSERT INTO rn_friend_links'));
    assert.ok(insert, '应执行 INSERT');
    // siteId, name(已 trim), url, avatarUrl(空→NULL), description(空→NULL), sortOrder, enabled
    assert.deepEqual(insert.params, ['default', '新友链', 'https://a.com', null, null, 1, 1]);

    assert.deepEqual(invalidations, [['friend-links']]);
  });

  it('排序值收敛：负数归零、超上限压到上限、非法回退到默认', async () => {
    const cases: { input: unknown; expected: number }[] = [
      { input: -5, expected: 0 },
      { input: '12', expected: 12 },
      { input: 99999999, expected: 999999 },
      { input: 'abc', expected: 1 } // 非法 → 回退到"追加到末尾"（空表即 1）
    ];

    for (const item of cases) {
      const { service, calls } = createHarness();
      await service.save({
        payload: { name: '友链', url: 'https://a.com', sortOrder: item.input as number }
      });
      const insert = calls.find((call) => call.sql.includes('INSERT INTO rn_friend_links'));
      assert.equal(insert?.params[5], item.expected, `sortOrder=${String(item.input)}`);
    }
  });

  it('更新不存在的友链返回 404', async () => {
    const { service } = createHarness({ rows: [] });
    const code = await errorCodeOf(() =>
      service.save({ id: 999, payload: { name: '友链', url: 'https://a.com' } })
    );
    assert.equal(code, 'RN_NOT_FOUND');
  });

  it('删除不存在的友链返回 404，且不失效缓存', async () => {
    const { service, invalidations } = createHarness({ affectedRows: 0 });
    const code = await errorCodeOf(() => service.remove(999));

    assert.equal(code, 'RN_NOT_FOUND');
    assert.deepEqual(invalidations, []);
  });

  it('删除成功后失效缓存', async () => {
    const { service, invalidations } = createHarness({ affectedRows: 1 });
    await service.remove(5);
    assert.deepEqual(invalidations, [['friend-links']]);
  });
});
