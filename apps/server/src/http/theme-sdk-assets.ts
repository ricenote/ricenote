/**
 * 主题前端运行时（`@ricenote/theme-sdk` 浏览器产物）的静态托管（`/theme-sdk/v1/**`）。
 *
 * 目前这里只有**短代码引擎**一份产物：主题通过模板 helper `shortcode_runtime()`
 * 拿到它的地址，再在前台解析正文里的短代码标记。
 *
 * 与 `/admin-sdk/v1` 同一套规则（见 `static-assets.ts`）：
 * MIME 白名单、路径归一化、产物缺失只告警不崩。路径里的 `/v1/` 是大版本，
 * 因此生产环境可以长缓存；开发期禁止缓存，避免"改了引擎仍是旧行为"。
 *
 * 托管路径前缀由 `@ricenote/shared` 提供：模板 helper 拼接的地址与这里的路由
 * 必须指向同一处，否则会出现"脚本 404、短代码悄悄不生效"这类难查的问题。
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { notFound, SHORTCODE_RUNTIME_PREFIX } from '@ricenote/shared';
import type { RiceNoteKernel } from '@ricenote/core';
import {
  ASSET_MIME_WHITELIST,
  isReadableFile,
  resolveWithinRoot,
  sendAsset
} from './static-assets.js';

/** 引擎产物目录（`packages/theme-sdk/dist/browser`）。 */
export function themeSdkDir(rootDir: string): string {
  return path.resolve(rootDir, 'packages/theme-sdk/dist/browser');
}

/** 托管路径前缀，与模板 helper 拼出的脚本地址一致。 */
export const THEME_SDK_URL_PREFIX = SHORTCODE_RUNTIME_PREFIX;

export function registerThemeSdkAssets(app: FastifyInstance, kernel: RiceNoteKernel): void {
  const root = themeSdkDir(kernel.config.paths.rootDir);

  if (!existsSync(root)) {
    kernel.logger.warn('主题前端运行时产物不存在，已跳过 /theme-sdk 挂载', {
      hint: '执行 pnpm --filter @ricenote/theme-sdk build 后重启服务',
      dir: root
    });
    return;
  }

  app.get(`${THEME_SDK_URL_PREFIX}/*`, (request, reply) => {
    const relative = (request.params as Record<string, string>)['*'] ?? '';

    const resolved = resolveWithinRoot(root, relative);
    if (!resolved) throw notFound('运行时资源路径非法');

    const contentType = ASSET_MIME_WHITELIST[path.extname(resolved).toLowerCase()];
    if (!contentType) throw notFound('运行时资源类型不允许托管');
    if (!isReadableFile(resolved)) throw notFound(`运行时资源不存在：${relative}`);

    const cache = kernel.config.env === 'production' ? 'immutable' : 'no-cache';
    return sendAsset(reply, resolved, { contentType, cache });
  });

  kernel.logger.info('主题前端运行时已挂载', { prefix: THEME_SDK_URL_PREFIX, dir: root });
}
