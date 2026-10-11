/**
 * 插件发现与加载。
 *
 * 发现规则：`PLUGINS_DIR` 下的一级子目录即一个插件目录，
 * 目录中必须包含 `manifest.json`。按 Manifest 的 `entry` 动态导入入口模块。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ErrorCode,
  RiceNoteError,
  createManifestValidator,
  isCapability,
  parseCapability,
  type PluginManifest,
  type ValidationIssue
} from '@ricenote/shared';
import type { Plugin } from '@ricenote/plugin-sdk';

export interface LoadedPlugin {
  manifest: PluginManifest;
  /** 插件目录绝对路径。 */
  dir: string;
  /** 入口模块绝对路径。 */
  entryPath: string;
  /** 迁移目录绝对路径（若声明）。 */
  migrationsDir?: string;
  /** 是否官方内置插件（位于 plugins/official 下）。 */
  builtin: boolean;
}

export interface InvalidPlugin {
  dir: string;
  id?: string;
  issues: ValidationIssue[];
}

export interface DiscoveryResult {
  plugins: LoadedPlugin[];
  invalid: InvalidPlugin[];
}

const manifestValidator = createManifestValidator();

/** 扫描插件目录并完成 Manifest 结构与取值校验。 */
export function discoverPlugins(pluginsDir: string): DiscoveryResult {
  return discoverPluginsFrom([pluginsDir]);
}

/**
 * 扫描**多个**插件根目录并合并结果。
 *
 * 用途：官方插件（`plugins/official`）与第三方安装目录（`plugins/third-party`）
 * 需要同时被内核发现。ID 去重跨全部根目录生效，重复时后出现的根目录记为非法。
 */
export function discoverPluginsFrom(pluginsDirs: readonly string[]): DiscoveryResult {
  const plugins: LoadedPlugin[] = [];
  const invalid: InvalidPlugin[] = [];
  const seenIds = new Map<string, string>();

  for (const root of pluginsDirs) {
    const found = scanPluginRoot(root, seenIds);
    plugins.push(...found.plugins);
    invalid.push(...found.invalid);
  }

  return { plugins, invalid };
}

/**
 * 是否属于安装过程中的瞬时/隐藏目录。
 *
 * - `.incoming-*` / `.backup-*`：编排器换名落盘期间的中间态；
 * - 以 `.` 开头：约定为隐藏目录（编辑器交换文件、备份脚本等）。
 */
function isTransientDir(name: string): boolean {
  if (name.startsWith('.')) return true;
  return /\.(incoming|backup)-[0-9a-f]+$/.test(name);
}

/** 扫描单个插件根目录（一级子目录即插件目录）。 */
function scanPluginRoot(root: string, seenIds: Map<string, string>): DiscoveryResult {
  const plugins: LoadedPlugin[] = [];
  const invalid: InvalidPlugin[] = [];

  if (!existsSync(root)) {
    return { plugins, invalid };
  }

  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    /*
     * 跳过安装器的**瞬时目录**与隐藏目录。
     *
     * 必须显式排除：这些目录里往往也带着完整的 `manifest.json`（它们是某个插件的
     * 副本），一旦被当成插件目录，就会出现"同一个 ID 有两个来源"的冲突，
     * 把一个可以自愈的清理失败放大成"插件加载不上"的故障。
     */
    .filter((entry) => !isTransientDir(entry.name))
    .map((entry) => entry.name)
    .sort();

  const builtin = root.replace(/\\/g, '/').includes('/plugins/official');

  for (const name of entries) {
    const dir = path.join(root, name);
    const manifestPath = path.join(dir, 'manifest.json');

    if (!existsSync(manifestPath)) {
      // 目录下没有 manifest.json 视为普通目录，静默跳过
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      invalid.push({
        dir,
        issues: [{ path: '/', message: `manifest.json 不是合法 JSON：${String(error)}` }]
      });
      continue;
    }

    const result = manifestValidator.validatePlugin(parsed);
    if (!result.valid) {
      invalid.push({ dir, issues: result.issues });
      continue;
    }

    const manifest = parsed as PluginManifest;

    const duplicatedWith = seenIds.get(manifest.id);
    if (duplicatedWith) {
      invalid.push({
        dir,
        id: manifest.id,
        issues: [
          { path: '/id', message: `插件 ID 与 ${duplicatedWith} 重复：${manifest.id}`, keyword: 'unique' }
        ]
      });
      continue;
    }
    seenIds.set(manifest.id, dir);

    plugins.push({
      manifest,
      dir,
      entryPath: path.resolve(dir, manifest.entry),
      ...(manifest.migrations ? { migrationsDir: path.resolve(dir, manifest.migrations) } : {}),
      builtin
    });
  }

  return { plugins, invalid };
}

/** 动态导入插件入口模块，返回其导出的 Plugin 对象。 */
export async function loadPluginModule(plugin: LoadedPlugin): Promise<Plugin> {
  if (!existsSync(plugin.entryPath)) {
    throw new RiceNoteError(
      ErrorCode.MANIFEST_ENTRY_INVALID,
      `插件 ${plugin.manifest.id} 的入口文件不存在：${plugin.entryPath}（请先执行 pnpm build）`,
      { status: 500, details: { entry: plugin.entryPath } }
    );
  }

  const moduleUrl = pathToFileURL(plugin.entryPath).href;
  let imported: Record<string, unknown>;
  try {
    imported = (await import(moduleUrl)) as Record<string, unknown>;
  } catch (error) {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_LOAD_FAILED,
      `插件 ${plugin.manifest.id} 入口加载失败：${String(error)}`,
      { status: 500, cause: error }
    );
  }

  const candidate = (imported.default ?? imported.plugin) as Plugin | undefined;
  if (!candidate || typeof candidate !== 'object') {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_LOAD_FAILED,
      `插件 ${plugin.manifest.id} 未导出 Plugin 对象（应为 default export）`,
      { status: 500, details: { entry: plugin.entryPath } }
    );
  }

  for (const hook of ['setup', 'start', 'stop'] as const) {
    const value = (candidate as Record<string, unknown>)[hook];
    if (value !== undefined && typeof value !== 'function') {
      throw new RiceNoteError(
        ErrorCode.PLUGIN_LOAD_FAILED,
        `插件 ${plugin.manifest.id} 的 ${hook} 必须是函数`,
        { status: 500 }
      );
    }
  }

  return candidate;
}

/** 读取插件迁移目录下的 `.sql` 文件（按文件名升序）。 */
export function readPluginMigrations(plugin: LoadedPlugin): { name: string; sql: string }[] {
  const dir = plugin.migrationsDir;
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return [];

  return readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith('.sql'))
    .sort()
    .map((file) => ({
      name: file,
      sql: readFileSync(path.join(dir, file), 'utf8')
    }));
}

/** 校验 `provides` 中的 capability 契约格式，返回规范化列表。 */
export function normalizeProvides(manifest: PluginManifest): string[] {
  const provides = manifest.provides ?? [];
  return provides.map((item) => {
    if (!isCapability(item)) {
      throw new RiceNoteError(
        ErrorCode.MANIFEST_INVALID,
        `插件 ${manifest.id} 的 provides 项格式非法：${item}`,
        { status: 400 }
      );
    }
    return parseCapability(item).raw;
  });
}
