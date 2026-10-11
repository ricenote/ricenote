/**
 * 系统分区 API：仪表盘、后台菜单、审计日志、站点设置与能力清单。
 *
 * 仪表盘会**优雅降级**：当内容/用户/媒体插件未启用时，
 * 对应统计返回 0 并在 `missingServices` 中列出缺失契约，
 * 而不是让整个仪表盘请求失败。
 */

import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  type ContentCommentsService,
  type ContentPagesService,
  type ContentPostsService,
  type DashboardStats,
  type IdentityAuthService,
  type MediaService,
  type PluginSummary,
  type RuntimeLogQuery,
  type SiteSettings,
  type SiteSettingsUpdate,
  type SystemStateDto
} from '@ricenote/shared';
import {
  APP_VERSION,
  BackupService,
  LogsReader,
  RESTORE_ZIP_GUARD,
  type RiceNoteKernel
} from '@ricenote/core';
import { MAX_UPLOAD_BYTES } from '../server.js';
import { guard } from './guard.js';

/** 系统维护权限点（日志查看与备份恢复；仅管理员角色通过 `*` 天然具备）。 */
const PERMISSION_MAINTAIN = 'system.maintain';

export function registerSystemRoutes(app: FastifyInstance, kernel: RiceNoteKernel): void {
  const logs = new LogsReader({ logsDir: kernel.config.paths.logsDir });
  const backups = new BackupService({
    config: kernel.config,
    logger: kernel.logger,
    db: kernel.db
  });

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

      // 评论统计：评论插件未启用时整块省略（而非填 0），便于前端区分"没有"与"不可用"
      const comments = k.services.tryUse<ContentCommentsService>(SERVICE_CONTRACTS.CONTENT_COMMENTS);
      const commentCounts = comments ? await comments.countByStatus() : undefined;
      if (!comments) missingServices.push(SERVICE_CONTRACTS.CONTENT_COMMENTS);

      const pages = k.services.tryUse<ContentPagesService>(SERVICE_CONTRACTS.CONTENT_PAGES);
      const pageCounts = pages ? await pages.countByStatus() : undefined;

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
        ...(pageCounts
          ? {
              pages: {
                total: pageCounts.total ?? 0,
                published: pageCounts.published ?? 0,
                draft: pageCounts.draft ?? 0
              }
            }
          : {}),
        users: {
          total: userCount.total ?? 0,
          activeSessions
        },
        media: {
          total: mediaCount.total ?? 0,
          totalSize: mediaCount.totalSize ?? 0
        },
        ...(commentCounts
          ? {
              comments: {
                pending: commentCounts.pending,
                approved: commentCounts.approved,
                total: commentCounts.total
              }
            }
          : {}),
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

  /** 站点信息（`.env` 默认值 + 后台覆盖后的生效值）。 */
  app.get(
    '/site',
    guard(kernel, {}, async ({ kernel: k, reply }) => {
      return reply.send({ data: await readSiteSettings(k) });
    })
  );

  /**
   * 修改站点信息。
   *
   * 与插件设置的差别：站点信息**不需要重启**即可生效
   * （读取路径是 `rn_site_settings` + 内存缓存，渲染与 `ctx.site` 都实时取值），
   * 因此写入后只需失效 HTML 缓存。
   */
  app.put(
    '/site',
    guard<SiteSettingsUpdate>(
      kernel,
      { permission: 'theme.manage' },
      async ({ kernel: k, request, reply, body, auth, ip, requestId }) => {
        const patch = body ?? {};
        const result = await k.site.update(patch, auth.user.id);

        // 站点标题/描述会出现在每个页面上，必须整体清缓存（缓存键也含站点 revision）
        k.cache.clear();

        await k.audit.record({
          action: 'site.settings.update',
          actorId: auth.user.id,
          actorName: auth.user.username,
          targetType: 'site',
          targetId: k.config.site.id,
          ip,
          requestId,
          detail: { revision: result.revision, fields: Object.keys(patch) }
        });

        return reply.send({ data: await readSiteSettings(k) });
      }
    )
  );

  /* ------------------------------ 运行状态与重启 ------------------------------ */

  /**
   * 运行状态：是否存在待生效（需重启）变更。
   *
   * 顶栏的「重启」按钮依赖它；前端在重启后轮询该端点判断服务是否恢复。
   */
  app.get(
    '/system/state',
    guard(kernel, {}, async ({ kernel: k, reply }) => {
      return reply.send({ data: buildSystemState(k) });
    })
  );

  /**
   * 一键重启（进程内软重启，ADR-004 / ADR-012）。
   *
   * 语义：
   * - 先返回 202（受理），随后由 `ServerSupervisor` 关停 HTTP → 关停内核 →
   *   重新 bootstrap → 重新监听同一端口；
   * - 重启期间新请求返回 503 `RN_RESTART_IN_PROGRESS`，前端据此展示"重启中"；
   * - 权限点为 `system.restart`（仅管理员 `*` 天然具备）：重启会短暂中断服务，
   *   不应下放给内容编辑者。
   */
  app.post(
    '/system/restart',
    guard<{ reason?: string }>(
      kernel,
      { permission: 'system.restart' },
      async ({ kernel: k, request, reply, body, auth, ip, requestId }) => {
        const state = k.runtime.state();
        const reason =
          String(body?.reason ?? '').trim() ||
          state.reason ||
          '管理员从后台发起了重启';

        await k.audit.record({
          action: 'system.restart',
          actorId: auth.user.id,
          actorName: auth.user.username,
          targetType: 'system',
          targetId: k.config.site.id,
          ip,
          requestId,
          detail: { reason, pendingReason: state.reason ?? null }
        });

        await k.runtime.requestRestart({ reason, actorId: auth.user.id });

        reply.statusCode = 202;
        return reply.send({
          data: { accepted: true, restarting: true },
          state: buildSystemState(k)
        });
      }
    )
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

  /* ------------------------------ 运行日志 ------------------------------ */

  /**
   * 只读运行日志。
   *
   * 读取策略见 `LogsReader`：只读文件尾部有限窗口，内存占用与文件大小无关；
   * 文件名经过归一化校验，无法越出 logsDir。
   */
  app.get(
    '/logs',
    guard(kernel, { permission: PERMISSION_MAINTAIN }, async ({ request, reply }) => {
      const query = request.query as Record<string, string | undefined>;
      const page = query.page ? Number(query.page) : 1;
      const pageSize = query.pageSize ? Number(query.pageSize) : 20;
      const level =
        !query.level || query.level === 'all'
          ? undefined
          : (query.level as NonNullable<RuntimeLogQuery['level']>);

      const result = logs.query({
        ...(level ? { level } : {}),
        ...(query.file ? { file: query.file } : {}),
        ...(query.keyword ? { keyword: query.keyword } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        page,
        pageSize
      });

      return reply.send({
        data: result.items,
        total: result.total,
        page,
        pageSize,
        files: logs.listFiles(),
        scannedLines: result.scannedLines,
        truncated: result.truncated,
        readFiles: result.files
      });
    })
  );

  /* ------------------------------ 备份与恢复 ------------------------------ */

  /** 历史快照列表。 */
  app.get(
    '/backup/snapshots',
    guard(kernel, { permission: PERMISSION_MAINTAIN }, async ({ reply }) => {
      return reply.send({ data: backups.listSnapshots() });
    })
  );

  /**
   * 导出备份（数据库 + 上传文件 + 插件/主题清单）。
   *
   * 先做工具可用性检查：`mysqldump` 缺失时返回结构化 503，
   * 而不是开始下载后再中断——那只会让用户得到一个损坏的 ZIP。
   */
  app.post(
    '/backup/export',
    guard(kernel, { permission: PERMISSION_MAINTAIN }, async ({ kernel: k, reply, auth, ip, requestId }) => {
      await backups.assertToolsAvailable();

      const filename = `ricenote-backup-${stamp()}.zip`;
      const stream = await backups.exportToStream();

      await k.audit.record({
        action: 'backup.export',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'backup',
        targetId: filename,
        ip,
        requestId
      });

      reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('cache-control', 'no-store');

      return reply.send(stream);
    })
  );

  /**
   * 预览备份包内容（只读，不修改任何数据）。
   *
   * 让管理员在真正恢复前确认"这个包是什么时候、从哪个站点导出的、包含多少插件"。
   */
  app.post(
    '/backup/inspect',
    guard(kernel, { permission: PERMISSION_MAINTAIN }, async ({ request, reply }) => {
      const uploaded = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!uploaded) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '未接收到备份文件', { status: 400 });
      }
      if (!/\.zip$/i.test(uploaded.filename)) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '备份包必须是 .zip 文件', { status: 400 });
      }

      const archive = await uploaded.toBuffer();
      const result = await backups.inspect(archive);
      return reply.send({ data: result });
    })
  );

  /** 从历史快照回滚（恢复前同样会自动生成一份"当前状态快照"）。 */
  app.post(
    '/backup/snapshots/:name/restore',
    guard(
      kernel,
      { permission: PERMISSION_MAINTAIN },
      async ({ kernel: k, request, reply, auth, ip, requestId }) => {
        const { name } = request.params as { name: string };
        const result = await backups.restoreFromSnapshot(name);

        k.cache.clear();
        // 数据库已被整体覆盖：内存中的插件状态/站点信息都必须靠重启重新装载
        await k.site.refresh().catch(() => undefined);
        await k.runtime.markRestartRequired({
          reason: `已从快照 ${name} 恢复数据，重启后生效`,
          actorId: auth.user.id
        });

        await k.audit.record({
          action: 'backup.snapshot.restore',
          actorId: auth.user.id,
          actorName: auth.user.username,
          targetType: 'backup',
          targetId: name,
          ip,
          requestId,
          detail: { autoSnapshot: result.snapshot.name }
        });

        return reply.send({ data: { snapshot: result.snapshot, manifest: result.manifest, restartRequired: true } });
      }
    )
  );

  /** 下载指定快照。 */
  app.get(
    '/backup/snapshots/:name',
    guard(kernel, { permission: PERMISSION_MAINTAIN }, async ({ request, reply }) => {
      const { name } = request.params as { name: string };
      const filePath = backups.resolveSnapshotPath(name);

      reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${path.basename(filePath)}"`)
        .header('cache-control', 'no-store');

      return reply.send(createReadStream(filePath));
    })
  );

  /** 删除指定快照。 */
  app.delete(
    '/backup/snapshots/:name',
    guard(
      kernel,
      { permission: PERMISSION_MAINTAIN },
      async ({ kernel: k, request, reply, auth, ip, requestId }) => {
        const { name } = request.params as { name: string };
        backups.deleteSnapshot(name);

        await k.audit.record({
          action: 'backup.snapshot.delete',
          actorId: auth.user.id,
          actorName: auth.user.username,
          targetType: 'backup',
          targetId: name,
          ip,
          requestId
        });

        return reply.send({ data: { name, deleted: true } });
      }
    )
  );

  /**
   * 上传备份包并恢复。
   *
   * 恢复会先自动生成"当前状态快照"，因此失败也可回滚（ADR-008）。
   * 恢复后内存中的插件状态与主题设置已过期，响应中标记 `restartRequired`。
   */
  app.post(
    '/backup/restore',
    guard(kernel, { permission: PERMISSION_MAINTAIN }, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const uploaded = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!uploaded) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '未接收到备份文件', { status: 400 });
      }
      if (!/\.zip$/i.test(uploaded.filename)) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '备份包必须是 .zip 文件', { status: 400 });
      }

      const archive = await uploaded.toBuffer();
      const result = await backups.restore(archive);

      // 数据库已被覆盖，HTML 缓存必须整体失效
      k.cache.clear();
      await k.site.refresh().catch(() => undefined);
      await k.runtime.markRestartRequired({
        reason: `已从备份包 ${uploaded.filename} 恢复数据，重启后生效`,
        actorId: auth.user.id
      });

      await k.audit.record({
        action: 'backup.restore',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'backup',
        targetId: uploaded.filename,
        ip,
        requestId,
        detail: {
          snapshot: result.snapshot.name,
          backupCreatedAt: result.manifest.createdAt,
          plugins: result.manifest.plugins.length,
          themes: result.manifest.themes.length
        }
      });

      return reply.send({
        data: {
          snapshot: result.snapshot,
          manifest: result.manifest,
          restartRequired: true
        }
      });
    })
  );
}

/** 组装完整的站点设置 DTO（生效值 + 当前激活主题）。 */
async function readSiteSettings(k: RiceNoteKernel): Promise<SiteSettings> {
  const info = k.site.info();
  let activeThemeId = '';
  try {
    activeThemeId = (await k.themeManager.getActive()).manifest.id;
  } catch {
    activeThemeId = '';
  }

  return {
    siteId: info.siteId,
    title: info.title,
    description: info.description,
    url: info.url,
    language: info.language,
    activeThemeId,
    ...(info.logoUrl ? { logoUrl: info.logoUrl } : {}),
    ...(info.faviconUrl ? { faviconUrl: info.faviconUrl } : {}),
    ...(info.icpText ? { icpText: info.icpText } : {}),
    ...(info.icpUrl ? { icpUrl: info.icpUrl } : {}),
    revision: info.revision,
    overridden: info.overridden
  };
}

/** 组装运行状态 DTO。 */
function buildSystemState(k: RiceNoteKernel): SystemStateDto {
  const state = k.runtime.state();
  return {
    restartRequired: state.restartRequired,
    ...(state.reason ? { reason: state.reason } : {}),
    ...(state.requestedAt ? { requestedAt: state.requestedAt } : {}),
    restarting: state.restarting,
    version: APP_VERSION,
    startedAt: k.startedAt
  };
}

/** 生成文件名用的 `YYYYMMDD-HHmmss` 时间戳。 */
function stamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
}
