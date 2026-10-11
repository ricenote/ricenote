/**
 * 扩展中心 API：插件列表、启停、配置与依赖信息。
 *
 * 权限点：`plugin.view` / `plugin.manage`。
 *
 * 注意（ADR-004）：启停写库后需**重启进程**才能让路由变更生效，
 * 因此响应中显式返回 `restartRequired`，由前端提示用户。
 */

import type { FastifyInstance } from 'fastify';
import { ErrorCode, RiceNoteError, type PluginInstallRequest } from '@ricenote/shared';
import {
  PLUGIN_ZIP_GUARD,
  parsePackageSpec,
  validateGitRepo,
  type JobSource,
  type RiceNoteKernel
} from '@ricenote/core';
import { guard } from './guard.js';

/** 上传包在传输层就按插件包上限截断，避免把超大文件读进内存。 */
const MAX_PLUGIN_ARCHIVE_BYTES = PLUGIN_ZIP_GUARD.maxArchiveBytes;

/**
 * 校验并归一化来源描述。
 *
 * 边界校验放在路由层而不是编排层：这样"包名空着""地址类型写错"这类输入问题
 * 会立刻以 400 返回，而不是先进队列再失败 —— 任务日志应该记录真实故障，
 * 而不是给错误输入擦屁股。
 */
function parseInstallSource(input: unknown): JobSource {
  if (!input || typeof input !== 'object' || typeof (input as { type?: unknown }).type !== 'string') {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '缺少安装来源（source）', { status: 400 });
  }

  const raw = input as { type: string; spec?: unknown; repo?: unknown; ref?: unknown; path?: unknown };

  switch (raw.type) {
    case 'registry': {
      const spec = typeof raw.spec === 'string' ? raw.spec.trim() : '';
      if (spec.length === 0) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, 'npm 包名不能为空', { status: 400 });
      }
      // 立即解析包名与版本区间：格式不对就不该占用任务队列
      parsePackageSpec(spec);
      return { type: 'registry', spec };
    }
    case 'git': {
      const repo = typeof raw.repo === 'string' ? raw.repo.trim() : '';
      if (repo.length === 0) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, 'Git 仓库地址不能为空', { status: 400 });
      }
      /*
       * 地址白名单在这里**先查一遍**：解析器（真正执行 git 之前）也会查，
       * 但让 `ext::` / `file://` 这类地址先进队列再失败，管理员要等一轮才知道错在哪。
       * 两道校验是刻意的冗余：安全边界不嫌重复。
       */
      const ref = typeof raw.ref === 'string' ? raw.ref.trim() : '';
      return { type: 'git', repo: validateGitRepo(repo), ref: ref.length > 0 ? ref : 'HEAD' };
    }
    case 'directory': {
      const dir = typeof raw.path === 'string' ? raw.path.trim() : '';
      if (dir.length === 0) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '本地目录路径不能为空', { status: 400 });
      }
      return { type: 'directory', path: dir };
    }
    default:
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `未知的安装来源类型：${raw.type}（支持 registry / git / directory）`,
        { status: 400 }
      );
  }
}

export function registerPluginRoutes(app: FastifyInstance, kernel: RiceNoteKernel): void {
  /** 插件列表 + 诊断信息。 */
  app.get(
    '/plugins',
    guard(kernel, { permission: 'plugin.view' }, async ({ kernel: k, reply }) => {
      const items = k.plugins.summary();
      return reply.send({
        data: items,
        total: items.length,
        page: 1,
        pageSize: items.length,
        diagnostics: {
          invalid: k.plugins.getInvalidPlugins().map((item) => ({
            dir: item.dir,
            id: item.id ?? null,
            issues: item.issues
          })),
          dependencyProblems: k.plugins.getDependencyProblems(),
          coreApiVersion: k.plugins.getCoreApiVersion()
        }
      });
    })
  );

  /** 启用插件。 */
  app.post(
    '/plugins/:pluginId/enable',
    guard(kernel, { permission: 'plugin.manage' }, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const { pluginId } = request.params as { pluginId: string };
      const result = await k.plugins.enable(pluginId);

      await k.runtime.markRestartRequired({
        reason: `插件 ${pluginId} 已启用，重启后路由与服务才会生效`,
        actorId: auth.user.id
      });

      await k.audit.record({
        action: 'plugin.enable',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'plugin',
        targetId: pluginId,
        ip,
        requestId
      });

      return reply.send({ data: { pluginId, enabled: true, restartRequired: result.restartRequired } });
    })
  );

  /** 禁用插件（存在已启用反向依赖时拒绝）。 */
  app.post(
    '/plugins/:pluginId/disable',
    guard(kernel, { permission: 'plugin.manage' }, async ({ kernel: k, request, reply, auth, ip, requestId }) => {
      const { pluginId } = request.params as { pluginId: string };
      const result = await k.plugins.disable(pluginId);

      k.cache.clear();
      await k.runtime.markRestartRequired({
        reason: `插件 ${pluginId} 已禁用，重启后才不会继续提供路由与服务`,
        actorId: auth.user.id
      });

      await k.audit.record({
        action: 'plugin.disable',
        actorId: auth.user.id,
        actorName: auth.user.username,
        targetType: 'plugin',
        targetId: pluginId,
        ip,
        requestId
      });

      return reply.send({ data: { pluginId, enabled: false, restartRequired: result.restartRequired } });
    })
  );

  /**
   * 上传压缩包安装或升级插件包。
   *
   * 安全提示（说明书第 10 章）：插件运行在**同一进程内、没有真实沙箱**，
   * 因此本端点只允许受信任管理员使用，前端必须显示高风险提示。
   * 包体校验复用主题安装的两阶段安全校验实现（`extractZipSafely`）。
   *
   * v0.4.0：压缩包只是「本地目录来源」的一种投放方式（ADR-015），
   * 与 npm / Git 来源共用同一套编排与任务队列，因此这里返回的是**任务**（202），
   * 前端轮询任务日志即可看到解包与校验过程。
   */
  app.post(
    '/plugins/install',
    guard(kernel, { permission: 'plugin.install' }, async ({ kernel: k, request, reply, auth }) => {
      const uploaded = await request.file({ limits: { fileSize: MAX_PLUGIN_ARCHIVE_BYTES } });
      if (!uploaded) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '未接收到插件包文件', { status: 400 });
      }
      if (!/\.zip$/i.test(uploaded.filename)) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '插件包必须是 .zip 文件', { status: 400 });
      }

      const archive = await uploaded.toBuffer();
      const job = await k.installer.submit({
        action: 'install',
        source: { type: 'zip', fileName: uploaded.filename, archive },
        actorId: auth.user.id
      });

      reply.statusCode = 202;
      return reply.send({ data: job });
    })
  );

  /**
   * 按来源安装插件（npm Registry / Git 仓库 / 本地目录）。
   *
   * 三者都交给安装队列串行执行：安装会改磁盘、装依赖、跑构建，
   * 并发执行必然互相踩踏（ADR-015）。
   */
  app.post(
    '/plugins/install/source',
    guard(kernel, { permission: 'plugin.install' }, async ({ kernel: k, request, reply, auth }) => {
      const body = (request.body ?? {}) as Partial<PluginInstallRequest>;
      const source = parseInstallSource(body.source);

      const job = await k.installer.submit({
        action: 'install',
        source,
        actorId: auth.user.id,
        ...(body.allowScripts === undefined ? {} : { allowScripts: body.allowScripts })
      });

      reply.statusCode = 202;
      return reply.send({ data: job });
    })
  );

  /** 更新插件：沿用**已记录的来源**重新解析安装，不需要管理员再填一次。 */
  app.post(
    '/plugins/:pluginId/update',
    guard(kernel, { permission: 'plugin.install' }, async ({ kernel: k, request, reply, auth }) => {
      const pluginId = (request.params as { pluginId: string }).pluginId;
      const summary = k.plugins.summary().find((item) => item.id === pluginId);
      if (!summary) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, `未找到插件：${pluginId}`, { status: 404 });
      }

      const stored = summary.source;
      if (!stored || stored.type === 'local') {
        throw new RiceNoteError(
          ErrorCode.VALIDATION_FAILED,
          stored
            ? '本地目录来源不参与版本管理：请直接更新源目录（开发期改动即生效），或卸载后重新安装。'
            : '该插件没有来源记录（v0.4.0 之前安装），无法自动更新：请卸载后按来源重新安装。',
          { status: 400 }
        );
      }

      const body = (request.body ?? {}) as { allowScripts?: boolean };
      const job = await k.installer.submit({
        action: 'update',
        pluginId,
        source:
          stored.type === 'registry'
            ? { type: 'registry', spec: stored.spec }
            : { type: 'git', repo: stored.spec, ref: stored.ref ?? 'HEAD' },
        actorId: auth.user.id,
        ...(body.allowScripts === undefined ? {} : { allowScripts: body.allowScripts })
      });

      reply.statusCode = 202;
      return reply.send({ data: job });
    })
  );

  /**
   * 卸载插件（删除目录 + 元数据）。
   *
   * 内置插件、以及仍被其他启用插件依赖的插件会被拒绝
   * —— 卸载正在被依赖的插件会让那些插件在下次启动时直接失败。
   */
  app.post(
    '/plugins/:pluginId/remove',
    guard(kernel, { permission: 'plugin.install' }, async ({ kernel: k, request, reply, auth }) => {
      const pluginId = (request.params as { pluginId: string }).pluginId;
      const job = await k.installer.submit({
        action: 'remove',
        pluginId,
        actorId: auth.user.id
      });

      reply.statusCode = 202;
      return reply.send({ data: job });
    })
  );

  /** 检查全部插件的可用更新（只读；本地来源标注为不可检查）。 */
  app.get(
    '/plugins/updates',
    guard(kernel, { permission: 'plugin.view' }, async ({ kernel: k, reply }) => {
      return reply.send({ data: await k.installer.checkUpdates() });
    })
  );

  /** 安装任务列表（最近的在前）与单个任务的日志。 */
  app.get(
    '/plugins/jobs',
    guard(kernel, { permission: 'plugin.view' }, async ({ kernel: k, reply }) => {
      const items = await k.installer.list(20);
      return reply.send({ data: items, total: items.length, page: 1, pageSize: items.length });
    })
  );

  app.get(
    '/plugins/jobs/:jobId',
    guard(kernel, { permission: 'plugin.view' }, async ({ kernel: k, request, reply }) => {
      const job = await k.installer.get((request.params as { jobId: string }).jobId);
      if (!job) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, '未找到该安装任务', { status: 404 });
      }
      return reply.send({ data: job });
    })
  );

  /**
   * 读取插件配置（含声明式表单定义）。
   *
   * 返回 `groups` 供后台自动生成表单；`declarative` 为 false 表示该插件
   * 未声明 `settingsSchema`，前端应退化为键值编辑。
   */
  app.get(
    '/plugins/:pluginId/settings',
    guard(kernel, { permission: 'plugin.view' }, async ({ kernel: k, request, reply }) => {
      const { pluginId } = request.params as { pluginId: string };
      const dto = await k.plugins.settingsDto(pluginId);
      return reply.send({ data: dto });
    })
  );

  /**
   * 保存插件配置。
   *
   * 保存成功后**标记待重启**：`ctx.config` 是插件启动期快照（ADR-004），
   * 只有重启后插件才会重新读取配置，因此顶栏会出现重启按钮。
   */
  app.put(
    '/plugins/:pluginId/settings',
    guard<{ values: Record<string, unknown> }>(
      kernel,
      { permission: 'plugin.manage' },
      async ({ kernel: k, request, reply, body, auth, ip, requestId }) => {
        const { pluginId } = request.params as { pluginId: string };
        const dto = await k.plugins.settingsDto(pluginId);
        const values = body?.values ?? {};
        const result = await k.plugins.writeSettings(pluginId, k.config.site.id, values);

        const reason = `插件「${dto.name}」的设置已保存，重启后生效`;
        await k.runtime.markRestartRequired({ reason, actorId: auth.user.id });

        await k.audit.record({
          action: 'plugin.settings.update',
          actorId: auth.user.id,
          actorName: auth.user.username,
          targetType: 'plugin',
          targetId: pluginId,
          ip,
          requestId,
          detail: { revision: result.revision, fields: Object.keys(values).length }
        });

        return reply.send({
          data: { ...(await k.plugins.settingsDto(pluginId)), restartRequired: true },
          message: reason
        });
      }
    )
  );
}
