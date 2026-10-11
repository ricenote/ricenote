/**
 * 依赖解析器。
 *
 * 规则（说明书 3.2 / 6.1）：
 * - 依赖键优先按 **capability 契约**（如 `content.posts@1`）解析到提供者；
 * - 否则按 **插件 ID** 解析（仅在确需特定实现时使用）；
 * - 解析后做拓扑排序；环、缺依赖、版本不满足都必须在启动前明确报错；
 * - 依赖只能落在"已启用"的插件上，禁用被依赖插件需在启用（disable）前被阻止。
 */

import {
  ErrorCode,
  RiceNoteError,
  findProvider,
  isCapability,
  parseCapability,
  satisfiesRange,
  type ProvidedCapability
} from '@ricenote/shared';
import type { LoadedPlugin } from './manifest.js';
import { normalizeProvides } from './manifest.js';

export type DependencyProblemKind = 'missing' | 'version' | 'cycle' | 'apiVersion';

export interface DependencyProblem {
  pluginId: string;
  key: string;
  kind: DependencyProblemKind;
  message: string;
}

export interface ResolutionResult {
  /** 拓扑序：依赖在前，被依赖者在前。 */
  order: LoadedPlugin[];
  problems: DependencyProblem[];
}

interface Edge {
  from: string;
  to: string;
  key: string;
}

/** 构建 capability 提供者索引。 */
export function buildCapabilityIndex(plugins: LoadedPlugin[]): ProvidedCapability[] {
  const index: ProvidedCapability[] = [];
  for (const plugin of plugins) {
    for (const raw of normalizeProvides(plugin.manifest)) {
      index.push({ pluginId: plugin.manifest.id, raw, ref: parseCapability(raw) });
    }
  }
  return index;
}

/**
 * 解析依赖并返回拓扑序。
 *
 * @param candidates 全部已发现插件
 * @param enabledIds 需要参与运行的插件 ID 集合
 * @param coreApiVersion 当前 Plugin API 版本（用于校验各插件 apiVersion）
 */
export function resolveDependencies(
  candidates: LoadedPlugin[],
  enabledIds: Set<string>,
  coreApiVersion: string
): ResolutionResult {
  const problems: DependencyProblem[] = [];
  const byId = new Map(candidates.map((plugin) => [plugin.manifest.id, plugin]));
  const enabledPlugins = candidates.filter((plugin) => enabledIds.has(plugin.manifest.id));
  const capabilityIndex = buildCapabilityIndex(enabledPlugins);
  const edges: Edge[] = [];

  for (const plugin of enabledPlugins) {
    const { id, apiVersion, requires } = plugin.manifest;

    // 1) 校验插件声明的 API 版本区间是否覆盖当前 Core 的 Plugin API
    try {
      if (!satisfiesRange(coreApiVersion, apiVersion)) {
        problems.push({
          pluginId: id,
          key: 'apiVersion',
          kind: 'apiVersion',
          message: `插件要求 Plugin API ${apiVersion}，当前为 ${coreApiVersion}`
        });
      }
    } catch (error) {
      problems.push({
        pluginId: id,
        key: 'apiVersion',
        kind: 'apiVersion',
        message: error instanceof RiceNoteError ? error.message : String(error)
      });
    }

    if (!requires) continue;

    for (const [key, range] of Object.entries(requires)) {
      if (isCapability(key)) {
        const provider = findProvider(capabilityIndex, key);
        if (!provider) {
          problems.push({
            pluginId: id,
            key,
            kind: 'missing',
            message: `缺少能力提供者：${key}（请确认提供该能力的插件已启用）`
          });
          continue;
        }
        const providerPlugin = byId.get(provider.pluginId);
        if (!providerPlugin) continue;
        try {
          if (!satisfiesRange(providerPlugin.manifest.version, range)) {
            problems.push({
              pluginId: id,
              key,
              kind: 'version',
              message: `能力 ${key} 由 ${provider.pluginId}@${providerPlugin.manifest.version} 提供，不满足 ${range}`
            });
            continue;
          }
        } catch (error) {
          problems.push({
            pluginId: id,
            key,
            kind: 'version',
            message: error instanceof RiceNoteError ? error.message : String(error)
          });
          continue;
        }
        edges.push({ from: id, to: provider.pluginId, key });
        continue;
      }

      // 按插件 ID 依赖
      const target = byId.get(key);
      if (!target) {
        problems.push({
          pluginId: id,
          key,
          kind: 'missing',
          message: `依赖的插件不存在：${key}`
        });
        continue;
      }
      if (!enabledIds.has(key)) {
        problems.push({
          pluginId: id,
          key,
          kind: 'missing',
          message: `依赖的插件已被禁用：${key}`
        });
        continue;
      }
      try {
        if (!satisfiesRange(target.manifest.version, range)) {
          problems.push({
            pluginId: id,
            key,
            kind: 'version',
            message: `依赖 ${key}@${target.manifest.version} 不满足区间 ${range}`
          });
          continue;
        }
      } catch (error) {
        problems.push({
          pluginId: id,
          key,
          kind: 'version',
          message: error instanceof RiceNoteError ? error.message : String(error)
        });
        continue;
      }
      edges.push({ from: id, to: key, key });
    }
  }

  const { order, cycles } = topologicalSort(
    enabledPlugins.map((plugin) => plugin.manifest.id),
    edges
  );
  for (const cycle of cycles) {
    problems.push({
      pluginId: cycle[0] ?? 'unknown',
      key: cycle.join(' → '),
      kind: 'cycle',
      message: `检测到循环依赖：${cycle.join(' → ')}`
    });
  }

  return {
    order: order.map((id) => byId.get(id)).filter((plugin): plugin is LoadedPlugin => Boolean(plugin)),
    problems
  };
}

/** Kahn 算法拓扑排序；返回排序结果与未能排序的环。 */
export function topologicalSort(
  nodeIds: string[],
  edges: Edge[]
): { order: string[]; cycles: string[][] } {
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]));

  for (const edge of edges) {
    if (!inDegree.has(edge.from) || !inDegree.has(edge.to)) continue;
    adjacency.get(edge.to)?.push(edge.from); // to → from（提供者先启动）
    inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) {
        // 插入时保持字典序，保证排序结果稳定可复现
        const position = queue.findIndex((item) => item > next);
        if (position === -1) queue.push(next);
        else queue.splice(position, 0, next);
      }
    }
  }

  const cycles: string[][] = [];
  if (order.length !== nodeIds.length) {
    const remaining = nodeIds.filter((id) => !order.includes(id));
    cycles.push(remaining.sort());
  }

  return { order, cycles };
}

/**
 * 计算某插件的**依赖者**（反向依赖），用于禁用前置校验。
 * 返回依赖 `pluginId` 的插件 ID 列表。
 */
export function findDependents(candidates: LoadedPlugin[], pluginId: string): string[] {
  const target = candidates.find((plugin) => plugin.manifest.id === pluginId);
  if (!target) return [];

  const provides = normalizeProvides(target.manifest);
  const dependents: string[] = [];

  for (const plugin of candidates) {
    if (plugin.manifest.id === pluginId) continue;
    const requires = plugin.manifest.requires ?? {};
    for (const key of Object.keys(requires)) {
      if (key === pluginId) {
        dependents.push(plugin.manifest.id);
        break;
      }
      if (isCapability(key) && provides.includes(key)) {
        dependents.push(plugin.manifest.id);
        break;
      }
    }
  }

  return [...new Set(dependents)].sort();
}
