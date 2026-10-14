/**
 * 评论事件的单元测试（纯替身，不连数据库）。
 *
 * 覆盖：新评论广播（含待审与垃圾）、回复时带上"被回复者"、审核改变状态时广播，
 * 以及状态未变化、删除评论都不广播。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml } from '@ricenote/core';
import {
  createCommentsService,
  type CommentsRuntime,
  type CommentsSettings
} from '../../plugins/official/comments/src/service.js';

const SETTINGS: CommentsSettings = {
  enabled: true,
  requireApproval: true,
  requireEmail: true,
  pageSize: 20,
  maxLength: 2000,
  // 关闭频率限制：本文件验证的是事件，不涉及反垃圾限流
  rateLimitWindowSeconds: 0,
  rateLimitMaxSubmissions: 0,
  maxLinksPerComment: 2,
  maxDepth: 5,
  blockedKeywords: []
};

interface FakeRow {
  id: number;
  site_id: string;
  post_id: number;
  parent_id: number | null;
  author_name: string;
  author_email: string;
  author_url: string | null;
  content: string;
  status: string;
  created_at: Date;
}

function fakeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 1,
    site_id: 'site-test',
    post_id: 7,
    parent_id: null,
    author_name: '访客甲',
    author_email: 'guest@example.com',
    author_url: null,
    content: '内容',
    status: 'pending',
    created_at: new Date('2026-10-14T08:00:00Z'),
    ...overrides
  };
}

/** 记录广播的事件与写库参数；`LIMIT 1` 与 `id IN (…)` 两种查询都按 ID 返回行。 */
function makeRuntime(rows: FakeRow[] = []): {
  runtime: CommentsRuntime;
  emitted: { event: string; payload: Record<string, unknown> }[];
  executed: { sql: string; params: unknown[] }[];
} {
  const emitted: { event: string; payload: Record<string, unknown> }[] = [];
  const executed: { sql: string; params: unknown[] }[] = [];
  const byId = new Map(rows.map((row) => [row.id, row]));

  const runtime = {
    db: {
      query: async (sql: string, params: readonly unknown[] = []) => {
        if (sql.includes('LIMIT 1')) {
          const row = byId.get(Number(params[0]));
          return row ? [row] : [];
        }
        if (sql.includes('id IN (')) {
          // 参数形如 [siteId, ...ids]
          return params.slice(1).flatMap((value) => {
            const row = byId.get(Number(value));
            return row ? [row] : [];
          });
        }
        if (sql.includes("status = 'approved'")) return rows;
        return [];
      },
      execute: async (sql: string, params: unknown[]) => {
        executed.push({ sql, params });
        return { insertId: 1, affectedRows: 1 };
      }
    },
    siteId: 'site-test',
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    html: { escape: escapeHtml },
    invalidate() {},
    emit: async (event: string, payload: unknown) => {
      emitted.push({ event, payload: payload as Record<string, unknown> });
    },
    posts: () => ({
      findPublishedById: async () => ({
        id: 7,
        title: '文章标题',
        slug: 'hello',
        url: '/post/hello'
      })
    }),
    users: () => undefined,
    settings: SETTINGS
  } as unknown as CommentsRuntime;

  return { runtime, emitted, executed };
}

describe('rice.comments：评论事件', () => {
  it('新评论广播 created，带上文章上下文与作者邮箱', async () => {
    const { runtime, emitted } = makeRuntime();

    const result = await createCommentsService(runtime).submit({
      postId: 7,
      authorName: '访客甲',
      authorEmail: 'Guest-A@Example.com',
      content: '你好',
      ip: '10.0.0.1'
    });

    assert.equal(emitted.length, 1);
    const event = emitted[0];
    assert.equal(event?.event, 'content.comment.created.v1');
    assert.equal(event?.payload.id, result.id);
    assert.equal(event?.payload.postId, 7);
    assert.equal(event?.payload.postTitle, '文章标题');
    assert.equal(event?.payload.postUrl, '/post/hello');
    assert.equal(event?.payload.authorEmail, 'guest-a@example.com');
    assert.equal(event?.payload.status, 'pending');
    assert.equal(event?.payload.parentId, null);
    assert.equal('parentAuthorEmail' in (event?.payload ?? {}), false, '非回复不应带父评论作者');
    assert.equal('from' in (event?.payload ?? {}), false, 'created 事件不带 from');
  });

  it('回复评论时带上被回复者，供"通知被回复的人"使用', async () => {
    const parent = fakeRow({
      id: 20,
      author_name: '楼主',
      author_email: 'owner@example.com',
      status: 'approved'
    });
    const { runtime, emitted } = makeRuntime([parent]);

    await createCommentsService(runtime).submit({
      postId: 7,
      parentId: 20,
      authorName: '回复者',
      authorEmail: 'reply@example.com',
      content: '回复内容',
      ip: '10.0.0.2'
    });

    const event = emitted[0];
    assert.equal(event?.event, 'content.comment.created.v1');
    assert.equal(event?.payload.parentId, 20);
    assert.equal(event?.payload.parentAuthorName, '楼主');
    assert.equal(event?.payload.parentAuthorEmail, 'owner@example.com');
  });

  it('垃圾评论也广播（订阅方按 status 自行过滤）', async () => {
    const { runtime, emitted } = makeRuntime();

    await createCommentsService(runtime).submit({
      postId: 7,
      authorName: '推广',
      authorEmail: 'spam@example.com',
      content: '看这里 http://a.com http://b.com http://c.com http://d.com',
      ip: '10.0.0.3'
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.payload.status, 'spam');
  });

  it('审核改变状态时广播 status.changed，带 from 与当前状态', async () => {
    const pending = fakeRow({ id: 5, status: 'pending', parent_id: 20 });
    const parent = fakeRow({
      id: 20,
      status: 'approved',
      author_name: '楼主',
      author_email: 'owner@example.com'
    });
    const { runtime, emitted, executed } = makeRuntime([pending, parent]);

    await createCommentsService(runtime).moderate({ ids: [5], action: 'approve' });

    assert.equal(executed.length, 1, '应执行一次状态更新');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.event, 'content.comment.status.changed.v1');
    assert.equal(emitted[0]?.payload.from, 'pending');
    assert.equal(emitted[0]?.payload.status, 'approved');
    assert.equal(emitted[0]?.payload.parentAuthorEmail, 'owner@example.com');
  });

  it('状态没有真正变化时不广播', async () => {
    const approved = fakeRow({ id: 6, status: 'approved' });
    const { runtime, emitted } = makeRuntime([approved]);

    await createCommentsService(runtime).moderate({ ids: [6], action: 'approve' });

    assert.equal(emitted.length, 0);
  });

  it('删除评论只删不发事件', async () => {
    const row = fakeRow({ id: 7, status: 'approved' });
    const { runtime, emitted, executed } = makeRuntime([row]);

    await createCommentsService(runtime).moderate({ ids: [7], action: 'delete' });

    assert.equal(emitted.length, 0);
    assert.equal(executed.length, 1);
    assert.match(executed[0]?.sql ?? '', /^DELETE/);
  });
});
