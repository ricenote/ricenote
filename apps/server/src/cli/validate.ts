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
  type ThemeManifest,
  type ValidationIssue
} from '@ricenote/shared';
import { PLUGIN_API_VERSION } from '@ricenote/plugin-sdk';
import { THEME_API_VERSION } from '@ricenote/theme-sdk';
import { discoverPlugins } from '@ricenote/core';

const validator = createManifestValidator();

export interface ValidateOptions {
  rootDir: string;
  pluginsDir: string;
  themesDir: string;
}

interface ValidationReport {
  ok: boolean;
  plugin: { total: number; valid: number; invalid: { dir: string; issues: ValidationIssue[] }[] };
  theme: { total: number; valid: number; invalid: { dir: string; issues: ValidationIssue[] }[] };
}

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

/** 校验插件与主题清单，返回报告。 */
export function validateProject(options: ValidateOptions): ValidationReport {
  const discovery = discoverPlugins(options.pluginsDir);

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
  }

  const invalidPlugins = [...pluginIssues, ...pluginApiIssues];
  const themeResult = validateThemes(options.themesDir);

  return {
    ok: invalidPlugins.length === 0 && themeResult.invalid.length === 0,
    plugin: {
      total: discovery.plugins.length + discovery.invalid.length,
      valid: discovery.plugins.length - pluginApiIssues.length,
      invalid: invalidPlugins
    },
    theme: {
      total: themeResult.total,
      valid: themeResult.total - themeResult.invalid.length,
      invalid: themeResult.invalid
    }
  };
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
    }

    if (issues.length > 0) invalid.push({ dir, issues });
  }

  return { total, invalid };
}

/** 执行校验并打印结果，返回进程退出码。 */
export function runValidate(options: ValidateOptions): number {
  const report = validateProject(options);

  process.stdout.write('\nRiceNote 清单校验\n');
  process.stdout.write(`${DIM}插件目录：${options.pluginsDir}${RESET}\n`);
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

  process.stdout.write('\n');
  return report.ok ? 0 : 1;
}
