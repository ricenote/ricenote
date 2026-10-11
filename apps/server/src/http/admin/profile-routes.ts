/**
 * 个人资料写入 API（`PUT /api/admin/me`）。
 *
 * 分工说明：
 * - **读取自己**由 `session-routes.ts` 的 `GET /api/admin/me` 提供：
 *   会话里的 `auth.user` 已由安全网关解析好（含角色与权限），无需再查库；
 * - **写入资料**经 `identity.auth@1` 契约完成，Core 不直接操作 `rn_identity_users`；
 * - **改密与重置密码**（`POST /me/password`、`POST /users/:userId/password`）
 *   由 identity 插件自己注册：密码策略属于身份实现的一部分，
 *   换一个身份实现（如 LDAP 适配插件）时不应被 Core 绑死。
 *
 * 权限模型：本文件只作用于**当前登录者**，因此不额外要求权限点，
 * 但写操作仍受 CSRF 校验（由 guard 统一执行）。
 */

import type { FastifyInstance } from 'fastify';
import {
  ErrorCode,
  RiceNoteError,
  SERVICE_CONTRACTS,
  type IdentityAuthService,
  type ProfileUpdateRequest
} from '@ricenote/shared';
import type { RiceNoteKernel } from '@ricenote/core';
import { guard } from './guard.js';

export function registerProfileRoutes(app: FastifyInstance, kernel: RiceNoteKernel): void {
  /**
   * 修改本人资料（显示名、邮箱）。
   *
   * 只允许改自己的：`userId` 取自会话，请求体中的同名字段会被忽略，
   * 因此不存在"改别人资料"的越权路径。
   */
  app.put(
    '/me',
    guard<ProfileUpdateRequest>(kernel, {}, async ({ kernel: k, reply, body, auth }) => {
      const identity = k.services.tryUse<IdentityAuthService>(SERVICE_CONTRACTS.IDENTITY_AUTH);
      if (!identity) {
        throw new RiceNoteError(
          ErrorCode.SERVICE_NOT_FOUND,
          '身份服务不可用，请确认 identity 插件已启用',
          { status: 503 }
        );
      }

      const payload = body ?? {};
      if (payload.displayName === undefined && payload.email === undefined) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '没有需要更新的字段', { status: 400 });
      }

      const user = await identity.updateProfile({
        userId: auth.user.id,
        ...(payload.displayName === undefined ? {} : { displayName: String(payload.displayName) }),
        ...(payload.email === undefined ? {} : { email: String(payload.email) })
      });

      return reply.send({ data: user });
    })
  );
}
