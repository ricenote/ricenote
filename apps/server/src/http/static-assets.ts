/**
 * 静态资源托管的共享实现。
 *
 * 后台 SPA（`/admin`）、主题资源（`/theme-assets`）、后台界面 SDK（`/admin-sdk`）
 * 与插件自带界面（`/plugin-admin`）都用同一套规则：
 *
 * 1. **动态解析而不是枚举文件清单**：前端构建会产出带指纹的新文件名，
 *    启动期枚举会导致"重新构建后 404"；动态解析天然支持这一点。
 * 2. **路径归一化后再做包含判断**：`path.resolve` + 前缀比较，
 *    挡住 `../`、绝对路径、盘符与反斜杠等穿越写法。
 * 3. **MIME 由扩展名推断，不信任客户端**，并设置 `nosniff`。
 * 4. **产物缺失只告警不崩**：开发期没构建是常态，服务必须仍能启动。
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyReply } from 'fastify';

/** 通用 MIME 表（主题资源与后台 SPA 使用，未知扩展名回退为二进制流）。 */
export const MIME_TYPES: Record<string, string> = {
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
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

/**
 * 后台界面 SDK 与插件界面允许托管的类型（**白名单，不回退**）。
 *
 * 与上面通用表的区别：这里用于"用户可安装的第三方代码"，
 * 未列出的扩展名一律拒绝，避免把任意文件当作可执行脚本或可渲染内容送出去。
 */
export const ASSET_MIME_WHITELIST: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
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
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

/** 按扩展名推断 Content-Type（未知扩展名回退为二进制流）。 */
export function contentTypeOf(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 把相对路径解析到指定根目录内。
 *
 * @returns 归一化后的绝对路径；越界（穿越到根目录之外）时返回 `undefined`。
 */
export function resolveWithinRoot(root: string, relative: string): string | undefined {
  const base = path.resolve(root);
  const resolved = path.resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return undefined;
  return resolved;
}

/** 判断路径是否为可读取的普通文件（不存在或为目录时返回 false）。 */
export function isReadableFile(filePath: string | undefined): filePath is string {
  return filePath !== undefined && existsSync(filePath) && statSync(filePath).isFile();
}

export interface SendAssetOptions {
  contentType: string;
  /**
   * 缓存策略：
   * - `immutable`：带版本/指纹的资源（SDK 与后台 SPA 产物）；
   * - `no-cache`：不带指纹的资源（插件自带界面，升级后必须立刻生效）；
   * - `{ seconds, private }`：自定义时长（主题资源预览图等）。
   */
  cache: 'immutable' | 'no-cache' | { seconds: number; private?: boolean };
}

function cacheControlOf(cache: SendAssetOptions['cache']): string {
  if (cache === 'immutable') return 'public, max-age=31536000, immutable';
  if (cache === 'no-cache') return 'no-cache';
  return `${cache.private ? 'private' : 'public'}, max-age=${cache.seconds}`;
}

/** 发送静态文件：统一设置 Content-Type、缓存策略与 `nosniff`。 */
export function sendAsset(
  reply: FastifyReply,
  filePath: string,
  options: SendAssetOptions
): FastifyReply {
  return reply
    .type(options.contentType)
    .header('cache-control', cacheControlOf(options.cache))
    .header('x-content-type-options', 'nosniff')
    .send(createReadStream(filePath));
}
