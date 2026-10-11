/**
 * 外观中心 API：主题列表、上传安装、设置读写、预览、激活、回滚。
 *
 * 权限点：`theme.view` / `theme.manage`。
 */

import type { FastifyInstance } from 'fastify';
import {
  ErrorCode,
  RiceNoteError,
  type ThemeSettingValues
} from '@ricenote/shared';
import { validateSettings } from '@ricenote/theme-sdk';
import type { RiceNoteKernel } from '@ricenote/core';
import { guard } from './guard.js';
import type { PreviewStore } from '../preview-store.js';

export interface ThemeRouteDeps {
  previewStore: PreviewStore;
}

export function registerThemeRoutes(
  app: FastifyInstance,
  kernel: RiceNoteKernel,
  deps: ThemeRouteDeps
): void {
  /** 主题列表（含设置分组，后台据此自动生成表单）。 */
  app.get(
    '/themes',
    guard(kernel, { permission: 'theme.view' }, async ({ kernel: k, reply }) => {
      const summaries = await k.themeManager.listSummaries(k.enabledCapabilities());
      return reply.send({ data: summaries, total: summaries.length, page: 1, pageSize: summaries.length });
    })
  );

  /**
   * 上传并安装主题 ZIP。
   * 走 multipart，安全校验在 `extractZipSafely` 中完成。
   */
  app.post(
    '/themes/install',
    guard(kernel, { permission: 'theme.manage' }, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const file = await request.file();
      if (!file) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '未接收到上传文件', { status: 400 });
      }
      if (!/\.zip$/i.test(file.filename)) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '只允许上传 .zip 主题包', { status: 400 });
      }

      const buffer = await file.toBuffer();
      const installed = await k.themeManager.installFromZip(buffer);
      await k.themeManager.sync();
      k.cache.clear();

      await k.audit.record({
        action: 'theme.install',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'theme',
        targetId: installed.themeId,
        ip,
        requestId
      });

      return reply.code(201).send({ data: installed });
    })
  );

  /** 读取某主题的设置（含分组声明与当前生效值）。 */
  app.get(
    '/themes/:themeId/settings',
    guard(kernel, { permission: 'theme.view' }, async ({ kernel: k, request, reply }) => {
      const { themeId } = request.params as { themeId: string };
      const theme = k.themeManager.getTheme(themeId);
      if (!theme) {
        throw new RiceNoteError(ErrorCode.THEME_NOT_FOUND, `主题不存在：${themeId}`, { status: 404 });
      }
      const { values, revision } = await k.themeManager.resolveSettings(theme);
      return reply.send({ data: { themeId, revision, values } });
    })
  );

  /** 保存并发布设置（revision 乐观锁，冲突返回 409）。 */
  app.put(
    '/themes/:themeId/settings',
    guard<{ values: ThemeSettingValues; revision: number }>(
      kernel,
      { permission: 'theme.manage' },
      async ({ kernel: k, request, reply, body, auth, ip, requestId }) => {
        const { themeId } = request.params as { themeId: string };
        const theme = k.themeManager.getTheme(themeId);
        if (!theme) {
          throw new RiceNoteError(ErrorCode.THEME_NOT_FOUND, `主题不存在：${themeId}`, { status: 404 });
        }

        const payload = body ?? { values: {}, revision: 0 };
        const checked = validateSettings(theme.manifest, payload.values ?? {});
        if (!checked.valid) {
          throw new RiceNoteError(ErrorCode.THEME_SETTING_INVALID, '主题设置校验失败', {
            status: 400,
            details: { issues: checked.issues }
          });
        }

        const result = await k.themeManager.settings.publish(
          k.config.site.id,
          themeId,
          checked.normalized,
          Number(payload.revision ?? 0),
          auth.user.id
        );

        k.cache.clear();
        deps.previewStore.revokeByAdmin(auth.user.id);

        await k.audit.record({
          action: 'theme.settings.publish',
          actorId: auth.user.id,
          actorName: auth.user.username,
          targetType: 'theme',
          targetId: themeId,
          ip,
          requestId,
          detail: { revision: result.revision, fields: Object.keys(checked.normalized).length }
        });

        return reply.send({ data: { themeId, revision: result.revision, values: checked.normalized } });
      }
    )
  );

  /** 恢复默认（清空覆盖值，变更草稿后仍以 publish 生效）。 */
  app.post(
    '/themes/:themeId/settings/reset',
    guard(kernel, { permission: 'theme.manage' }, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const { themeId } = request.params as { themeId: string };
      const result = await k.themeManager.settings.reset(k.config.site.id, themeId, auth.user.id);
      k.cache.clear();
      deps.previewStore.revokeByAdmin(auth.user.id);

      await k.audit.record({
        action: 'theme.settings.reset',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'theme',
        targetId: themeId,
        ip,
        requestId,
        detail: { revision: result.revision }
      });

      return reply.send({ data: result });
    })
  );

  /** 设置发布历史。 */
  app.get(
    '/themes/:themeId/settings/history',
    guard(kernel, { permission: 'theme.view' }, async ({ kernel: k, request, reply }) => {
      const { themeId } = request.params as { themeId: string };
      const history = await k.themeManager.settings.history(k.config.site.id, themeId, 30);
      return reply.send({
        data: history.map((entry) => ({
          revision: entry.revision,
          values: entry.values,
          createdAt: entry.createdAt.toISOString(),
          ...(entry.createdBy !== undefined ? { createdBy: entry.createdBy } : {})
        }))
      });
    })
  );

  /** 回滚到指定 revision。 */
  app.post(
    '/themes/:themeId/settings/rollback',
    guard<{ revision: number }>(
      kernel,
      { permission: 'theme.manage' },
      async ({ kernel: k, request, reply, body, auth, ip, requestId }) => {
        const { themeId } = request.params as { themeId: string };
        const target = Number(body?.revision ?? 0);
        if (!Number.isInteger(target) || target <= 0) {
          throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, 'revision 必须为正整数', { status: 400 });
        }

        const result = await k.themeManager.settings.rollback(k.config.site.id, themeId, target, auth.user.id);
        k.cache.clear();

        await k.audit.record({
          action: 'theme.settings.rollback',
          actorId: auth.user.id,
          actorName: auth.user.username,
          targetType: 'theme',
          targetId: themeId,
          ip,
          requestId,
          detail: { from: target, to: result.revision }
        });

        return reply.send({ data: result });
      }
    )
  );

  /**
   * 创建预览令牌。
   * 草稿只存于服务端内存，公众站点永不读取。
   */
  app.post(
    '/themes/:themeId/preview',
    guard<{ values: ThemeSettingValues }>(
      kernel,
      { permission: 'theme.manage' },
      async ({ kernel: k, request, reply, body, auth }) => {
        const { themeId } = request.params as { themeId: string };
        const theme = k.themeManager.getTheme(themeId);
        if (!theme) {
          throw new RiceNoteError(ErrorCode.THEME_NOT_FOUND, `主题不存在：${themeId}`, { status: 404 });
        }

        const checked = validateSettings(theme.manifest, body?.values ?? {});
        if (!checked.valid) {
          throw new RiceNoteError(ErrorCode.THEME_SETTING_INVALID, '预览设置校验失败', {
            status: 400,
            details: { issues: checked.issues }
          });
        }

        const { revision } = await k.themeManager.resolveSettings(theme);
        const created = deps.previewStore.create({
          themeId,
          adminId: auth.user.id,
          baseRevision: revision,
          values: checked.normalized
        });

        return reply.send({
          data: {
            token: created.token,
            url: `/preview/${created.token}`,
            expiresAt: created.expiresAt.toISOString()
          }
        });
      }
    )
  );

  /** 激活主题。 */
  app.post(
    '/themes/:themeId/activate',
    guard(kernel, { permission: 'theme.manage' }, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const { themeId } = request.params as { themeId: string };
      await k.themeManager.activate(themeId, auth.user.id);

      await k.audit.record({
        action: 'theme.activate',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'theme',
        targetId: themeId,
        ip,
        requestId
      });

      return reply.send({ data: { themeId } });
    })
  );

  /** 卸载主题（禁止卸载当前激活主题）。 */
  app.delete(
    '/themes/:themeId',
    guard(kernel, { permission: 'theme.manage' }, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const { themeId } = request.params as { themeId: string };
      await k.themeManager.remove(themeId);
      await k.themeManager.sync();
      k.cache.clear();

      await k.audit.record({
        action: 'theme.remove',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'theme',
        targetId: themeId,
        ip,
        requestId
      });

      return reply.send({ data: { themeId, removed: true } });
    })
  );
}
