/**
 * 后台界面 SDK 的静态托管（`/admin-sdk/v1/**`）。
 *
 * 这是"插件自带后台界面"能成立的关键一环：**宿主的后台 SPA 与插件界面
 * 都从这一份产物加载 Vue**，因此浏览器里只有一个模块实例。
 * 若两边各自打包 Vue，会出现"同一页面两个 Vue"——模板不编译、响应式不生效。
 *
 * 缓存：路径里带 `/v1/` 大版本，内容变更靠升版本体现，因此可以 `immutable` 长缓存。
 * 权限：不含任何站点数据（纯框架与组件代码），公开可读；插件界面与后台 SPA 都能取到。
 * 产物缺失：只告警并跳过注册（开发期未构建是常态），不影响服务启动。
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { notFound } from '@ricenote/shared';
import type { RiceNoteKernel } from '@ricenote/core';
import {
  ASSET_MIME_WHITELIST,
  isReadableFile,
  resolveWithinRoot,
  sendAsset
} from './static-assets.js';

/** SDK 产物目录（`packages/admin-sdk/dist/browser`）。 */
export function adminSdkDir(rootDir: string): string {
  return path.resolve(rootDir, 'packages/admin-sdk/dist/browser');
}

/** 托管路径前缀：与 SDK 构建时的 `output.paths`、后台 SPA 的 external 映射一致。 */
export const ADMIN_SDK_URL_PREFIX = '/admin-sdk/v1';

export function registerAdminSdkAssets(app: FastifyInstance, kernel: RiceNoteKernel): void {
  const root = adminSdkDir(kernel.config.paths.rootDir);
  const entry = path.join(root, 'ricenote-admin.js');

  if (!existsSync(entry)) {
    kernel.logger.warn('后台界面 SDK 产物不存在，已跳过 /admin-sdk 挂载', {
      hint: '执行 pnpm --filter @ricenote/admin-sdk build 后重启服务',
      dir: root
    });
    return;
  }

  app.get(`${ADMIN_SDK_URL_PREFIX}/*`, (request, reply) => {
    const relative = (request.params as Record<string, string>)['*'] ?? '';

    const resolved = resolveWithinRoot(root, relative);
    if (!resolved) throw notFound('SDK 资源路径非法');

    const contentType = ASSET_MIME_WHITELIST[path.extname(resolved).toLowerCase()];
    if (!contentType) throw notFound('SDK 资源类型不允许托管');
    if (!isReadableFile(resolved)) throw notFound(`SDK 资源不存在：${relative}`);

    /*
     * 生产用 immutable（路径里带 /v1/ 大版本）；开发期必须禁止缓存，
     * 否则改了 SDK 组件后浏览器仍拿旧产物，表现为"改了没生效"这类难查的问题。
     */
    const cache = kernel.config.env === 'production' ? 'immutable' : 'no-cache';
    return sendAsset(reply, resolved, { contentType, cache });
  });

  kernel.logger.info('后台界面 SDK 已挂载', { prefix: ADMIN_SDK_URL_PREFIX, dir: root });
}
