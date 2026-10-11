/**
 * 官方插件目录（推荐插件清单）的读取与查询。
 *
 * 为什么放在 `@ricenote/shared`：CLI（安装向导）、Core（`official` 判定与
 * validate）、服务端（目录接口）与发布脚本都要读同一份数据。放在共享包意味着
 * 它随发布产物一起走，不会出现"仓库里一份、产物里另一份"的漂移。
 *
 * 数据文件与 Schema 同址（`manifests/`），解析方式复用 `resolveManifestPath`，
 * 因此 `src/`（tsx 直跑）与 `dist/`（编译产物）都能找到。
 */

import { readFileSync } from 'node:fs';
import { Ajv, type ValidateFunction } from 'ajv';
import type { PluginCatalog, PluginCatalogEntry } from './types/catalog.js';
import { resolveManifestPath } from './validation.js';

let catalogCache: PluginCatalog | undefined;
let catalogValidator: ValidateFunction | undefined;

/**
 * 读取并校验官方插件目录（带缓存）。
 *
 * 校验失败会**直接抛错**而不是返回空清单：清单是安装向导的唯一依据，
 * 悄悄退化成"没有官方插件可装"会让问题出现在离原因很远的地方。
 */
export function getPluginCatalog(): PluginCatalog {
  if (catalogCache) return catalogCache;

  const raw = JSON.parse(readFileSync(resolveManifestPath('plugin-catalog.json'), 'utf8')) as unknown;

  if (!catalogValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    catalogValidator = ajv.compile(
      JSON.parse(readFileSync(resolveManifestPath('plugin-catalog.schema.json'), 'utf8')) as Record<
        string,
        unknown
      >
    );
  }

  if (catalogValidator(raw) !== true) {
    const issues = (catalogValidator.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? '校验失败'}`)
      .join('；');
    throw new Error(`官方插件目录（plugin-catalog.json）未通过校验：${issues}`);
  }

  catalogCache = raw as PluginCatalog;
  return catalogCache;
}

/** 按插件 ID 查找清单条目（如 `rice.posts`）。 */
export function findCatalogEntryById(id: string): PluginCatalogEntry | undefined {
  return getPluginCatalog().plugins.find((entry) => entry.id === id);
}

/** 按 npm 包名查找清单条目（如 `@ricenote/plugin-posts`）。 */
export function findCatalogEntryByNpm(npm: string): PluginCatalogEntry | undefined {
  const normalized = npm.trim().toLowerCase();
  return getPluginCatalog().plugins.find((entry) => entry.npm.toLowerCase() === normalized);
}

/** 全部官方插件的 npm 包名。 */
export function catalogPackageNames(): string[] {
  return getPluginCatalog().plugins.map((entry) => entry.npm);
}

/** 必需（不可取消勾选）的清单条目。 */
export function requiredCatalogEntries(): PluginCatalogEntry[] {
  return getPluginCatalog().plugins.filter((entry) => entry.category === 'required');
}

/** 默认勾选的清单条目（必需 + 推荐）。 */
export function defaultSelectedEntries(): PluginCatalogEntry[] {
  return getPluginCatalog().plugins.filter(
    (entry) => entry.category === 'required' || entry.category === 'recommended'
  );
}

/**
 * 取某个条目**连同其依赖**的闭包（用于向导勾选联动与安装排序）。
 *
 * 例如勾选 `rice.authorization` 会带上 `rice.identity`；清单里的依赖是
 * 插件 ID（不是 capability），因此这里只做简单的图遍历。
 * 出现环时按"已访问"剪枝，不会死循环。
 */
export function withRequiredDependencies(ids: readonly string[]): PluginCatalogEntry[] {
  const catalog = getPluginCatalog();
  const byId = new Map(catalog.plugins.map((entry) => [entry.id, entry]));
  const selected = new Set<string>();
  const queue = [...ids];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (selected.has(id)) continue;
    const entry = byId.get(id);
    if (!entry) continue;
    selected.add(id);
    for (const dependency of entry.requires) queue.push(dependency);
  }

  // 保持清单顺序（required 在前），让向导与安装顺序稳定可预期
  return catalog.plugins.filter((entry) => selected.has(entry.id));
}

/** 仅测试用：清空缓存（改动清单文件后重新读取）。 */
export function resetCatalogCache(): void {
  catalogCache = undefined;
  catalogValidator = undefined;
}
