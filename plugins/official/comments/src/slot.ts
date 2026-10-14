/**
 * `post.comments` Slot：把评论区注入文章页。
 *
 * 主题只需写 `{{ slot('post.comments', { post: post }) }}`，
 * 插件被禁用时该插槽自动为空，主题无需任何改动（说明书 7.7）。
 *
 * 输出的所有动态文本都经过转义；评论正文由 service 层统一转义后再拼进 HTML。
 */

import type { SlotComponent } from '@ricenote/plugin-sdk';
import type { CommentThreadItem } from '@ricenote/shared';
import type { CommentsRuntime } from './service.js';

export interface CommentsSlotDeps {
  runtime: CommentsRuntime;
  /** 读取线程（复用服务实现，保证 Slot 与 REST 的口径一致）。 */
  buildThread(postId: number, page: number, pageSize: number): Promise<{
    items: CommentThreadItem[];
    total: number;
    totalApproved: number;
  }>;
}

export function createCommentsSlot(deps: CommentsSlotDeps): SlotComponent {
  const { runtime } = deps;
  const escape = runtime.html.escape;

  return {
    // 优先级由注册处传入（slots.register 的第三个参数），组件自身不声明
    name: 'comments.thread',
    async render(context) {
      if (!runtime.settings.enabled) return '';

      // 主题可传 `post`（推荐）或 `postId`；两者都能取到文章标识
      const post = context.data.post as { id?: number; slug?: string; url?: string } | undefined;
      const postId = Number(post?.id ?? context.data.postId);
      if (!Number.isInteger(postId) || postId <= 0) return '';

      // 评论分页走文章页的 `?commentPage=N`：Slot 自己读查询参数，
      // 因此无需 posts 插件配合改动页面处理器。
      const page = parsePage(context.request?.query.commentPage);
      const postUrl = post?.url ?? (post?.slug ? `/post/${post.slug}` : `/post/${postId}`);
      const pageSize = runtime.settings.pageSize;
      const thread = await deps.buildThread(postId, page, pageSize);

      const items = thread.items.map((item) => renderItem(item, escape, 1)).join('\n');

      const empty =
        thread.totalApproved === 0
          ? '<p class="rn-comments__empty">还没有评论，来说点什么吧。</p>'
          : '';

      const pager = renderPager(thread.total, page, pageSize, postUrl);
      const notice = renderNotice(context.request?.query.comment, escape);

      // 标题与外层容器由主题提供（标准 Slot 约定：插件只负责"区块内容"），
      // 因此这里不再输出 <section>/<h2>，只输出提示、计数、列表、分页与表单。
      return `
<div class="rn-comments__body" id="comments" data-rn-comments>
  ${notice}
  <p class="rn-comments__meta">共 ${thread.totalApproved} 条评论${
    thread.total > 0 && thread.total !== thread.totalApproved ? `（${thread.total} 个主帖）` : ''
  }</p>
  ${empty}
  <ol class="rn-comments__list">
${items}
  </ol>
  ${pager}
  ${renderForm(postId, runtime.settings.requireApproval, runtime.settings.requireEmail, escape)}
</div>`.trim();
    }
  };
}

/**
 * 无 JS 提交后的结果提示（由 `/comments/submit` 重定向携带的 `?comment=` 驱动）。
 *
 * 有 JS 时表单会被脚本拦截，因此这里通常是空字符串。
 */
function renderNotice(flag: unknown, escape: (text: string) => string): string {
  const value = String(Array.isArray(flag) ? flag[0] : (flag ?? ''));
  const messages: Record<string, string> = {
    pending: '评论已提交，审核通过后将会公开显示。',
    published: '评论已发布，感谢参与讨论。',
    accepted: '评论已提交。',
    error: '评论提交失败，请检查填写内容后重试。'
  };

  const message = messages[value];
  if (!message) return '';

  const tone = value === 'error' ? 'is-error' : 'is-ok';
  return `<p class="rn-comments__message ${tone}" role="status">${escape(message)}</p>`;
}

function renderItem(item: CommentThreadItem, escape: (text: string) => string, depth: number): string {
  const name = item.authorUrl
    ? `<a class="rn-comment__author" href="${escape(item.authorUrl)}" target="_blank" rel="noopener noreferrer nofollow">${escape(item.authorName)}</a>`
    : `<span class="rn-comment__author">${escape(item.authorName)}</span>`;

  const children =
    item.children.length > 0
      ? `<ol class="rn-comments__children">
${item.children.map((child) => renderItem(child, escape, depth + 1)).join('\n')}
      </ol>`
      : '';

  // 邮箱开放给主题：主题脚本可读它自行取头像（访客没填时不输出该属性）
  const emailAttr = item.authorEmail ? ` data-rn-author-email="${escape(item.authorEmail)}"` : '';

  return `    <li class="rn-comment" id="comment-${item.id}" data-depth="${depth}"${emailAttr}>
      <div class="rn-comment__meta">
        ${name}
        <time class="rn-comment__time" datetime="${escape(item.createdAt)}">${formatTime(item.createdAt)}</time>
      </div>
      <div class="rn-comment__body">${item.html}</div>
      <div class="rn-comment__actions">
        <button type="button" class="rn-comment__reply" data-rn-reply data-comment-id="${item.id}" data-author="${escape(item.authorName)}">回复</button>
      </div>
${children}
    </li>`;
}

function renderPager(total: number, page: number, pageSize: number, postUrl: string): string {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return '';

  const base = postUrl.split('#')[0] ?? postUrl;
  const links: string[] = [];
  for (let index = 1; index <= totalPages; index += 1) {
    const active = index === page ? ' rn-pager__link--active' : '';
    const href = index === 1 ? `${base}#comments` : `${base}?commentPage=${index}#comments`;
    links.push(`<a class="rn-pager__link${active}" href="${href}">${index}</a>`);
  }

  return `<nav class="rn-comments__pager" aria-label="评论分页">${links.join('')}</nav>`;
}

function parsePage(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(1000, Math.trunc(value));
}

/**
 * 提交表单。
 *
 * - 表单通过主题脚本以 JSON POST 到 `/api/comments`，无需页面刷新即可获得结果；
 * - `website` 是蜜罐字段（视觉隐藏 + `tabindex="-1"`），被填写即静默丢弃；
 * - 待审模式下按钮文案与提示会明确告知"先审后发"，避免用户以为提交失败；
 * - 邮箱是否必填跟随设置：关闭「要求填写邮箱」后不再加 `required`，标签标注「（可选）」。
 */
function renderForm(
  postId: number,
  requireApproval: boolean,
  requireEmail: boolean,
  escape: (text: string) => string
): string {
  const hint = requireApproval ? '评论提交后需经审核通过才会公开显示。' : '评论提交后将立即公开显示。';

  // `action`/`method` 保证无 JavaScript 时也能提交（服务端会重定向回文章页并带上结果参数）
  return `<form class="rn-comments__form" data-rn-comment-form data-post-id="${postId}" action="/comments/submit" method="post">
    <h3 class="rn-comments__form-title">发表评论</h3>
    <input type="hidden" name="parentId" value="" data-rn-parent-id>
    <p class="rn-comments__replying" data-rn-replying hidden>
      <span data-rn-replying-text></span>
      <button type="button" class="rn-comment__reply" data-rn-cancel-reply>取消回复</button>
    </p>
    <div class="rn-comments__fields">
      <label class="rn-field">
        <span class="rn-field__label">昵称</span>
        <input class="rn-field__input" type="text" name="authorName" required maxlength="80" autocomplete="nickname">
      </label>
      <label class="rn-field">
        <span class="rn-field__label">邮箱${requireEmail ? '' : '（可选）'}</span>
        <input class="rn-field__input" type="email" name="authorEmail"${requireEmail ? ' required' : ''} maxlength="160" autocomplete="email">
      </label>
      <label class="rn-field">
        <span class="rn-field__label">网址（可选）</span>
        <input class="rn-field__input" type="url" name="authorUrl" maxlength="300" placeholder="https://">
      </label>
    </div>
    <label class="rn-field">
      <span class="rn-field__label">内容</span>
      <textarea class="rn-field__input rn-field__textarea" name="content" rows="5" required maxlength="2000"></textarea>
    </label>
    <label class="rn-field rn-field--honeypot" aria-hidden="true">
      <span class="rn-field__label">网址（请勿填写）</span>
      <input class="rn-field__input" type="text" name="website" tabindex="-1" autocomplete="off">
    </label>
    <div class="rn-comments__form-footer">
      <p class="rn-comments__hint">${escape(hint)}</p>
      <button type="submit" class="rn-comments__submit">提交评论</button>
    </div>
    <p class="rn-comments__message" data-rn-comment-message role="status" hidden></p>
  </form>`;
}

/** ISO 时间 → `YYYY-MM-DD HH:mm`（以服务端本地时区展示）。 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
