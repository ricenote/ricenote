/**
 * 声明式扩展点注册：把插件清单里的 `extensionPoints` 与 `contributions`
 * 变成注册表记录（与插件在 `start()` 里调 `ctx.extensions` 等价，但插件零代码）。
 *
 * 三条路径的形状差异（**必须与文档一致，否则贡献者会写错**）：
 * - `admin`：payload 是"浏览器可 import 的托管 URL"，由后台 SPA 的 `PluginSlot` 渲染。
 *   这里只把清单里的相对路径换算成 URL，并把 style/permission/label 放进 meta 供接口下发。
 * - `render`：payload 是 `SlotComponent`（`{ name, render }`），由 Core 动态 `import()` 插件产物。
 * - `server`：payload 是 `ExtensionHookModule`（`{ apply }`），由提供方用 `apply()` 串行触发。
 *
 * 失败策略：**单条失败只跳过该条并记错误**，不让整个插件启动失败。
 * 理由：清单里的拼写/产物缺失在 `pnpm validate`（部署前）就该被拦下；
 * 到了运行期，为一条写错的贡献让整个插件不可用，代价明显更大。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Dispose, ExtensionHookModule, SlotComponent } from '@ricenote/plugin-sdk';
import type { Logger } from '../logger.js';
import type { ExtensionRegistry } from './registry.js';
import type { LoadedPlugin } from '../plugins/manifest.js';
import { pluginAdminEntryUrl } from '../plugins/admin-pages.js';

/** 动态 import 一个入口模块（按需加时间戳无关的 file URL；进程内 ESM 缓存由 Node 负责）。 */
async function importEntry(pluginDir: string, entry: string): Promise<Record<string, unknown>> {
  const url = pathToFileURL(path.resolve(pluginDir, entry)).href;
  return (await import(url)) as Record<string, unknown>;
}

/** 从模块里取默认导出（没有默认导出时退化为模块命名空间）。 */
function defaultExport(module: Record<string, unknown>): unknown {
  return module.default ?? module;
}

/**
 * 注册插件声明的全部扩展点与贡献。
 *
 * @returns 注销句柄（由 PluginManager 与插件其它注册一起回收，保证"停用即消失"）。
 */
export async function registerDeclaredExtensions(input: {
  plugin: LoadedPlugin;
  extensions: ExtensionRegistry;
  logger: Logger;
}): Promise<Dispose[]> {
  const { plugin, extensions, logger } = input;
  const pluginId = plugin.manifest.id;
  const scoped = logger.child({ plugin: pluginId });
  const disposers: Dispose[] = [];

  for (const point of plugin.manifest.extensionPoints ?? []) {
    try {
      disposers.push(extensions.declare(pluginId, point));
    } catch (error) {
      scoped.error('扩展点声明失败（已跳过该条）', {
        point: point.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const [index, item] of (plugin.manifest.contributions ?? []).entries()) {
    const mode = item.mode ?? 'append';
    const order = item.order ?? 0;

    try {
      if (item.scope === 'admin') {
        disposers.push(
          extensions.contribute(pluginId, item.point, pluginAdminEntryUrl(pluginId, item.entry), {
            scope: 'admin',
            mode,
            order,
            meta: {
              pluginId,
              entry: item.entry,
              ...(item.style ? { style: item.style } : {}),
              ...(item.permission ? { permission: item.permission } : {}),
              ...(item.label ? { label: item.label } : {})
            }
          })
        );
        continue;
      }

      const loaded = await importEntry(plugin.dir, item.entry);
      const exported = defaultExport(loaded);

      if (item.scope === 'render') {
        const component = exported as Partial<SlotComponent>;
        if (typeof component?.render !== 'function') {
          throw new Error(`render 贡献的入口必须导出 { name, render }：${item.entry}`);
        }
        disposers.push(
          extensions.contribute(
            pluginId,
            item.point,
            { name: component.name ?? `${pluginId}#${index}`, render: component.render },
            { scope: 'render', mode, order }
          )
        );
        continue;
      }

      const hook = exported as Partial<ExtensionHookModule>;
      if (typeof hook?.apply !== 'function') {
        throw new Error(`server 贡献的入口必须导出 { apply }：${item.entry}`);
      }
      disposers.push(
        extensions.contribute(pluginId, item.point, { name: hook.name, apply: hook.apply }, {
          scope: 'server',
          mode,
          order
        })
      );
    } catch (error) {
      scoped.error('声明式贡献注册失败（已跳过该条）', {
        point: item.point,
        scope: item.scope,
        entry: item.entry,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (disposers.length > 0) {
    scoped.debug('声明式扩展点已注册', {
      declarations: plugin.manifest.extensionPoints?.length ?? 0,
      contributions: disposers.length - (plugin.manifest.extensionPoints?.length ?? 0)
    });
  }

  return disposers;
}
