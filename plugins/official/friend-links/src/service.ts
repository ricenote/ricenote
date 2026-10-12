/**
 * 友链服务：字段收敛、校验与缓存失效。
 *
 * 约定：
 * 1. **前端可见 = 启用**：`listRenderable` 只返回启用项，停用项保留在库里但不出现在前台；
 * 2. **排序由后台数值决定**：`sort_order` 越小越靠前，新建默认追加到末尾；
 * 3. **地址必须自证**：`url` 只能是 `http(s)://` 完整地址；头像允许空、
 *    完整地址或媒体库相对路径（`/uploads/...`、`/media/...`）；
 * 4. **写入即失效缓存**：`/links` 页面是可缓存的 HTML，增删改后按 `friend-links`
 *    标签精确失效，不做全站清缓存（本插件的内容只出现在这一个页面上）。
 */

import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import {
  deleteLink,
  findLinkById,
  insertLink,
  listEnabledLinks,
  listLinks,
  nextSortOrder,
  updateLink,
  type FriendLinkRow
} from './repository.js';
import type {
  FriendLinkRenderItem,
  FriendLinkSaveRequest,
  FriendLinkSummary,
  FriendLinksRuntime
} from './types.js';

/** 页面 HTML 缓存的失效标签，与 `page.ts` 里声明的 `cacheTags` 必须一致。 */
export const FRIEND_LINKS_CACHE_TAG = 'friend-links';

const NAME_MAX = 120;
const URL_MAX = 500;
const AVATAR_MAX = 500;
const DESCRIPTION_MAX = 300;
const SORT_ORDER_MAX = 999999;

export interface FriendLinksServiceDeps {
  runtime: FriendLinksRuntime;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

export interface FriendLinksService {
  /** 前台可见项（仅启用，已按排序）。 */
  listRenderable(): Promise<FriendLinkRenderItem[]>;
  /** 后台列表（含停用）。 */
  listForAdmin(): Promise<FriendLinkSummary[]>;
  save(input: { id?: number; payload: FriendLinkSaveRequest }): Promise<{ id: number }>;
  remove(id: number): Promise<void>;
}

export function createFriendLinksService(deps: FriendLinksServiceDeps): FriendLinksService {
  const { runtime } = deps;
  const { db, siteId } = runtime;

  function invalidate(): void {
    runtime.theme.invalidate([FRIEND_LINKS_CACHE_TAG]);
  }

  return {
    async listRenderable() {
      const rows = await listEnabledLinks(db, siteId);
      return rows.map(toRenderItem);
    },

    async listForAdmin() {
      const rows = await listLinks(db, siteId);
      return rows.map(toSummary);
    },

    async save({ id, payload }) {
      const name = normalizeText(payload.name, NAME_MAX);
      if (name.length === 0) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '请填写友链名称', {
          status: 400,
          details: { field: 'name' }
        });
      }

      const url = normalizeText(payload.url, URL_MAX);
      if (!isHttpUrl(url)) {
        throw new RiceNoteError(
          ErrorCode.VALIDATION_FAILED,
          '友链地址必须是 http:// 或 https:// 开头的完整地址',
          { status: 400, details: { field: 'url' } }
        );
      }

      const avatarUrl = normalizeText(payload.avatarUrl, AVATAR_MAX);
      if (avatarUrl.length > 0 && !isHttpUrl(avatarUrl) && !isMediaPath(avatarUrl)) {
        throw new RiceNoteError(
          ErrorCode.VALIDATION_FAILED,
          '头像可填图片完整地址，或媒体库路径（以 /uploads/ 或 /media/ 开头）',
          { status: 400, details: { field: 'avatarUrl' } }
        );
      }

      const description = normalizeText(payload.description, DESCRIPTION_MAX);
      const enabled = payload.enabled === undefined ? true : toBool(payload.enabled);

      if (id === undefined) {
        const created = await insertLink(db, {
          siteId,
          name,
          url,
          avatarUrl: avatarUrl || null,
          description: description || null,
          sortOrder: resolveSortOrder(payload.sortOrder, await nextSortOrder(db, siteId)),
          enabled
        });
        invalidate();
        deps.log('友链已创建', { friendLinkId: created });
        return { id: created };
      }

      const existing = await findLinkById(db, siteId, id);
      if (!existing) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `友链不存在：${id}`, { status: 404 });
      }

      await updateLink(db, siteId, id, {
        name,
        url,
        avatarUrl: avatarUrl || null,
        description: description || null,
        sortOrder: resolveSortOrder(payload.sortOrder, existing.sort_order),
        enabled
      });
      invalidate();
      deps.log('友链已更新', { friendLinkId: id });
      return { id };
    },

    async remove(id) {
      const removed = await deleteLink(db, siteId, id);
      if (!removed) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `友链不存在：${id}`, { status: 404 });
      }
      invalidate();
      deps.log('友链已删除', { friendLinkId: id });
    }
  };
}

/* ------------------------------ 行 → DTO ------------------------------ */

function toRenderItem(row: FriendLinkRow): FriendLinkRenderItem {
  return {
    name: row.name,
    url: row.url,
    avatarUrl: row.avatar_url ?? '',
    description: row.description ?? ''
  };
}

function toSummary(row: FriendLinkRow): FriendLinkSummary {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    avatarUrl: row.avatar_url ?? '',
    description: row.description ?? '',
    sortOrder: Number(row.sort_order) || 0,
    enabled: toBool(row.enabled),
    updatedAt: toIsoString(row.updated_at)
  };
}

/* ------------------------------ 工具函数 ------------------------------ */

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value === '1' || value === 'true';
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

/** 媒体库相对路径（与设置字段 `image` 的口径一致）。 */
export function isMediaPath(value: string): boolean {
  return /^\/(uploads|media)\/\S*$/.test(value);
}

function resolveSortOrder(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(SORT_ORDER_MAX, Math.max(0, parsed));
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
