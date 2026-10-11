/**
 * 系统分区 API：仪表盘、后台菜单、审计日志、站点设置与能力清单。
 *
 * 仪表盘会**优雅降级**：当内容/用户/媒体插件未启用时，
 * 对应统计返回 0 并在 `missingServices` 中列出缺失契约，
 * 而不是让整个仪表盘请求失败。
 */

import type { FastifyInstance } from 'fastify';
import {
  SERVICE_CONTRACTS,
  type ContentPostsService,
  type DashboardStats,
  type IdentityAuthService,
  type MediaService,
  type PluginSummary,
  type SiteSettings
} from '@ricenote/shared';
import type { RiceNoteKernel } from '@ricenote/core';
import { guard } from './guard.js';

export function registerSystemRoutes(app: FastifyInstance, kernel: RiceNoteKernel): void {
  /** 仪表盘统计。 */
  app.get(
    '/dashboard',
    guard(kernel, {}, async ({ kernel: k, reply }) => {
      const missingServices: string[] = [];

      const posts = k.services.tryUse<ContentPostsService>(SERVICE_CONTRACTS.CONTENT_POSTS);
      if (!posts) missingServices.push(SERVICE_CONTRACTS.CONTENT_POSTS);

      const identity = k.services.tryUse<IdentityAuthService>(SERVICE_CONTRACTS.IDENTITY_AUTH);
      if (!identity) missingServices.push(SERVICE_CONTRACTS.IDENTITY_AUTH);

      const media = k.services.tryUse<MediaService>(SERVICE_CONTRACTS.MEDIA_LIBRARY);
      if (!media) missingServices.push(SERVICE_CONTRACTS.MEDIA_LIBRARY);

      const health = await k.health();
      const plugins: PluginSummary[] = k.plugins.summary();

      const postCounts = posts
        ? await posts.countByStatus()
        : { total: 0, published: 0, draft: 0, archived: 0 };
      const userCount = identity ? await identity.countUsers() : { total: 0 };
      const activeSessions = identity ? await identity.countActiveSessions() : 0;
      const mediaCount = media ? await media.countAll() : { total: 0, totalSize: 0 };
      const recentPosts = posts ? await posts.recent(5) : [];

      const stats: DashboardStats = {
        site: {
          version: health.version,
          themeId: health.theme?.id ?? '',
          themeName: health.theme?.id ?? '',
          pluginCount: plugins.length,
          failedPluginCount: plugins.filter((item) => item.state === 'FAILED').length,
          uptimeSeconds: health.uptimeSeconds,
          nodeVersion: health.node
        },
        content: {
          total: postCounts.total ?? 0,
          published: postCounts.published ?? 0,
          draft: postCounts.draft ?? 0
        },
        users: {
          total: userCount.total ?? 0,
          activeSessions
        },
        media: {
          total: mediaCount.total ?? 0,
          totalSize: mediaCount.totalSize ?? 0
        },
        recentPosts,
        plugins
      };

      return reply.send({ data: stats, missingServices });
    })
  );

  /** 后台导航菜单（由插件贡献，按当前用户权限过滤）。 */
  app.get(
    '/menu',
    guard(kernel, {}, async ({ kernel: k, reply, auth }) => {
      const user = await k.gateway.describeUser(auth);
      const items = k.adminMenu.list(user.permissions.includes('*') ? undefined : user.permissions);
      return reply.send({ data: items });
    })
  );

  /** 站点信息。 */
  app.get(
    '/site',
    guard(kernel, {}, async ({ kernel: k, reply }) => {
      const active = await k.themeManager.getActive();
      const payload: SiteSettings = {
        siteId: k.config.site.id,
        title: k.config.site.title,
        description: k.config.site.description,
        url: k.config.http.siteUrl,
        language: k.config.site.language,
        activeThemeId: active.manifest.id
      };
      return reply.send({ data: payload });
    })
  );

  /** 审计日志。 */
  app.get(
    '/audit',
    guard(kernel, { permission: 'system.audit' }, async ({ kernel: k, request, reply }) => {
      const query = request.query as { action?: string; page?: string; pageSize?: string };
      const result = await k.audit.list({
        ...(query.action ? { action: query.action } : {}),
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : 20
      });
      return reply.send({
        data: result.items,
        total: result.total,
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : 20
      });
    })
  );

  /** 能力清单与诊断（排障用）。 */
  app.get(
    '/capabilities',
    guard(kernel, { permission: 'plugin.view' }, async ({ kernel: k, reply }) => {
      return reply.send({
        data: {
          capabilities: k.enabledCapabilities(),
          services: k.services.list(),
          events: k.events.list(),
          slots: k.slots.list(),
          routes: {
            pages: k.router.pages().map((page) => ({ name: page.name, path: page.path, plugin: page.pluginId })),
            admin: k.router.adminRoutesList().map((route) => ({
              method: route.method,
              path: `/api/admin${route.path}`,
              plugin: route.pluginId,
              permission: route.permission ?? null
            })),
            raw: k.router.rawRoutesList().map((route) => ({
              method: route.method,
              path: route.path,
              plugin: route.pluginId,
              capability: route.capability
            }))
          },
          health: await k.health()
        }
      });
    })
  );
}
