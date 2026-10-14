/**
 * 评论邮箱相关行为的单元测试（纯替身，不连数据库）。
 *
 * 覆盖两件事：
 * - 「要求填写邮箱」设置：关闭后可留空、留空时不输出邮箱字段、填了仍校验格式；
 * - 邮箱开放给主题：前台评论项带上作者邮箱，线程数据里也能直接取到。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml } from '@ricenote/core';
import { ErrorCode, isRiceNoteError } from '@ricenote/shared';
import type { CommentThreadItem } from '@ricenote/shared';
import {
  createCommentsService,
  type CommentsRuntime,
  type CommentsSettings
} from '../../plugins/official/comments/src/service.js';
import { createCommentsSlot } from '../../plugins/official/comments/src/slot.js';

/* ------------------------------ 测试替身 ------------------------------ */

const SETTINGS: CommentsSettings = {
  enabled: true,
  requireApproval: true,
  requireEmail: true,
  pageSize: 20,
  maxLength: 2000,
  // 关闭频率限制：本文件验证的是邮箱，不涉及反垃圾
  rateLimitWindowSeconds: 0,
  rateLimitMaxSubmissions: 0,
  maxLinksPerComment: 2,
  maxDepth: 5,
  blockedKeywords: []
};

interface FakeRow {
  id: number;
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
    post_id: 7,
    parent_id: null,
    author_name: '访客甲',
    author_email: 'guest@example.com',
    author_url: null,
    content: '内容',
    status: 'approved',
    created_at: new Date('2026-10-14T08:00:00Z'),
    ...overrides
  };
}

/** 只实现被调用到的数据库方法：INSERT 记录参数、已通过评论查询返回给定行。 */
function makeRuntime(
  overrides: Partial<CommentsSettings> = {},
  rows: FakeRow[] = []
): { runtime: CommentsRuntime; inserts: { sql: string; params: unknown[] }[] } {
  const inserts: { sql: string; params: unknown[] }[] = [];

  const runtime = {
    db: {
      query: async (sql: string) => (sql.includes("status = 'approved'") ? rows : []),
      execute: async (sql: string, params: unknown[]) => {
        inserts.push({ sql, params });
        return { insertId: 1, affectedRows: 1 };
      }
    },
    siteId: 'site-test',
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    html: { escape: escapeHtml },
    invalidate() {},
    posts: () => ({ findPublishedById: async () => ({ id: 7, slug: 'hello' }) }),
    users: () => undefined,
    settings: { ...SETTINGS, ...overrides }
  } as unknown as CommentsRuntime;

  return { runtime, inserts };
}

/** 按列名取 INSERT 的参数，避免把断言绑死在列顺序上。 */
function paramOf(insert: { sql: string; params: unknown[] }, column: string): unknown {
  const columns = insert.sql.slice(insert.sql.indexOf('(') + 1, insert.sql.indexOf(')')).split(',');
  return insert.params[columns.map((item) => item.trim()).indexOf(column)];
}

function commentItem(overrides: Partial<CommentThreadItem> = {}): CommentThreadItem {
  return {
    id: 1,
    authorName: '访客甲',
    html: '<p>内容</p>',
    createdAt: '2026-10-14T08:00:00.000Z',
    children: [],
    ...overrides
  };
}

/** 用真实 Slot 渲染评论区（线程数据直接给定，不经过数据库）。 */
async function renderSlot(
  items: CommentThreadItem[],
  overrides: Partial<CommentsSettings> = {}
): Promise<string> {
  const { runtime } = makeRuntime(overrides);
  const slot = createCommentsSlot({
    runtime,
    buildThread: async () => ({ items, total: items.length, totalApproved: items.length })
  });

  return slot.render({
    data: { post: { id: 7, slug: 'hello' } },
    request: { query: {} }
  } as unknown as Parameters<typeof slot.render>[0]);
}

/* ------------------------------ 设置：是否必填 ------------------------------ */

describe('rice.comments：邮箱是否必填', () => {
  it('开启「要求填写邮箱」时留空被拒绝', async () => {
    const { runtime } = makeRuntime({ requireEmail: true });

    const error = await createCommentsService(runtime)
      .submit({ postId: 7, authorName: '访客甲', authorEmail: '   ', content: '内容' })
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    assert.ok(isRiceNoteError(error));
    assert.equal(error.code, ErrorCode.VALIDATION_FAILED);
    assert.match(error.message, /邮箱不能为空/);
  });

  it('关闭后可留空，且落库为空字符串', async () => {
    const { runtime, inserts } = makeRuntime({ requireEmail: false });

    const result = await createCommentsService(runtime).submit({
      postId: 7,
      authorName: '访客甲',
      content: '没有填邮箱的评论。'
    });

    assert.equal(result.status, 'pending');
    assert.equal(inserts.length, 1);
    assert.equal(paramOf(inserts[0]!, 'author_email'), '');
  });

  it('关闭后填了邮箱仍要校验格式', async () => {
    const { runtime } = makeRuntime({ requireEmail: false });

    const error = await createCommentsService(runtime)
      .submit({ postId: 7, authorName: '访客甲', authorEmail: '不是邮箱', content: '内容' })
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    assert.ok(isRiceNoteError(error));
    assert.match(error.message, /邮箱格式不正确/);
  });

  it('填写的邮箱统一按小写落库', async () => {
    const { runtime, inserts } = makeRuntime();

    await createCommentsService(runtime).submit({
      postId: 7,
      authorName: '访客甲',
      authorEmail: '  Guest-A@Example.COM ',
      content: '内容'
    });

    assert.equal(paramOf(inserts[0]!, 'author_email'), 'guest-a@example.com');
  });
});

/* ------------------------------ 邮箱交给主题 ------------------------------ */

describe('rice.comments：邮箱交给主题', () => {
  it('线程数据带出邮箱，未填写时不输出该字段', async () => {
    const rows = [
      fakeRow({ id: 1, author_email: 'guest@example.com' }),
      fakeRow({ id: 2, author_email: '' })
    ];
    const { runtime } = makeRuntime({}, rows);

    const thread = await createCommentsService(runtime).listApprovedThreaded({
      postId: 7,
      page: 1,
      pageSize: 20
    });

    assert.equal(thread.items[0]?.authorEmail, 'guest@example.com');
    assert.equal('authorEmail' in (thread.items[1] ?? {}), false, '没填邮箱时不应输出该字段');
  });

  it('评论项把邮箱写在 data 属性里，缺省时不输出空属性', async () => {
    const html = await renderSlot([
      commentItem({ id: 1, authorEmail: 'guest@example.com' }),
      commentItem({ id: 2 })
    ]);

    assert.equal(html.includes('data-rn-author-email="guest@example.com"'), true);
    assert.equal(html.split('data-rn-author-email').length - 1, 1, '没填邮箱的评论项不应带该属性');
  });

  it('邮箱里的特殊字符被转义，不会破坏属性', async () => {
    const html = await renderSlot([commentItem({ id: 3, authorEmail: 'a"b@example.com' })]);

    assert.equal(html.includes('data-rn-author-email="a&quot;b@example.com"'), true);
  });

  it('关闭「要求填写邮箱」后表单不再标必填', async () => {
    const required = await renderSlot([], { requireEmail: true });
    const optional = await renderSlot([], { requireEmail: false });

    assert.equal(required.includes('name="authorEmail" required'), true);
    assert.equal(required.includes('邮箱（可选）'), false);
    assert.equal(optional.includes('name="authorEmail" required'), false);
    assert.equal(optional.includes('邮箱（可选）'), true);
  });
});
