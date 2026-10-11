/**
 * 插件自带后台界面的声明解析与菜单注册。
 *
 * 插件在 `manifest.json` 里声明 `admin.pages`（每页：id / label / path / icon / order /
 * permission / entry），Core 负责：
 *
 * 1. **校验**：`entry` 必须真实存在于插件目录内（否则界面永远打不开，
 *    与其等到用户点进去才发现，不如启动时就报错日志）；
 * 2. **注册菜单**：与插件 `start()` 中调用 `ctx.adminMenu.add` 等价，
 *    但不需要插件写任何注册代码（声明式）；
 * 3. **计算托管 URL**：前端不该参与路径拼接，避免两边算法漂移。
 *
 * 生命周期：菜单项随插件一起注册、随插件停止一起注销（disposer 交给
 * PluginManager 统一回收），因此"禁用插件 = 入口消失"是天然成立的。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AdminMenuItem, Dispose } from '@ricenote/plugin-sdk';
import { ErrorCode, RiceNoteError, type PluginAdminPageDeclaration } from '@ricenote/shared';
import type { Logger } from '../logger.js';
import type { AdminMenuRegistry } from './admin-menu.js';
import type { LoadedPlugin } from './manifest.js';

/** 插件自带界面的托管路径前缀（与 apps/server 的托管路由一致）。 */
export const PLUGIN_ADMIN_URL_PREFIX = '/plugin-admin';

/** 已解析的页面声明：补上插件 ID 与托管 URL。 */
export interface ResolvedAdminPage extends PluginAdminPageDeclaration {
  pluginId: string;
  /** 前端可直接 `import()` 的入口 URL。 */
  entryUrl: string;
  /** 入口模块的绝对路径（校验与诊断用）。 */
  entryPath: string;
  /** 样式的托管 URL（仅在清单声明了 `style` 时存在）。 */
  styleUrl?: string;
  /** 样式文件的绝对路径（仅声明时存在）。 */
  stylePath?: string;
}

const PAGE_ID_PATTERN = /^[a-z][a-z0-9._-]{1,80}$/;

/**
 * 把插件声明的入口换算为托管 URL。
 *
 * 约定：托管路由的根是插件的 `admin/` 目录，因此 URL 里去掉 `./admin/` 前缀
 * （`./admin/main.js` → `/plugin-admin/<pluginId>/main.js`）。
 */
export function pluginAdminEntryUrl(pluginId: string, entry: string): string {
  const relative = entry.replace(/^\.\//, '').replace(/^admin\//, '');
  return `${PLUGIN_ADMIN_URL_PREFIX}/${pluginId}/${relative}`;
}

/**
 * 解析插件声明的后台页面。
 *
 * 结构合法性由 JSON Schema 保证；这里补的是"跨文件/跨插件"的校验：
 * 页面 ID 唯一、路径唯一、入口文件存在。
 */
export function resolveAdminPages(plugin: LoadedPlugin): ResolvedAdminPage[] {
  const declarations = plugin.manifest.admin?.pages ?? [];
  const pages: ResolvedAdminPage[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  for (const declaration of declarations) {
    if (!PAGE_ID_PATTERN.test(declaration.id)) {
      throw new RiceNoteError(
        ErrorCode.MANIFEST_INVALID,
        `插件 ${plugin.manifest.id} 的后台页面 ID 非法：${declaration.id}`,
        { status: 500, details: { path: '/admin/pages/id' } }
      );
    }
    if (!declaration.path.startsWith('/')) {
      throw new RiceNoteError(
        ErrorCode.MANIFEST_INVALID,
        `插件 ${plugin.manifest.id} 的后台页面路径必须以 / 开头：${declaration.path}`,
        { status: 500, details: { path: '/admin/pages/path' } }
      );
    }
    if (seenIds.has(declaration.id)) {
      throw new RiceNoteError(
        ErrorCode.MANIFEST_INVALID,
        `插件 ${plugin.manifest.id} 的后台页面 ID 重复：${declaration.id}`,
        { status: 500 }
      );
    }
    if (seenPaths.has(declaration.path)) {
      throw new RiceNoteError(
        ErrorCode.MANIFEST_INVALID,
        `插件 ${plugin.manifest.id} 的后台页面路径重复：${declaration.path}`,
        { status: 500 }
      );
    }
    seenIds.add(declaration.id);
    seenPaths.add(declaration.path);

    pages.push({
      ...declaration,
      pluginId: plugin.manifest.id,
      entryUrl: pluginAdminEntryUrl(plugin.manifest.id, declaration.entry),
      entryPath: path.resolve(plugin.dir, declaration.entry),
      ...(declaration.style
        ? {
            styleUrl: pluginAdminEntryUrl(plugin.manifest.id, declaration.style),
            stylePath: path.resolve(plugin.dir, declaration.style)
          }
        : {})
    });
  }

  return pages;
}

/**
 * 注册插件声明的后台菜单。
 *
 * 单个页面注册失败（例如路径与别的插件冲突）只记错误并跳过：
 * 此时插件本体已经启动成功，若因此抛错会留下"半启动"状态，反而更难排查。
 * 路径冲突应当在部署前的 `pnpm validate` 阶段被发现。
 *
 * @returns 注销句柄（由 PluginManager 随插件一起回收）。
 */
export function registerDeclaredAdminPages(
  plugin: LoadedPlugin,
  menu: AdminMenuRegistry,
  logger: Logger
): Dispose[] {
  let pages: ResolvedAdminPage[];
  try {
    pages = resolveAdminPages(plugin);
  } catch (error) {
    logger.error('插件声明的后台界面非法，已跳过', {
      plugin: plugin.manifest.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }

  const disposers: Dispose[] = [];

  for (const page of pages) {
    if (!existsSync(page.entryPath)) {
      logger.error('插件后台界面入口文件不存在，已跳过该页面', {
        plugin: page.pluginId,
        page: page.id,
        entry: page.entry,
        hint: '确认文件位于插件目录的 admin/ 下，或从 manifest.admin.pages 中移除该页'
      });
      continue;
    }

    const item: AdminMenuItem = {
      id: page.id,
      label: page.label,
      path: page.path,
      pluginId: page.pluginId,
      entryUrl: page.entryUrl,
      ...(page.styleUrl ? { styleUrl: page.styleUrl } : {}),
      ...(page.icon ? { icon: page.icon } : {}),
      ...(page.order === undefined ? {} : { order: page.order }),
      ...(page.permission ? { permission: page.permission } : {})
    };

    try {
      disposers.push(menu.add(page.pluginId, item));
    } catch (error) {
      logger.error('后台菜单注册失败（可能是路径或 ID 与其它插件冲突）', {
        plugin: page.pluginId,
        page: page.id,
        path: page.path,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return disposers;
}
