/**
 * comments 插件的业务层：参数校验、反垃圾、四态审核与线程构建。
 *
 * 安全约定：
 * - 评论正文按**纯文本**处理（唯一一次转义发生在 {@link renderContent}），
 *   因此即使绕过反垃圾也无法注入 HTML；
 * - IP 只以加盐哈希形式留档，用于频率限制与人工判别，不落明文。
 */

import { createHash } from 'node:crypto';
import {
  ErrorCode,
  RiceNoteError,
  type CommentCounts,
  type CommentListQuery,
  type CommentModerateRequest,
  type CommentModerationAction,
  type CommentStatus,
  type CommentSubmitRequest,
  type CommentSummary,
  type CommentThreadItem,
  type ContentCommentsService,
  type ContentPostsService,
  type CoreHtmlService,
  type IdentityUsersService
} from '@ricenote/shared';
import type { PluginContext, PluginDatabase } from '@ricenote/plugin-sdk';
import {
  countByStatus,
  countRecentByIpHash,
  countReplies,
  countsForPosts,
  deleteByIds,
  findCommentById,
  insertComment,
  listApprovedByPost,
  listByIds,
  listForAdmin,
  postIdsOf,
  recent,
  updateStatus,
  type CommentRow
} from './repository.js';

/** 后台审核动作 → 目标状态（`delete` 单独处理）。 */
const STATUS_BY_ACTION: Record<Exclude<CommentModerationAction, 'delete'>, CommentStatus> = {
  approve: 'approved',
  pending: 'pending',
  spam: 'spam',
  trash: 'trash'
};

const NAME_MIN = 2;
const NAME_MAX = 80;
const EMAIL_MAX = 160;
const URL_MAX = 300;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_BLOCKED_KEYWORDS = 200;

export interface CommentsSettings {
  /** 是否启用评论区（关闭后 Slot 不输出任何内容，主题无需改动）。 */
  enabled: boolean;
  /** 新评论是否需要人工审核（默认 true，即"先审后发"）。 */
  requireApproval: boolean;
  /** 是否要求访客填写邮箱（关闭后可以留空，留空时前台不输出邮箱字段）。 */
  requireEmail: boolean;
  pageSize: number;
  maxLength: number;
  /** 频率限制窗口（秒）。 */
  rateLimitWindowSeconds: number;
  /** 单个窗口内同一来源允许的提交数。 */
  rateLimitMaxSubmissions: number;
  maxLinksPerComment: number;
  maxDepth: number;
  blockedKeywords: string[];
}

export interface CommentsRuntime {
  db: PluginDatabase;
  siteId: string;
  logger: PluginContext['logger'];
  html: CoreHtmlService;
  /** 评论变化后失效文章页缓存（评论渲染在文章页的 Slot 中）。 */
  invalidate(tags: string[]): void;
  /**
   * 广播评论事件（`content.comment.created.v1` / `content.comment.status.changed.v1`）。
   *
   * 事件总线是**尽力而为**的（内存实现，进程重启即丢）：它适合"有新评论就立刻通知"
   * 这类场景；需要至少一次投递的订阅方应另用公开契约（`recent()` / `listForAdmin()`）
   * 回捞对账。
   */
  emit(event: string, payload: unknown): Promise<void>;
  /** 可选依赖：惰性解析，plugins 被禁用时降级。 */
  posts(): ContentPostsService | undefined;
  users(): IdentityUsersService | undefined;
  settings: CommentsSettings;
}

/** 评论事件里携带的评论快照（订阅方据此决定要不要通知、通知谁）。 */
type CommentEventPayload = {
  id: number;
  postId: number;
  /** 文章标题；文章已不可读（删除/取消发布）时缺省。 */
  postTitle?: string;
  /** 文章前台地址（由 posts 按当前固定链接方案生成）；取不到时缺省。 */
  postUrl?: string;
  parentId: number | null;
  /**
   * 被回复评论的作者；**仅回复时**存在。
   *
   * "通知被回复的人"必须用它：订阅方既拿不到（别的插件不能读 `rn_comments`），
   * 也无法反查，因此由本插件在事件里一并交出。
   */
  parentAuthorName?: string;
  parentAuthorEmail?: string;
  authorName: string;
  /** 作者邮箱（已归一化为小写；站长允许留空时为空字符串）。 */
  authorEmail: string;
  /** 正文原文（**未消毒**，要展示请自行转义）。 */
  content: string;
  /** 广播时的审核状态。 */
  status: CommentStatus;
  /** **仅** `content.comment.status.changed.v1` 携带：变更前的状态。 */
  from?: CommentStatus;
};

/** 从数据库行组装事件快照（文章上下文与父评论由调用方补齐）。 */
function snapshotOfRow(
  row: CommentRow,
  context: { post?: { title?: string; url?: string }; parent?: CommentRow } = {}
): CommentEventPayload {
  return {
    id: row.id,
    postId: Number(row.post_id),
    ...(context.post?.title ? { postTitle: context.post.title } : {}),
    ...(context.post?.url ? { postUrl: context.post.url } : {}),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    ...(context.parent
      ? {
          parentAuthorName: context.parent.author_name,
          parentAuthorEmail: context.parent.author_email
        }
      : {}),
    authorName: row.author_name,
    authorEmail: row.author_email,
    content: row.content,
    status: row.status
  };
}

/** 文章上下文：只取公开契约给出的标题与前台地址，绝不自己拼 `/post/:slug`。 */
async function postContextOf(
  runtime: CommentsRuntime,
  postId: number
): Promise<{ title?: string; url?: string } | undefined> {
  const posts = runtime.posts();
  if (!posts) return undefined;

  const post = await posts.findPublishedById(postId).catch(() => undefined);
  return post ? { title: post.title, ...(post.url ? { url: post.url } : {}) } : undefined;
}

/**
 * 广播一条评论事件。
 *
 * 事件与业务写入不同源：**订阅方出问题不能把"评论已提交 / 已审核"变成失败**，
 * 因此这里兜底吞掉异常并留一条日志（总线本身已隔离单个订阅的抛错）。
 */
async function emitCommentEvent(
  runtime: CommentsRuntime,
  event: string,
  payload: CommentEventPayload
): Promise<void> {
  try {
    await runtime.emit(event, payload);
  } catch (error) {
    runtime.logger.warn('评论事件广播失败', {
      event,
      commentId: payload.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export function createCommentsService(runtime: CommentsRuntime): ContentCommentsService {
  const { db, siteId, settings } = runtime;

  async function buildThread(
    postId: number,
    page: number,
    pageSize: number
  ): Promise<{ items: CommentThreadItem[]; total: number; totalApproved: number }> {
    const rows = await listApprovedByPost(db, siteId, postId);
    const roots = buildTree(rows, settings.maxDepth, (row) => renderContent(runtime, row));

    const safePage = Math.max(1, Math.trunc(page));
    const safeSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));
    const start = (safePage - 1) * safeSize;

    return {
      items: roots.slice(start, start + safeSize),
      total: roots.length,
      totalApproved: rows.length
    };
  }

  async function submit(
    input: CommentSubmitRequest & { ip?: string; userAgent?: string; userId?: number }
  ): Promise<{ id: number; status: CommentStatus }> {
    const posts = runtime.posts();
    if (!posts) {
      throw new RiceNoteError(ErrorCode.SERVICE_NOT_FOUND, '文章插件未启用，暂时无法提交评论', {
        status: 503
      });
    }

    const postId = Math.trunc(Number(input.postId));
    if (!Number.isInteger(postId) || postId <= 0) {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '文章标识非法', { status: 400 });
    }

    const post = await posts.findPublishedById(postId);
    if (!post) {
      throw new RiceNoteError(ErrorCode.NOT_FOUND, '要评论的文章不存在或尚未发布', { status: 404 });
    }

    const authorName = normalizePlain(input.authorName, '昵称');
    if (authorName.length < NAME_MIN || authorName.length > NAME_MAX) {
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `昵称长度需在 ${NAME_MIN} 到 ${NAME_MAX} 个字符之间`,
        { status: 400 }
      );
    }

    const authorEmail = normalizeAuthorEmail(input.authorEmail, settings.requireEmail);

    const authorUrl = normalizeOptionalUrl(input.authorUrl);

    const content = (input.content ?? '').replace(/\r\n/g, '\n').trim();
    if (content.length === 0) {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '评论内容不能为空', { status: 400 });
    }
    if (content.length > settings.maxLength) {
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `评论内容超出上限（${settings.maxLength} 字）`,
        { status: 400 }
      );
    }

    // 取回父评论整行：事件载荷要带"被回复的人"，后续不必再查
    const parent = await resolveParent(db, siteId, postId, input.parentId, settings.maxDepth);
    const parentId = parent?.id ?? null;

    const ipHash = hashSource(input.ip, siteId);
    if (ipHash && settings.rateLimitWindowSeconds > 0 && settings.rateLimitMaxSubmissions > 0) {
      const recentCount = await countRecentByIpHash(
        db,
        siteId,
        ipHash,
        settings.rateLimitWindowSeconds
      );
      if (recentCount >= settings.rateLimitMaxSubmissions) {
        throw new RiceNoteError(
          ErrorCode.RATE_LIMITED,
          `提交过于频繁，请稍后再试（${settings.rateLimitWindowSeconds} 秒内最多 ${settings.rateLimitMaxSubmissions} 条）`,
          { status: 429 }
        );
      }
    }

    const status = classify(content, authorName, authorUrl, settings);

    const id = await insertComment(db, {
      siteId,
      postId,
      parentId,
      userId: input.userId ?? null,
      authorName,
      authorEmail,
      authorUrl,
      content,
      status,
      ipHash,
      userAgent: truncate(input.userAgent ?? '', URL_MAX)
    });

    if (status === 'approved') {
      runtime.invalidate([`post:${postId}`, 'posts']);
    }

    runtime.logger.info('评论已提交', { id, postId, status, parentId });

    /*
     * 广播"有新评论"。
     *
     * 待审与垃圾评论**同样广播** —— 它是一个事实，取舍交给订阅方（要"只在公开后通知"
     * 就等 status.changed 事件）。文章上下文直接沿用提交时已取出的一份，不额外查库。
     */
    await emitCommentEvent(runtime, 'content.comment.created.v1', {
      id,
      postId,
      postTitle: post.title,
      ...(post.url ? { postUrl: post.url } : {}),
      parentId,
      ...(parent
        ? { parentAuthorName: parent.author_name, parentAuthorEmail: parent.author_email }
        : {}),
      authorName,
      authorEmail,
      content,
      status
    });

    return { id, status };
  }

  return {
    listApprovedThreaded: ({ postId, page, pageSize }) =>
      buildThread(postId, page ?? 1, pageSize ?? settings.pageSize),

    submit,

    async listForAdmin(query: CommentListQuery) {
      const { items, total } = await listForAdmin(db, siteId, query);

      const postIds = [...new Set(items.map((row) => Number(row.post_id)))];
      const replyCounts = await countReplies(
        db,
        items.map((row) => row.id)
      );

      let titles: Record<number, string> = {};
      const posts = runtime.posts();
      if (posts && postIds.length > 0) {
        titles = await posts.titlesOf(postIds);
      }

      return {
        items: items.map((row) => toSummary(row, titles[Number(row.post_id)], replyCounts[row.id] ?? 0)),
        total
      };
    },

    async moderate(input: CommentModerateRequest) {
      const ids = [...new Set((input.ids ?? []).map((id) => Math.trunc(Number(id))))].filter(
        (id) => Number.isInteger(id) && id > 0
      );
      if (ids.length === 0) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '未选择任何评论', { status: 400 });
      }

      /*
       * 审核前先把行取出来：
       * - 事件要带"变更前的状态"，状态没真正变化的评论也不该广播；
       * - 还要补上父评论作者（"通知被回复的人"必须等通过之后才发信，
       *   否则待审/垃圾回复就成了给第三方发信的通道）。
       * 删除动作不广播事件，因此不必取。
       */
      const before = input.action === 'delete' ? [] : await listByIds(db, siteId, ids);
      const parentIds = before.flatMap((row) =>
        row.parent_id === null ? [] : [Number(row.parent_id)]
      );
      const parentsById = new Map(
        (await listByIds(db, siteId, parentIds)).map((row) => [row.id, row])
      );

      const contexts = new Map<number, { title?: string; url?: string } | undefined>();
      for (const row of before) {
        const postId = Number(row.post_id);
        if (!contexts.has(postId)) contexts.set(postId, await postContextOf(runtime, postId));
      }

      const affectedPosts = await postIdsOf(db, siteId, ids);

      const affected =
        input.action === 'delete'
          ? await deleteByIds(db, siteId, ids)
          : await updateStatus(db, siteId, ids, STATUS_BY_ACTION[input.action]);

      if (affectedPosts.length > 0) {
        runtime.invalidate([...affectedPosts.map((id) => `post:${id}`), 'posts']);
      }

      runtime.logger.info('评论审核已执行', { action: input.action, ids, affected });

      if (input.action !== 'delete') {
        const target = STATUS_BY_ACTION[input.action];

        for (const row of before) {
          // 状态没有真正变化（例如对已通过的评论再点一次"通过"）：不发信号
          if (row.status === target) continue;

          const context = contexts.get(Number(row.post_id));
          const parentRow = row.parent_id === null ? undefined : parentsById.get(Number(row.parent_id));

          await emitCommentEvent(runtime, 'content.comment.status.changed.v1', {
            ...snapshotOfRow(row, {
              ...(context ? { post: context } : {}),
              ...(parentRow ? { parent: parentRow } : {})
            }),
            status: target,
            from: row.status
          });
        }
      }

      return { affected };
    },

    async countByStatus(): Promise<CommentCounts> {
      const byStatus = await countByStatus(db, siteId);
      return {
        pending: byStatus.pending,
        approved: byStatus.approved,
        spam: byStatus.spam,
        trash: byStatus.trash,
        total: byStatus.pending + byStatus.approved + byStatus.spam + byStatus.trash
      };
    },

    countsForPosts: (postIds) => countsForPosts(db, siteId, postIds),

    async recent(limit: number) {
      const rows = await recent(db, siteId, limit);
      const posts = runtime.posts();
      const postIds = [...new Set(rows.map((row) => Number(row.post_id)))];
      const titles = posts && postIds.length > 0 ? await posts.titlesOf(postIds) : {};
      return rows.map((row) => toSummary(row, titles[Number(row.post_id)], 0));
    }
  };
}

/* ------------------------------ 内部实现 ------------------------------ */

function toSummary(row: CommentRow, postTitle: string | undefined, replyCount: number): CommentSummary {
  return {
    id: row.id,
    postId: Number(row.post_id),
    ...(postTitle ? { postTitle } : {}),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    authorName: row.author_name,
    authorEmail: row.author_email,
    ...(row.author_url ? { authorUrl: row.author_url } : {}),
    ...(row.user_id === null ? {} : { userId: Number(row.user_id) }),
    content: row.content,
    status: row.status,
    ...(row.ip_hash ? { ipHash: row.ip_hash } : {}),
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
    replyCount,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

/** 把已通过评论构建为线程；超出 maxDepth 的回复平铺到最近的允许层，避免无限嵌套。 */
function buildTree(
  rows: CommentRow[],
  maxDepth: number,
  renderHtml: (row: CommentRow) => string
): CommentThreadItem[] {
  const depthLimit = Math.max(1, maxDepth);
  const nodes = new Map<number, { item: CommentThreadItem; depth: number }>();
  const roots: CommentThreadItem[] = [];

  for (const row of rows) {
    const item: CommentThreadItem = {
      id: row.id,
      authorName: row.author_name,
      // 邮箱开放给主题（可能为空：站长允许留空时不输出该字段）
      ...(row.author_email ? { authorEmail: row.author_email } : {}),
      ...(row.author_url ? { authorUrl: row.author_url } : {}),
      html: renderHtml(row),
      createdAt: toIso(row.created_at),
      children: []
    };

    const parent = row.parent_id === null ? undefined : nodes.get(Number(row.parent_id));
    if (!parent) {
      // 父评论未通过审核时该回复升级为根节点，避免评论"消失"
      roots.push(item);
      nodes.set(row.id, { item, depth: 1 });
      continue;
    }

    const depth = Math.min(parent.depth + 1, depthLimit);
    parent.item.children.push(item);
    nodes.set(row.id, { item, depth });
  }

  return roots;
}

/** 纯文本 → 转义后的 HTML（保留换行）。 */
function renderContent(runtime: CommentsRuntime, row: CommentRow): string {
  return runtime.html.escape(row.content).replace(/\n/g, '<br>');
}

/** 反垃圾判定：命中黑名单或超出链接配额即进入垃圾状态。 */
function classify(
  content: string,
  authorName: string,
  authorUrl: string | null,
  settings: CommentsSettings
): CommentStatus {
  const haystack = `${authorName}\n${authorUrl ?? ''}\n${content}`.toLowerCase();
  const blocked = settings.blockedKeywords.slice(0, MAX_BLOCKED_KEYWORDS).some((word) => {
    const needle = word.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });

  const linkCount = (content.match(/https?:\/\//gi) ?? []).length + (authorUrl ? 1 : 0);
  if (blocked || linkCount > Math.max(0, settings.maxLinksPerComment)) return 'spam';

  return settings.requireApproval ? 'pending' : 'approved';
}

/**
 * 校验父评论：必须存在、同属一篇文章、且本身不是垃圾或回收站中的评论。
 *
 * 返回父评论**整行**而不只是 ID：事件载荷要带上"被回复的人"，这样订阅方不必
 * （也不能）再反查 —— 别的插件读不到 `rn_comments`。
 */
async function resolveParent(
  db: PluginDatabase,
  siteId: string,
  postId: number,
  rawParentId: number | null | undefined,
  maxDepth: number
): Promise<CommentRow | null> {
  if (rawParentId === null || rawParentId === undefined || rawParentId === 0) return null;

  const parentId = Math.trunc(Number(rawParentId));
  if (!Number.isInteger(parentId) || parentId <= 0) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '父评论标识非法', { status: 400 });
  }

  const parent = await findCommentById(db, parentId);
  if (!parent || parent.site_id !== siteId || Number(parent.post_id) !== postId) {
    throw new RiceNoteError(ErrorCode.NOT_FOUND, '要回复的评论不存在', { status: 404 });
  }
  if (parent.status === 'trash' || parent.status === 'spam') {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '无法回复该评论', { status: 400 });
  }

  const depth = await depthOf(db, siteId, parentId, Math.max(1, maxDepth) + 1);
  if (depth > Math.max(1, maxDepth)) {
    throw new RiceNoteError(
      ErrorCode.VALIDATION_FAILED,
      `回复层级已达上限（${maxDepth} 层）`,
      { status: 400 }
    );
  }

  return parent;
}

/** 向上回溯父链计算深度（受 limit 限制，避免脏数据导致死循环）。 */
async function depthOf(
  db: PluginDatabase,
  siteId: string,
  commentId: number,
  limit: number
): Promise<number> {
  let depth = 1;
  let current = commentId;

  while (depth < limit) {
    const row = await findCommentById(db, current);
    if (!row || row.site_id !== siteId || row.parent_id === null) return depth;
    current = Number(row.parent_id);
    depth += 1;
  }

  return depth;
}

/** 同一来源在站点内的加盐哈希（只用于比对，不可还原）。 */
function hashSource(ip: string | undefined, siteId: string): string | null {
  const value = (ip ?? '').trim();
  if (value.length === 0) return null;
  return createHash('sha256').update(`${siteId}|comment|${value}`).digest('hex');
}

/**
 * 归一化作者邮箱。
 *
 * 「要求填写邮箱」关闭时允许留空（存空字符串，前台评论项不输出邮箱字段）；
 * 只要填了就仍然校验格式 —— 可选不等于可以乱填。邮箱会随前台评论项与公开接口交给主题。
 */
function normalizeAuthorEmail(value: string | undefined, required: boolean): string {
  const email = (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (email.length === 0) {
    if (required) {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '邮箱不能为空', { status: 400 });
    }
    return '';
  }
  if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '邮箱格式不正确', { status: 400 });
  }
  return email;
}

function normalizePlain(value: string | undefined, label: string): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `${label}不能为空`, { status: 400 });
  }
  return text;
}

function normalizeOptionalUrl(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  if (text.length === 0) return null;
  if (text.length > URL_MAX || !/^https?:\/\/[^\s]+$/i.test(text)) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '网址必须是 http:// 或 https:// 开头', {
      status: 400
    });
  }
  return text;
}

function truncate(value: string, max: number): string | null {
  const text = value.trim();
  if (text.length === 0) return null;
  return text.slice(0, max);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
