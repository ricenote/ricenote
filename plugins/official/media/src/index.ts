/**
 * media 插件：文件上传、元数据与公开访问。
 *
 * 安全要点：
 * - 文件名与会话提供的 MIME 类型都不可信，落盘前做扩展名白名单 + 随机化文件名；
 * - 落盘路径必须归一化后仍位于受管 `uploads/` 目录内（防路径穿越）；
 * - 公开访问走 `GET /media/:id`，由数据库中的路径反查，绝不让用户直接拼接路径。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { definePlugin } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  type CoreSetupService,
  type MediaService
} from '@ricenote/shared';
import {
  countMedia,
  deleteMediaById,
  findMediaById,
  insertMedia,
  listMedia,
  toMediaSummary
} from './repository.js';

/** 允许上传的扩展名（与 MIME 白名单配合使用）。 */
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg',
  '.pdf', '.txt', '.md', '.zip'
]);

const EXTENSION_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip'
};

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  return base.slice(0, 120) || 'file';
}

/** 取整并收敛到 [min, max]；非法值回退到 fallback。 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export default definePlugin({
  async start(ctx) {
    const db = ctx.db;
    const setup = ctx.services.use<CoreSetupService>(SERVICE_CONTRACTS.CORE_SETUP);
    const siteId = setup.siteId();
    const { uploadsDir } = setup.paths();
    // 与 manifest.settingsSchema 的范围声明一致；上限兜住 64MB，
    // 避免后台把限制改成一个危险值后仍被静默接受
    const maxFileBytes = clampInt(
      ctx.config.get('maxFileBytes', 8 * 1024 * 1024),
      1024,
      64 * 1024 * 1024,
      8 * 1024 * 1024
    );

    mkdirSync(uploadsDir, { recursive: true });

    const resolveStoredPath = (relative: string): string => {
      const absolute = path.resolve(uploadsDir, relative);
      const root = path.resolve(uploadsDir);
      if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '媒体路径非法', { status: 400 });
      }
      return absolute;
    };

    const service: MediaService = {
      async list(query) {
        const result = await listMedia(db, siteId, query);
        return { items: result.items.map(toMediaSummary), total: result.total };
      },
      async findById(id) {
        const row = await findMediaById(db, id);
        return row ? toMediaSummary(row) : undefined;
      },
      async save(input) {
        const originalName = sanitizeFileName(input.fileName);
        const extension = path.extname(originalName).toLowerCase();

        if (!ALLOWED_EXTENSIONS.has(extension)) {
          throw new RiceNoteError(
            ErrorCode.VALIDATION_FAILED,
            `不允许上传的文件类型：${extension || '(无扩展名)'}`,
            { status: 400 }
          );
        }
        if (input.buffer.byteLength === 0) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '上传文件为空', { status: 400 });
        }
        if (input.buffer.byteLength > maxFileBytes) {
          throw new RiceNoteError(
            ErrorCode.VALIDATION_FAILED,
            `文件超出大小上限（${Math.round(maxFileBytes / 1024 / 1024)}MB）`,
            { status: 413 }
          );
        }

        const now = new Date();
        const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
        const storedName = `${randomBytes(8).toString('hex')}${extension}`;
        const relativePath = path.posix.join(folder, storedName);

        const targetDir = resolveStoredPath(folder);
        mkdirSync(targetDir, { recursive: true });
        const absolutePath = resolveStoredPath(relativePath);
        writeFileSync(absolutePath, input.buffer);

        const id = await insertMedia(db, {
          siteId,
          fileName: originalName,
          storedPath: relativePath,
          mimeType: EXTENSION_MIME[extension] ?? input.mimeType ?? 'application/octet-stream',
          size: input.buffer.byteLength,
          ...(input.alt ? { alt: input.alt } : {}),
          ...(input.uploaderId ? { uploaderId: input.uploaderId } : {})
        });

        ctx.logger.info('媒体已上传', { id, size: input.buffer.byteLength, extension });

        const created = await findMediaById(db, id);
        if (!created) {
          throw new RiceNoteError(ErrorCode.INTERNAL, '媒体写入后读取失败', { status: 500 });
        }
        return toMediaSummary(created);
      },
      async remove(id) {
        const row = await findMediaById(db, id);
        if (!row) {
          throw new RiceNoteError(ErrorCode.NOT_FOUND, `媒体不存在：${id}`, { status: 404 });
        }
        const absolute = resolveStoredPath(row.stored_path);
        if (existsSync(absolute)) {
          rmSync(absolute, { force: true });
        }
        await deleteMediaById(db, id);
        ctx.logger.info('媒体已删除', { id });
      },
      async countAll() {
        return countMedia(db, siteId);
      }
    };

    ctx.services.provide<MediaService>({
      name: SERVICE_CONTRACTS.MEDIA_LIBRARY,
      version: ctx.manifest.version,
      implementation: service
    });

    /* ---------- 公开访问 ---------- */
    ctx.routes.raw({
      method: 'GET',
      path: '/media/:mediaId',
      handler: async (request, reply) => {
        const id = Number(request.params.mediaId);
        if (!Number.isInteger(id) || id <= 0) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '媒体 ID 非法', { status: 400 });
        }

        const row = await findMediaById(db, id);
        if (!row) {
          throw new RiceNoteError(ErrorCode.NOT_FOUND, '媒体不存在', { status: 404 });
        }

        const absolute = resolveStoredPath(row.stored_path);
        if (!existsSync(absolute)) {
          throw new RiceNoteError(ErrorCode.NOT_FOUND, '媒体文件已丢失', { status: 404 });
        }

        const stat = statSync(absolute);
        reply.statusCode = 200;
        reply
          .header('content-type', row.mime_type)
          .header('content-length', String(stat.size))
          .header('cache-control', 'public, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff');

        // SVG 可能内嵌脚本，禁止在同源上下文中以文档方式渲染
        if (row.mime_type === 'image/svg+xml') {
          reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        }

        // SDK 的 send() 接受 string | Buffer（媒体文件有大小上限，整体读入内存是可接受的）
        reply.send(readFileSync(absolute));
      }
    });

    /* ---------- 管理 API ---------- */
    ctx.routes.adminApi({
      method: 'GET',
      path: '/media',
      permission: 'media.manage',
      handler: async (request, reply) => {
        const query = request.query as { page?: string; pageSize?: string; keyword?: string };
        const result = await service.list({
          page: query.page ? Number(query.page) : 1,
          pageSize: query.pageSize ? Number(query.pageSize) : 24,
          ...(query.keyword ? { keyword: query.keyword } : {})
        });
        reply.json({
          data: result.items,
          total: result.total,
          page: query.page ? Number(query.page) : 1,
          pageSize: query.pageSize ? Number(query.pageSize) : 24
        });
      }
    });

    ctx.routes.adminApi({
      method: 'POST',
      path: '/media',
      permission: 'media.manage',
      handler: async (request, reply) => {
        const uploaded = await request.file?.();
        if (!uploaded) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '未接收到上传文件', { status: 400 });
        }

        const created = await service.save({
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
          buffer: uploaded.buffer,
          ...(request.viewer?.user.id ? { uploaderId: request.viewer.user.id } : {})
        });

        reply.statusCode = 201;
        reply.json({ data: created });
      }
    });

    ctx.routes.adminApi({
      method: 'DELETE',
      path: '/media/:mediaId',
      permission: 'media.manage',
      handler: async (request, reply) => {
        const id = Number(request.params.mediaId);
        await service.remove(id);
        reply.json({ data: { id, removed: true } });
      }
    });

    /*
     * 后台菜单与界面来自 manifest.admin.pages（声明式）：
     * Core 负责注册菜单、托管 `admin/main.js` 并计算前端入口 URL，
     * 因此这里不再调用 ctx.adminMenu.add，也不需要 admin:menu 能力。
     */

    ctx.logger.info('media 插件已就绪', { uploadsDir, maxFileBytes });
  },

  async stop(ctx) {
    ctx.logger.info('media 插件已停止');
  }
});
