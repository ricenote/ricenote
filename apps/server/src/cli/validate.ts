/**
 * `ricenote validate` —— 无需数据库即可运行的清单校验命令。
 *
 * 用于 CI 与本地开发：确保插件/主题在提交前就满足契约，
 * 避免"上线才发现 Manifest 非法"。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  createManifestValidator,
  satisfiesRange,
  type PluginManifest,
  type ThemeManifest,
  type ValidationIssue
} from '@ricenote/shared';
import { PLUGIN_API_VERSION, STANDARD_SLOTS } from '@ricenote/plugin-sdk';
import { THEME_API_VERSION } from '@ricenote/theme-sdk';
import { APP_VERSION, discoverPluginsFrom } from '@ricenote/core';
import { validateCatalog, type CatalogValidation } from './validate-catalog.js';

const validator = createManifestValidator();

export interface ValidateOptions {
  rootDir: string;
  /** 插件根目录列表（官方 + 第三方安装目录）。 */
  pluginsDirs: string[];
  themesDir: string;
  /** 官方插件目录（`plugins/official`）；用于校验官方插件目录的一致性。 */
  officialDir?: string;
  /** 当前应用版本（默认取内核 APP_VERSION）。 */
  appVersion?: string;
}

interface ValidationReport {
  ok: boolean;
  plugin: { total: number; valid: number; invalid: { dir: string; issues: ValidationIssue[] }[] };
  theme: { total: number; valid: number; invalid: { dir: string; issues: ValidationIssue[] }[] };
  /** 官方插件目录（推荐版本、包名、可发布形态）的校验结果。 */
  catalog: CatalogValidation;
}

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

/** 校验插件与主题清单，返回报告。 */
export function validateProject(options: ValidateOptions): ValidationReport {
  const discovery = discoverPluginsFrom(options.pluginsDirs);

  const pluginIssues = discovery.invalid.map((item) => ({ dir: item.dir, issues: item.issues }));
  const pluginApiIssues: { dir: string; issues: ValidationIssue[] }[] = [];

  for (const plugin of discovery.plugins) {
    if (!satisfiesRange(PLUGIN_API_VERSION, plugin.manifest.apiVersion)) {
      pluginApiIssues.push({
        dir: plugin.dir,
        issues: [
          {
            path: '/apiVersion',
            message: `要求 Plugin API ${plugin.manifest.apiVersion}，当前为 ${PLUGIN_API_VERSION}`,
            keyword: 'apiVersion'
          }
        ]
      });
      continue;
    }
    if (!existsSync(plugin.entryPath)) {
      pluginApiIssues.push({
        dir: plugin.dir,
        issues: [
          {
            path: '/entry',
            message: `入口文件不存在：${plugin.manifest.entry}（请先执行 pnpm build）`,
            keyword: 'entry'
          }
        ]
      });
    }
    if (plugin.migrationsDir && !existsSync(plugin.migrationsDir)) {
      pluginApiIssues.push({
        dir: plugin.dir,
        issues: [{ path: '/migrations', message: `迁移目录不存在：${plugin.manifest.migrations}`, keyword: 'migrations' }]
      });
    }

    /*
     * 插件自带后台界面：入口文件必须存在。
     * 这一条必须在 CI/提交前拦住 —— 否则表现为"菜单入口点进去加载失败"，
     * 排查成本远高于构建期报错。
     */
    for (const page of plugin.manifest.admin?.pages ?? []) {
      const entryPath = path.resolve(plugin.dir, page.entry);
      if (!existsSync(entryPath)) {
        pluginApiIssues.push({
          dir: plugin.dir,
          issues: [
            {
              path: `/admin/pages/${page.id}`,
              message: `后台界面入口不存在：${page.entry}`,
              keyword: 'entry'
            }
          ]
        });
      }
      if (page.style && !existsSync(path.resolve(plugin.dir, page.style))) {
        pluginApiIssues.push({
          dir: plugin.dir,
          issues: [
            {
              path: `/admin/pages/${page.id}`,
              message: `后台界面样式不存在：${page.style}`,
              keyword: 'style'
            }
          ]
        });
      }
    }
  }

  // 后台菜单路径/ID 必须全局唯一：冲突会导致启动时某一个菜单注册失败
  const menuPaths = new Map<string, string>();
  const menuIds = new Map<string, string>();
  for (const plugin of discovery.plugins) {
    for (const page of plugin.manifest.admin?.pages ?? []) {
      const pathOwner = menuPaths.get(page.path);
      if (pathOwner) {
        pluginApiIssues.push({
          dir: plugin.dir,
          issues: [
            {
              path: `/admin/pages/${page.id}`,
              message: `后台路径与插件 ${pathOwner} 冲突：${page.path}`,
              keyword: 'conflict'
            }
          ]
        });
      } else {
        menuPaths.set(page.path, plugin.manifest.id);
      }

      const idOwner = menuIds.get(page.id);
      if (idOwner) {
        pluginApiIssues.push({
          dir: plugin.dir,
          issues: [
            {
              path: `/admin/pages/${page.id}`,
              message: `后台页面 ID 与插件 ${idOwner} 冲突：${page.id}`,
              keyword: 'conflict'
            }
          ]
        });
      } else {
        menuIds.set(page.id, plugin.manifest.id);
      }
    }
  }

  /*
   * 命名扩展点：跨插件唯一性、能力声明、入口白名单与 replace 冲突。
   * 这些规则**必须**在部署前拦下 —— 运行期注册表刻意对"未声明的扩展点"只告警不拒绝
   * （插件启停顺序不确定），因此拼写错误与冲突只能靠这里发现。
   */
  pluginApiIssues.push(...validateExtensions(discovery.plugins));

  const invalidPlugins = [...pluginIssues, ...pluginApiIssues];
  const themeResult = validateThemes(options.themesDir);
  /*
   * 官方插件目录一致性：官方插件一旦发到 npm 就收不回，
   * 因此版本/包名/可发布形态的漂移必须在提交前拦住。
   */
  const catalogResult = validateCatalog({
    officialDir: options.officialDir,
    appVersion: options.appVersion ?? APP_VERSION
  });

  return {
    ok: invalidPlugins.length === 0 && themeResult.invalid.length === 0 && catalogResult.ok,
    plugin: {
      total: discovery.plugins.length + discovery.invalid.length,
      valid: discovery.plugins.length - pluginApiIssues.length,
      invalid: invalidPlugins
    },
    theme: {
      total: themeResult.total,
      valid: themeResult.total - themeResult.invalid.length,
      invalid: themeResult.invalid
    },
    catalog: catalogResult
  };
}

/** 内置内容字段名：主题的 contentFields 不得占用（它们由内容本身与持久化列占用）。 */
const RESERVED_CONTENT_FIELDS = new Set([
  'title',
  'slug',
  'content',
  'excerpt',
  'status',
  'template',
  'fields',
  'sortOrder'
]);

/** admin 作用域的贡献入口限 `./admin/`，render 与 server 限 `./dist/`（Node 侧 import）。 */
function entryMatchesScope(entry: string, scope: string): boolean {
  return scope === 'admin' ? entry.startsWith('./admin/') : entry.startsWith('./dist/');
}

/**
 * 命名扩展点的静态校验（跨插件）。
 *
 * 覆盖：能力声明、扩展点全局唯一（Core 预置标准渲染插槽视为已存在）、
 * 贡献入口的作用域白名单与文件存在、style/permission 仅 admin、
 * 以及"同一扩展点上多个 replace 且 order 相同"这种无法裁决的冲突。
 */
function validateExtensions(
  plugins: ReadonlyArray<{ dir: string; manifest: PluginManifest }>
): { dir: string; issues: ValidationIssue[] }[] {
  const byDir = new Map<string, ValidationIssue[]>();
  const report = (dir: string, path_: string, message: string, keyword: string): void => {
    const bucket = byDir.get(dir) ?? [];
    bucket.push({ path: path_, message, keyword });
    byDir.set(dir, bucket);
  };

  const declaredBy = new Map<string, string>();
  for (const slot of STANDARD_SLOTS) declaredBy.set(slot, 'core');

  for (const plugin of plugins) {
    const id = plugin.manifest.id;
    const capabilities = new Set(plugin.manifest.capabilities ?? []);
    const points = plugin.manifest.extensionPoints ?? [];

    if (points.length > 0 && !capabilities.has('extensions:declare')) {
      report(
        plugin.dir,
        '/capabilities',
        '声明了 extensionPoints 但未声明能力 extensions:declare（运行时会被拒绝）',
        'capabilities'
      );
    }
    for (const point of points) {
      const owner = declaredBy.get(point.name);
      if (owner !== undefined && owner !== id) {
        report(
          plugin.dir,
          '/extensionPoints',
          `扩展点 ${point.name} 已被 ${owner} 声明（全局唯一）`,
          'extensionPoints'
        );
        continue;
      }
      declaredBy.set(point.name, id);
    }
  }

  /** `${point}#${order}` → 已占用该组合的插件，用于发现无法裁决的 replace 冲突。 */
  const replaceSlots = new Map<string, string>();

  for (const plugin of plugins) {
    const id = plugin.manifest.id;
    const capabilities = new Set(plugin.manifest.capabilities ?? []);
    const contributions = plugin.manifest.contributions ?? [];

    if (contributions.length > 0 && !capabilities.has('extensions:contribute')) {
      report(
        plugin.dir,
        '/capabilities',
        '声明了 contributions 但未声明能力 extensions:contribute（运行时会被拒绝）',
        'capabilities'
      );
    }

    for (const [index, item] of contributions.entries()) {
      const where = `/contributions/${index}`;

      if (!entryMatchesScope(item.entry, item.scope)) {
        report(
          plugin.dir,
          `${where}/entry`,
          `${item.scope} 作用域的入口必须位于 ${item.scope === 'admin' ? './admin/' : './dist/'}：${item.entry}`,
          'entry'
        );
      } else if (!existsSync(path.resolve(plugin.dir, item.entry))) {
        report(
          plugin.dir,
          `${where}/entry`,
          `贡献入口不存在：${item.entry}（请先执行 pnpm build）`,
          'entry'
        );
      }

      if (item.style !== undefined) {
        if (item.scope !== 'admin') {
          report(plugin.dir, `${where}/style`, 'style 仅 admin 作用域可用', 'style');
        } else if (!existsSync(path.resolve(plugin.dir, item.style))) {
          report(plugin.dir, `${where}/style`, `贡献样式不存在：${item.style}`, 'style');
        }
      }

      if (item.permission !== undefined && item.scope !== 'admin') {
        report(plugin.dir, `${where}/permission`, 'permission 仅 admin 作用域可用', 'permission');
      }

      if (!declaredBy.has(item.point)) {
        report(
          plugin.dir,
          `${where}/point`,
          `扩展点未声明：${item.point}（标准渲染插槽或某个插件的 extensionPoints 之一）`,
          'point'
        );
      }

      if (item.mode === 'replace') {
        const key = `${item.point}#${item.order ?? 0}`;
        const owner = replaceSlots.get(key);
        if (owner !== undefined && owner !== id) {
          report(
            plugin.dir,
            `${where}/order`,
            `${item.point} 上 ${owner} 与本插件同在 order=${item.order ?? 0} 使用 replace，无法确定胜出者`,
            'order'
          );
        } else {
          replaceSlots.set(key, id);
        }
      }
    }
  }

  return [...byDir.entries()].map(([dir, issues]) => ({ dir, issues }));
}

function validateThemes(themesDir: string): {
  total: number;
  invalid: { dir: string; issues: ValidationIssue[] }[];
} {
  const invalid: { dir: string; issues: ValidationIssue[] }[] = [];
  if (!existsSync(themesDir)) return { total: 0, invalid };

  const dirs = readdirSync(themesDir).filter((name) => statSync(path.join(themesDir, name)).isDirectory());
  let total = 0;

  for (const name of dirs) {
    const dir = path.join(themesDir, name);
    const manifestPath = path.join(dir, 'theme.json');
    if (!existsSync(manifestPath)) continue;
    total += 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      invalid.push({ dir, issues: [{ path: '/', message: `theme.json 不是合法 JSON：${String(error)}` }] });
      continue;
    }

    const result = validator.validateTheme(parsed);
    const issues: ValidationIssue[] = result.valid ? [] : [...result.issues];

    if (result.valid) {
      const manifest = parsed as ThemeManifest;
      if (!satisfiesRange(THEME_API_VERSION, manifest.apiVersion)) {
        issues.push({
          path: '/apiVersion',
          message: `要求 Theme API ${manifest.apiVersion}，当前为 ${THEME_API_VERSION}`,
          keyword: 'apiVersion'
        });
      }
      for (const [kind, file] of Object.entries(manifest.templates)) {
        if (!existsSync(path.join(dir, 'templates', file))) {
          issues.push({
            path: `/templates/${kind}`,
            message: `模板文件缺失：templates/${file}`,
            keyword: 'file'
          });
        }
      }
      if (manifest.screenshot && !existsSync(path.resolve(dir, manifest.screenshot))) {
        issues.push({
          path: '/screenshot',
          message: `预览图不存在：${manifest.screenshot}`,
          keyword: 'file'
        });
      }

      /*
       * 内容自定义字段（文章与页面共用）：字段名不能占用内置字段，
       * 否则后台会同时出现两个"标题"输入框，而模板里 `post.fields.title`
       * 与 `post.title` 指向不同东西 —— 这种歧义一旦发出去就改不回来。
       */
      for (const key of Object.keys(manifest.contentFields ?? {})) {
        if (RESERVED_CONTENT_FIELDS.has(key)) {
          issues.push({
            path: `/contentFields/${key}`,
            message: `${key} 是内置内容字段名，不能作为自定义字段（可选：featuredImage、summary、subtitle 等）`,
            keyword: 'contentFields'
          });
        }
      }
    }

    if (issues.length > 0) invalid.push({ dir, issues });
  }

  return { total, invalid };
}

/** 执行校验并打印结果，返回进程退出码。 */
export function runValidate(options: ValidateOptions): number {
  const report = validateProject(options);

  process.stdout.write('\nRiceNote 清单校验\n');
  process.stdout.write(`${DIM}插件目录：${options.pluginsDirs.join('、')}${RESET}\n`);
  process.stdout.write(`${DIM}主题目录：${options.themesDir}${RESET}\n\n`);

  if (report.plugin.invalid.length === 0) {
    process.stdout.write(`${GREEN}✓${RESET} 插件清单：${report.plugin.valid}/${report.plugin.total} 通过\n`);
  } else {
    process.stdout.write(
      `${RED}✗${RESET} 插件清单：${report.plugin.valid}/${report.plugin.total} 通过\n`
    );
    for (const item of report.plugin.invalid) {
      process.stdout.write(`  ${RED}${path.relative(options.rootDir, item.dir)}${RESET}\n`);
      for (const issue of item.issues) {
        process.stdout.write(`    ${YELLOW}${issue.path}${RESET} ${issue.message}\n`);
      }
    }
  }

  if (report.theme.invalid.length === 0) {
    process.stdout.write(`${GREEN}✓${RESET} 主题清单：${report.theme.valid}/${report.theme.total} 通过\n`);
  } else {
    process.stdout.write(`${RED}✗${RESET} 主题清单：${report.theme.valid}/${report.theme.total} 通过\n`);
    for (const item of report.theme.invalid) {
      process.stdout.write(`  ${RED}${path.relative(options.rootDir, item.dir)}${RESET}\n`);
      for (const issue of item.issues) {
        process.stdout.write(`    ${YELLOW}${issue.path}${RESET} ${issue.message}\n`);
      }
    }
  }

  if (report.catalog.invalid.length === 0) {
    process.stdout.write(
      `${GREEN}✓${RESET} 官方插件目录：${report.catalog.valid}/${report.catalog.total} 通过` +
        `${DIM}（appVersion ${report.catalog.catalogAppVersion}）${RESET}\n`
    );
  } else {
    process.stdout.write(
      `${RED}✗${RESET} 官方插件目录：${report.catalog.valid}/${report.catalog.total} 通过\n`
    );
    for (const item of report.catalog.invalid) {
      process.stdout.write(`  ${RED}${item.id}${RESET} ${DIM}${item.label}${RESET}\n`);
      for (const issue of item.issues) {
        process.stdout.write(`    ${YELLOW}${issue.path}${RESET} ${issue.message}\n`);
      }
    }
  }

  // 提示不算失败：例如开发中的插件还没进目录、清单版本还没随发版更新
  for (const note of report.catalog.notes) {
    process.stdout.write(`  ${YELLOW}!${RESET} ${DIM}${note}${RESET}\n`);
  }

  process.stdout.write('\n');
  return report.ok ? 0 : 1;
}
