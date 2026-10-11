/**
 * 插件自带后台界面的静态托管（`/plugin-admin/:pluginId/**`）。
 *
 * 访问规则（比 SDK 严格，因为它托管的是**第三方代码**）：
 * 1. **必须已登录**：复用管理面守卫（认证 → 权限 fail-closed），插件界面不对外开放；
 * 2. **插件必须处于已启用状态**：禁用后界面立即不可加载（404），
 *    避免"插件已停用但页面还能打开"这种自相矛盾的状态；
 * 3. **路径限定在插件的 `admin/` 目录内**：不使用插件目录整体作为根，
 *    把可暴露面收敛到"界面资源"这一处；
 * 4. **扩展名白名单**：不在白名单内的文件一律 404，不回退成二进制流；
 * 5. **`no-cache`**：插件资源不带指纹（插件一升级就覆盖同名文件），
 *    因此必须每次都回源校验，否则"更新了插件但界面还是旧的"。
 */

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { notFound } from '@ricenote/shared';
import { PLUGIN_ADMIN_URL_PREFIX, type RiceNoteKernel } from '@ricenote/core';
import { guard } from './admin/guard.js';
import {
  ASSET_MIME_WHITELIST,
  isReadableFile,
  resolveWithinRoot,
  sendAsset
} from './static-assets.js';

export function registerPluginAdminAssets(app: FastifyInstance, kernel: RiceNoteKernel): void {
  app.get(
    `${PLUGIN_ADMIN_URL_PREFIX}/:pluginId/*`,
    guard(kernel, {}, async ({ kernel: k, request, reply }) => {
      const params = request.params as Record<string, string>;
      const pluginId = params.pluginId ?? '';
      const relative = params['*'] ?? '';

      // 插件必须存在且已启用：禁用后其界面资源立刻不可取
      const directory = k.plugins.directoryOf(pluginId);
      if (!directory || !k.plugins.isEnabled(pluginId)) {
        throw notFound(`插件未启用或不存在：${pluginId}`);
      }

      const adminRoot = path.resolve(directory, 'admin');
      const resolved = resolveWithinRoot(adminRoot, relative);
      if (!resolved) throw notFound('插件界面资源路径非法');

      const contentType = ASSET_MIME_WHITELIST[path.extname(resolved).toLowerCase()];
      if (!contentType) throw notFound('插件界面资源类型不允许托管');
      if (!isReadableFile(resolved)) throw notFound(`插件界面资源不存在：${relative}`);

      return sendAsset(reply, resolved, { contentType, cache: 'no-cache' });
    })
  );
}
