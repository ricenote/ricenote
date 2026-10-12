/**
 * 内容自定义字段下发：当前启用主题声明了哪些字段。
 *
 * 为什么由 Core 提供而不是两个内容插件各发一个：
 * 字段声明的来源是**主题**（`theme.json → contentFields`），文章与页面共用同一份。
 * 各插件自己实现就会有两份解析与两份文案本地化，换主题后必然出现不一致。
 *
 * 权限：仅需登录 —— 这里只回"字段元数据"（名称/类型/选项），不含任何内容数据；
 * 真正的读写仍由各内容插件按自己的权限点（post.write / page.manage）把关。
 */

import type { FastifyInstance } from 'fastify';
import { resolveContentFields, type RiceNoteKernel } from '@ricenote/core';
import { guard } from './guard.js';

export function registerContentFieldRoutes(app: FastifyInstance, kernel: RiceNoteKernel): void {
  app.get(
    '/content-fields',
    guard(kernel, {}, async ({ kernel: k, reply }) => {
      const theme = await k.themeManager.getActive();
      const fields = resolveContentFields(theme.manifest.contentFields, k.config.site.language);

      return reply.send({
        data: {
          themeId: theme.manifest.id,
          fields
        }
      });
    })
  );
}
