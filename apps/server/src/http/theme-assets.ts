/**
 * 主题静态资源服务。
 *
 * 路径形如 `/theme-assets/<themeId>/css/style.css?v=1.0.0`。
 * 安全约束：只允许读取主题 `assets/` 目录内的文件，路径归一化后必须仍在该目录下。
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { notFound } from '@ricenote/shared';
import type { RiceNoteKernel } from '@ricenote/core';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * 挂载管理后台 SPA（构建产物位于 apps/admin/dist）。
 *
 * 采用**动态文件解析**而不是注册固定文件清单：
 * 前端每次构建都会产生新的资源指纹文件名，若在启动时枚举文件，
 * 重新构建后未重启服务就会出现 404。动态解析同时天然支持 SPA 前端路由回退。
 *
 * 未构建时静默跳过并给出提示，避免开发期因缺少 dist 而启动失败。
 */
export async function registerAdminSpa(app: FastifyInstance, kernel: RiceNoteKernel): Promise<void> {
  // 必须基于配置中的项目根目录：开发模式下 cwd 可能是包目录 apps/server
  const adminDir = path.resolve(kernel.config.paths.rootDir, 'apps/admin/dist');
  const indexPath = path.join(adminDir, 'index.html');

  if (!existsSync(indexPath)) {
    kernel.logger.warn('管理后台构建产物不存在，已跳过 /admin 挂载', {
      hint: '执行 pnpm --filter @ricenote/admin build 后重启服务',
      dir: adminDir
    });
    return;
  }

  const sendFile = (reply: FastifyReply, filePath: string, immutable: boolean): FastifyReply => {
    reply
      .type(contentTypeOf(filePath))
      .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      .header('x-content-type-options', 'nosniff');
    return reply.send(createReadStream(filePath));
  };

  /** 解析 `/admin` 之下的相对路径，并确保不越出 dist 目录。 */
  const resolveInside = (relative: string): string | undefined => {
    if (!relative) return undefined;
    const root = path.resolve(adminDir);
    const resolved = path.resolve(root, relative);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return undefined;
    if (!existsSync(resolved) || !statSync(resolved).isFile()) return undefined;
    return resolved;
  };

  app.get('/admin', (_request, reply) => sendFile(reply, indexPath, false));
  app.get('/admin/', (_request, reply) => sendFile(reply, indexPath, false));

  // 带指纹的构建产物：长缓存
  app.get('/admin/assets/*', (request, reply) => {
    const relative = `assets/${(request.params as Record<string, string>)['*'] ?? ''}`;
    const filePath = resolveInside(relative);
    if (!filePath) throw notFound('静态资源不存在');
    return sendFile(reply, filePath, true);
  });

  // 其他文件（favicon 等）直接返回；未命中的路径回退到 index.html（SPA 前端路由）
  app.get('/admin/*', (request, reply) => {
    const relative = (request.params as Record<string, string>)['*'] ?? '';
    const filePath = resolveInside(relative);
    return sendFile(reply, filePath ?? indexPath, false);
  });

  kernel.logger.info('管理后台已挂载', { path: '/admin/', dir: adminDir });
}

/** 依据扩展名推断 Content-Type（仅在 SPA 分发场景需要，避免引入额外依赖）。 */
function contentTypeOf(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.map': 'application/json; charset=utf-8'
    }[extension] ?? 'application/octet-stream'
  );
}

export function registerThemeAssets(app: FastifyInstance, kernel: RiceNoteKernel): void {
  app.get('/theme-assets/:themeId/*', async (request, reply) => {
    const params = request.params as { themeId: string; '*': string };
    const themeId = params.themeId;
    const relative = params['*'] ?? '';

    const theme = kernel.themeManager.getTheme(themeId);
    if (!theme) {
      throw notFound(`主题不存在：${themeId}`);
    }

    const assetsRoot = path.resolve(theme.assetsDir);
    const resolved = path.resolve(assetsRoot, relative);

    if (resolved !== assetsRoot && !resolved.startsWith(`${assetsRoot}${path.sep}`)) {
      throw notFound('资源路径非法');
    }
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      throw notFound(`资源不存在：${relative}`);
    }

    const extension = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';

    // 静态资源指纹在 URL 的 ?v= 上，因此可以长缓存
    reply
      .type(contentType)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff');

    return reply.send(createReadStream(resolved));
  });

  // 主题预览图（后台主题卡片使用）
  app.get('/api/admin/themes/:themeId/screenshot', async (request, reply) => {
    const { themeId } = request.params as { themeId: string };
    const screenshot = kernel.themeManager.screenshotOf(themeId);
    if (!screenshot || !existsSync(screenshot)) {
      throw notFound('该主题未提供预览图');
    }
    const extension = path.extname(screenshot).toLowerCase();
    reply
      .type(MIME_TYPES[extension] ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=300');
    return reply.send(createReadStream(screenshot));
  });
}
