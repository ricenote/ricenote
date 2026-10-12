/**
 * 友情链接插件的 DTO 与运行时容器。
 *
 * 本插件**不提供任何跨插件服务契约**（友链只给主题用，而主题通过页面 `data` 取数），
 * 因此这些类型留在插件内，不进 `@ricenote/shared`。
 */

import type { PluginDatabase, PluginLogger } from '@ricenote/plugin-sdk';
import type { CoreThemeService } from '@ricenote/shared';

/** 前台 `/links` 页面交给主题的一条友链（即 `data.friendLinks` 的元素）。 */
export interface FriendLinkRenderItem {
  name: string;
  /** 已校验为 `http(s)://` 的完整地址。 */
  url: string;
  /** 头像地址；未填写时为空串，由主题自行决定是否回退占位图。 */
  avatarUrl: string;
  /** 描述；未填写时为空串。 */
  description: string;
}

/** 后台列表里的一条友链（含停用项）。 */
export interface FriendLinkSummary {
  id: number;
  name: string;
  url: string;
  avatarUrl: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  updatedAt: string;
}

/** 保存请求（新建与更新共用；未提供的字段沿用原值或默认值）。 */
export interface FriendLinkSaveRequest {
  name?: string;
  url?: string;
  avatarUrl?: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
}

export interface FriendLinksRuntime {
  db: PluginDatabase;
  siteId: string;
  /** `core.theme@1`：友链变化时精确失效 `/links` 页面的 HTML 缓存。 */
  theme: CoreThemeService;
  logger: PluginLogger;
}
