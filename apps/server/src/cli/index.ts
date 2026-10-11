#!/usr/bin/env node
/**
 * RiceNote CLI。
 *
 * 命令：
 *   validate                       校验插件/主题清单（无需数据库）
 *   migrate                        执行 Core 与插件迁移
 *   plugin list|enable|disable     插件状态管理
 *   theme  list|activate|settings  主题管理
 *   help                           显示帮助
 */

import {
  createDatabaseAdapter,
  createLogger,
  discoverPlugins,
  findDependents,
  loadConfig,
  MigrationCoordinator,
  PluginStore,
  readPluginMigrations,
  resolveRootDir,
  ThemeManager,
  type RiceNoteConfig
} from '@ricenote/core';
import { HtmlCache } from '@ricenote/core';
import { runValidate } from './validate.js';

const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

function printHelp(): void {
  process.stdout.write(`
RiceNote CLI

用法：ricenote <命令> [选项]

命令：
  validate                       校验插件与主题清单（不需要数据库）
  migrate                        执行 Core 与插件迁移（加锁串行）
  plugin list                    列出插件及其状态
  plugin enable <pluginId>       启用插件（需重启进程生效）
  plugin disable <pluginId>      禁用插件（存在反向依赖时拒绝）
  theme list                     列出主题
  theme activate <themeId>       激活主题
  theme settings <themeId>       打印主题的生效设置

环境：
  读取项目根目录的 .env 与系统环境变量（见 .env.example）
`);
}

async function main(): Promise<number> {
  const [, , command, subCommand, ...rest] = process.argv;
  // 与 HTTP 入口一致：向上查找项目根，兼容 pnpm 从包目录运行脚本
  const rootDir = resolveRootDir();

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }

  switch (command) {
    case 'validate': {
      const config = loadConfig({ rootDir, loadDotEnv: true });
      return runValidate({
        rootDir,
        pluginsDir: config.paths.pluginsDir,
        themesDir: config.paths.themesDir
      });
    }
    case 'migrate':
      return runMigrate(rootDir);
    case 'plugin':
      return runPlugin(rootDir, subCommand, rest[0] ?? rest[0]);
    case 'theme':
      return runTheme(rootDir, subCommand, rest[0]);
    default:
      process.stderr.write(`未知命令：${command}\n`);
      printHelp();
      return 1;
  }
}

/* ------------------------------ migrate ------------------------------ */

async function runMigrate(rootDir: string): Promise<number> {
  const config = loadConfig({ rootDir });
  const logger = createLogger({ level: config.logLevel });
  const db = createDatabaseAdapter(config);

  if (!(await db.ping())) {
    process.stderr.write(`无法连接数据库：${config.database.host}:${config.database.port}\n`);
    await db.close();
    return 1;
  }

  const migrations = new MigrationCoordinator(config, logger);
  await migrations.ensureLedger();

  if (!(await migrations.acquireLock())) {
    process.stderr.write('迁移锁被占用，另一个实例正在执行迁移\n');
    await db.close();
    return 1;
  }

  try {
    const core = await migrations.applyCore();
    process.stdout.write(
      `Core 迁移：新增 ${core.applied.length} 项，跳过 ${core.skipped.length} 项\n`
    );

    const discovery = discoverPlugins(config.paths.pluginsDir);
    for (const plugin of discovery.plugins) {
      const pluginMigrations = readPluginMigrations(plugin);
      if (pluginMigrations.length === 0) continue;
      const outcome = await migrations.apply({
        scope: `plugin:${plugin.manifest.id}`,
        migrations: pluginMigrations
      });
      process.stdout.write(
        `插件 ${plugin.manifest.id} 迁移：新增 ${outcome.applied.length} 项，跳过 ${outcome.skipped.length} 项\n`
      );
    }

    process.stdout.write('迁移完成。\n');
    return 0;
  } finally {
    await migrations.releaseLock().catch(() => undefined);
    await db.close().catch(() => undefined);
  }
}

/* ------------------------------ plugin ------------------------------ */

async function runPlugin(rootDir: string, subCommand: string | undefined, pluginId?: string): Promise<number> {
  const config = loadConfig({ rootDir });
  const db = createDatabaseAdapter(config);
  if (!(await db.ping())) {
    process.stderr.write('无法连接数据库\n');
    await db.close();
    return 1;
  }

  const store = new PluginStore(db);
  const discovery = discoverPlugins(config.paths.pluginsDir);

  try {
    if (!subCommand || subCommand === 'list') {
      const stored = new Map((await store.list()).map((row) => [row.id, row]));
      process.stdout.write('\n插件列表\n');
      for (const plugin of discovery.plugins) {
        const record = stored.get(plugin.manifest.id);
        const state = record?.state ?? 'NOT_INSTALLED';
        const enabled = record?.enabled ? 'enabled ' : 'disabled';
        process.stdout.write(
          `  ${plugin.manifest.id.padEnd(24)} v${plugin.manifest.version.padEnd(8)} ${enabled} ${DIM}${state}${RESET}\n`
        );
      }
      for (const item of discovery.invalid) {
        process.stdout.write(`  \u001b[31m${item.dir}（清单非法）\u001b[0m\n`);
      }
      process.stdout.write(`\n${DIM}提示：启停后需重启进程才能让路由变更生效（ADR-004）。${RESET}\n\n`);
      return 0;
    }

    const target = pluginId ?? '';
    const plugin = discovery.plugins.find((item) => item.manifest.id === target);
    if (!plugin) {
      process.stderr.write(`插件不存在：${target}\n`);
      return 1;
    }

    if (subCommand === 'enable') {
      await store.setEnabled(target, true);
      await store.setState(target, 'ENABLED');
      process.stdout.write(`已启用 ${target}，请重启进程使其生效。\n`);
      return 0;
    }

    if (subCommand === 'disable') {
      const enabledIds = new Set((await store.list()).filter((row) => row.enabled).map((row) => row.id));
      enabledIds.delete(target);
      const dependents = findDependents(discovery.plugins, target).filter((id) => enabledIds.has(id));
      if (dependents.length > 0) {
        process.stderr.write(
          `无法禁用 ${target}：以下已启用插件依赖它 —— ${dependents.join('、')}\n`
        );
        return 1;
      }
      await store.setEnabled(target, false);
      await store.setState(target, 'DISABLED');
      process.stdout.write(`已禁用 ${target}，请重启进程使其生效。\n`);
      return 0;
    }

    process.stderr.write(`未知子命令：plugin ${subCommand}\n`);
    return 1;
  } finally {
    await db.close().catch(() => undefined);
  }
}

/* ------------------------------ theme ------------------------------ */

async function runTheme(rootDir: string, subCommand: string | undefined, themeId?: string): Promise<number> {
  const config = loadConfig({ rootDir });
  const db = createDatabaseAdapter(config);
  if (!(await db.ping())) {
    process.stderr.write('无法连接数据库\n');
    await db.close();
    return 1;
  }

  const logger = createLogger({ level: 'warn' });
  const cache = new HtmlCache({ enabled: false, ttlSeconds: 0 });
  const manager = new ThemeManager({ config, logger, db, cache });

  try {
    await manager.sync();

    if (!subCommand || subCommand === 'list') {
      const rows = await db.query<{ active_theme_id: string | null }>(
        'SELECT active_theme_id FROM rn_site_state WHERE site_id = ? LIMIT 1',
        [config.site.id]
      );
      const activeId = rows[0]?.active_theme_id ?? null;

      process.stdout.write('\n主题列表\n');
      for (const theme of manager.listLoaded()) {
        const marker = theme.manifest.id === activeId ? '\u001b[32m●\u001b[0m' : '○';
        process.stdout.write(
          `  ${marker} ${theme.manifest.id.padEnd(20)} v${theme.manifest.version}\n`
        );
      }
      for (const invalid of manager.getInvalidThemes()) {
        process.stdout.write(`  \u001b[31m✗ ${invalid.dir}（校验未通过）\u001b[0m\n`);
      }
      process.stdout.write('\n');
      return 0;
    }

    if (!themeId) {
      process.stderr.write(`缺少主题 ID\n`);
      return 1;
    }

    if (subCommand === 'activate') {
      await manager.activate(themeId);
      process.stdout.write(`已激活主题 ${themeId}\n`);
      return 0;
    }

    if (subCommand === 'settings') {
      const theme = manager.getTheme(themeId);
      if (!theme) {
        process.stderr.write(`主题不存在：${themeId}\n`);
        return 1;
      }
      const { values, revision } = await manager.resolveSettings(theme);
      process.stdout.write(`\n主题 ${themeId} 设置（revision ${revision}）\n`);
      process.stdout.write(`${JSON.stringify(values, null, 2)}\n\n`);
      return 0;
    }

    process.stderr.write(`未知子命令：theme ${subCommand}\n`);
    return 1;
  } finally {
    await db.close().catch(() => undefined);
  }
}

void main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`命令执行失败：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
);
