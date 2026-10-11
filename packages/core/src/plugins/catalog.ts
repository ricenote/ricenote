/**
 * 官方插件目录在内核侧的判定与推荐版本比较。
 *
 * 职责分工（与 ADR-016 一致）：
 * - **数据**：`plugin-catalog.json` 由 `@ricenote/shared` 提供（唯一事实来源）；
 * - **判定**：`official`（是否属于官方插件目录）与 `builtin`（是否随仓库分发）
 *   是两个独立概念，前者决定"官方"徽章与推荐版本比较，后者决定不可卸载；
 * - **比较**：只做推荐版本口径的比较，registry 的最新版本由安装器负责。
 */

import semver from 'semver';
import {
  findCatalogEntryByNpm,
  findCatalogEntryById,
  getPluginCatalog,
  type PluginCatalogEntry,
  type PluginSourceInfo
} from '@ricenote/shared';
import { parsePackageSpec } from './install/sources.js';

/** 全部官方插件目录条目（保持清单顺序）。 */
export function officialCatalogEntries(): PluginCatalogEntry[] {
  return getPluginCatalog().plugins;
}

/** 按插件 ID 取目录条目。 */
export function catalogEntryOf(pluginId: string): PluginCatalogEntry | undefined {
  return findCatalogEntryById(pluginId);
}

/**
 * 判断一个插件是否属于官方插件目录。
 *
 * 两条判据（都要求目录里的 `id` 与插件 ID 一致，避免"包名对得上但装成了别的插件"）：
 * - 来源是 npm 包：用来源 spec 的**包名**反查目录；
 * - 来源是本地目录/压缩包（含随仓库分发）：直接用插件 ID 反查目录
 *   （开发期从 `plugins/official` 跑的就是这些插件）。
 */
export function isOfficialPlugin(pluginId: string, source?: PluginSourceInfo): boolean {
  const entry = findCatalogEntryById(pluginId);
  if (!entry) return false;
  if (!source) return true;

  if (source.type === 'registry') {
    // 来源 spec 形如 `@ricenote/plugin-posts@^1.5.0`，包名要单独解析出来
    try {
      const { name } = parsePackageSpec(source.spec);
      const byNpm = findCatalogEntryByNpm(name);
      return byNpm?.id === pluginId;
    } catch {
      // 解析失败（历史脏值）时退回按 ID 判定，不让一个坏 spec 影响徽章显示
      return true;
    }
  }

  if (source.type === 'git') {
    // Git 来源（例如私有的官方插件仓库）按仓库地址里的包名匹配
    const name = packageNameFromRepo(source.spec);
    if (name) return findCatalogEntryByNpm(name)?.id === pluginId;
    return true;
  }

  return true;
}

/** 从仓库地址推断包名（`.../plugin-posts.git` → `@ricenote/plugin-posts`）。 */
function packageNameFromRepo(repo: string): string | undefined {
  const match = /([a-z0-9-]+?)(?:\.git)?$/i.exec(repo.replace(/\/+$/, ''));
  if (!match) return undefined;
  const slug = match[1] as string;
  const entry = getPluginCatalog().plugins.find(
    (item) => item.repository.replace(/\/+$/, '').endsWith(`/${slug}`)
  );
  return entry?.npm;
}

/**
 * 已装版本是否低于**推荐版本**。
 *
 * 与 registry 的"最新版本"是两回事：推荐版本代表"随主程序测试通过的组合"，
 * 后台用它作为更新提示的基线，避免"提示更新到 2.0 却装不上兼容版本"。
 */
export function updateToRecommended(
  installedVersion: string | undefined,
  pluginId: string
): { recommended: string; outdated: boolean } | undefined {
  const entry = findCatalogEntryById(pluginId);
  if (!entry) return undefined;

  const installed = installedVersion ? semver.valid(installedVersion, { loose: true }) : null;
  if (!installed) return { recommended: entry.version, outdated: false };

  return {
    recommended: entry.version,
    outdated: semver.gt(entry.version, installed)
  };
}

/**
 * 生成「官方插件目录」的合并视图数据（供后台接口使用）。
 *
 * 输入是内核的插件摘要列表，输出逐条标注"已装/未装、是否内置、是否落后于推荐版本"。
 */
export function buildCatalogView(
  installed: readonly { id: string; version: string; builtin: boolean }[]
): Array<PluginCatalogEntry & { installedVersion: string | null; installed: boolean; builtin: boolean; updateToRecommended: boolean }> {
  const byId = new Map(installed.map((item) => [item.id, item]));

  return getPluginCatalog().plugins.map((entry) => {
    const current = byId.get(entry.id);
    const comparison = updateToRecommended(current?.version, entry.id);
    return {
      ...entry,
      installedVersion: current?.version ?? null,
      installed: current !== undefined,
      builtin: current?.builtin ?? false,
      updateToRecommended: comparison?.outdated ?? false
    };
  });
}
