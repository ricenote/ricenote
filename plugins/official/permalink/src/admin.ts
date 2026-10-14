/**
 * permalink 插件的管理 API。
 *
 * 权限点：`permalink.view`（读取）/ `permalink.manage`（写入）。
 * 路由前缀 `/api/admin/permalink`，由 Core 的守卫统一执行
 * 认证 → CSRF → 权限 → 审计（见 apps/server 的 guard）。
 *
 * 这里只做三件事：列出方案、校验并保存模板、给后台页面算一条预览地址。
 * 真正让设置生效的是"重启后插件启动末段重新编译并接管路径"。
 */

import type { PluginDatabase, PluginLogger } from '@ricenote/plugin-sdk';
import {
  ErrorCode,
  RiceNoteError,
  type PermalinkSchemeDeclaration,
  type PermalinkTokenDeclaration
} from '@ricenote/shared';
import type { PluginContext } from '@ricenote/plugin-sdk';
import { saveTemplates } from './repository.js';
import { previewScheme, validateSchemeTemplate } from './scheme.js';

export interface PermalinkAdminDeps {
  siteId: string;
  db: PluginDatabase;
  logger: PluginLogger;
  /** 当前生效的方案（含第三方贡献），用于列表与校验。 */
  declarations(): { schemes: PermalinkSchemeDeclaration[]; tokens: PermalinkTokenDeclaration[] };
  /** 当前生效的模板（未配置的方案回落到默认模板）。 */
  templates(): Map<string, string>;
  /** 标记"需重启生效"。 */
  markRestartRequired(reason: string, actorId?: number): Promise<void>;
}

interface SchemeDto {
  id: string;
  label: string;
  routeName: string;
  template: string;
  defaultTemplate: string;
  presets: { label: string; template: string }[];
  tokens: { name: string; label: string; description?: string; source?: string }[];
  /** 是否已被后台显式配置（区别于使用默认模板）。 */
  configured: boolean;
  sample: Record<string, string | number>;
}

export function registerAdminRoutes(ctx: PluginContext, deps: PermalinkAdminDeps): void {
  ctx.routes.adminApi({
    method: 'GET',
    path: '/permalink/settings',
    permission: 'permalink.view',
    handler: async (_request, reply) => {
      reply.json({ data: { schemes: listSchemes(deps) } });
    }
  });

  ctx.routes.adminApi({
    method: 'PUT',
    path: '/permalink/settings',
    permission: 'permalink.manage',
    handler: async (request, reply) => {
      const body = (request.body ?? {}) as { templates?: unknown };
      const templates = readTemplates(body.templates);

      const { schemes, tokens } = deps.declarations();
      const byId = new Map(schemes.map((scheme) => [scheme.id, scheme]));
      const issues: { path: string; message: string }[] = [];

      for (const [schemeId, template] of Object.entries(templates)) {
        const declaration = byId.get(schemeId);
        if (!declaration) {
          issues.push({ path: `/${schemeId}`, message: '未知的路径方案' });
          continue;
        }
        const checked = validateSchemeTemplate(declaration, tokens, template);
        for (const issue of checked.issues) issues.push(issue);
      }

      if (issues.length > 0) {
        throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '固定链接设置校验失败', {
          status: 400,
          details: { issues }
        });
      }

      const actorId = request.viewer?.user.id;
      await saveTemplates(deps.db, { siteId: deps.siteId, templates, ...(actorId ? { actorId } : {}) });
      await deps.markRestartRequired('固定链接设置已保存', actorId);

      deps.logger.info('固定链接设置已保存（重启后生效）', { schemes: Object.keys(templates) });

      reply.json({ data: { schemes: listSchemes(deps), restartRequired: true } });
    }
  });

  ctx.routes.adminApi({
    method: 'POST',
    path: '/permalink/preview',
    permission: 'permalink.view',
    handler: async (request, reply) => {
      const body = (request.body ?? {}) as { schemeId?: unknown; template?: unknown };
      const schemeId = typeof body.schemeId === 'string' ? body.schemeId : '';
      const template = typeof body.template === 'string' ? body.template : '';

      const { schemes, tokens } = deps.declarations();
      const declaration = schemes.find((scheme) => scheme.id === schemeId);
      if (!declaration) {
        throw new RiceNoteError(ErrorCode.NOT_FOUND, '未知的路径方案', {
          status: 404,
          details: { schemeId }
        });
      }

      reply.json({ data: previewScheme({ declaration, tokens, template }) });
    }
  });
}

/** 组装后台所需的方案视图（含预览示例取值与"是否已配置"）。 */
function listSchemes(deps: PermalinkAdminDeps): SchemeDto[] {
  const stored = deps.templates();
  const { schemes, tokens } = deps.declarations();

  return schemes.map((declaration) => {
    const own = declaration.tokens.map((token) => ({
      name: token.name,
      label: token.label,
      ...(token.description ? { description: token.description } : {})
    }));
    const ownNames = new Set(own.map((token) => token.name));
    const contributed = tokens
      .filter(
        (token) =>
          !ownNames.has(token.token) &&
          (!token.schemes || token.schemes.includes(declaration.id))
      )
      .map((token) => ({
        name: token.token,
        label: token.label,
        ...(token.description ? { description: token.description } : {}),
        source: token.source ?? '第三方插件'
      }));

    return {
      id: declaration.id,
      label: declaration.label,
      routeName: declaration.routeName,
      template: stored.get(declaration.id) ?? declaration.defaultTemplate,
      defaultTemplate: declaration.defaultTemplate,
      presets: (declaration.presets ?? []).map((preset) => ({ ...preset })),
      tokens: [...own, ...contributed],
      configured: stored.has(declaration.id),
      sample: { ...declaration.sample }
    } satisfies SchemeDto;
  });
}

/** 读取模板补丁：只接受「字符串 → 字符串」的扁平映射。 */
function readTemplates(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '设置内容格式不正确', { status: 400 });
  }

  const templates: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `「${key}」的值必须是字符串`, {
        status: 400
      });
    }
    templates[key] = value;
  }
  return templates;
}
