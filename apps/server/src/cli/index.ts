#!/usr/bin/env node
/**
 * RiceNote CLI。
 *
 * 命令：
 *   validate                       校验插件/主题清单（无需数据库）
 *   migrate                        执行 Core 与插件迁移
 *   plugin list|enable|disable     插件状态管理
 *   plugin install|update|remove   插件安装与更新（与后台同一套编排）
 *   plugin updates|jobs            更新检查与任务历史
 *   theme  list|activate|settings  主题管理
 *   help                           显示帮助
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  APP_VERSION,
  AuditLogger,
  createDatabaseAdapter,
  createLogger,
  discoverPluginsFrom,
  findDependents,
  loadConfig,
  MigrationCoordinator,
  PluginInstallRunner,
  PluginStore,
  pluginDiscoveryRoots,
  readPluginMigrations,
  RestartCoordinator,
  resolveRootDir,
  ThemeManager,
  type InstallRunnerPluginPort,
  type InstallSourceInput,
  type JobSource,
  type RiceNoteConfig
} from '@ricenote/core';
import type { PluginJobDto } from '@ricenote/shared';
import { HtmlCache } from '@ricenote/core';
import { runValidate } from './validate.js';
import { runSetup } from './setup.js';

const DIM = '\u001b[2m';
const RESET = '\u001b[0m';
const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';

/** 插件根目录列表：官方插件目录 + 第三方安装目录 + 配置登记的本地开发目录。 */
/** 插件发现根目录（与内核启动、validate、向导共用同一个定义）。 */
function pluginRoots(config: RiceNoteConfig): string[] {
  return pluginDiscoveryRoots(config);
}

function printHelp(): void {
  process.stdout.write(`
RiceNote CLI

用法：ricenote <命令> [选项]

命令：
  validate                       校验插件与主题清单（不需要数据库）
  migrate                        执行 Core 与插件迁移（加锁串行）
  plugin list                    列出插件及其状态（含来源）
  plugin enable <pluginId>       启用插件（需重启进程生效）
  plugin disable <pluginId>      禁用插件（存在反向依赖时拒绝）

  plugin install <npm 包>        从 npm Registry 安装（如 ricenote-plugin-nav@^1.2.0）
  plugin install --git <仓库> [--ref <tag|分支|提交>]
  plugin install --dir <本地目录>
  plugin install --zip <压缩包路径>
  plugin update <pluginId>       按已记录的来源更新
  plugin remove <pluginId>       卸载（内置插件与存在依赖时拒绝）
  plugin updates                 检查全部插件是否有可用更新
  plugin jobs [jobId]            查看安装任务历史或某个任务的日志

  --no-scripts                   （install/update）禁止执行依赖安装脚本与构建脚本

  theme list                     列出主题
  theme activate <themeId>       激活主题
  theme settings <themeId>       打印主题的生效设置

环境：
  读取项目根目录的 .env 与系统环境变量（见 .env.example）
  私有源：RICENOTE_NPM_REGISTRY / RICENOTE_NPM_TOKEN
  本地开发目录：RICENOTE_LOCAL_PLUGINS（逗号分隔，改动即生效）
`);
}

async function main(): Promise<number> {
  const [, , command, subCommand, ...rest] = process.argv;
  /*
   * 与 HTTP 入口一致：向上查找项目根，兼容 pnpm 从包目录运行脚本。
   * `--root-dir` 可显式指定根目录（安装向导指向空白目录做演练、CI 隔离环境）。
   */
  const explicitRoot = process.argv.find((item) => item.startsWith('--root-dir='))?.slice(11);
  const rootDir = explicitRoot ? explicitRoot : resolveRootDir();

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }

  switch (command) {
    case 'validate': {
      const config = loadConfig({ rootDir, loadDotEnv: true });
      return runValidate({
        rootDir,
        pluginsDirs: pluginRoots(config),
        themesDir: config.paths.themesDir,
        officialDir: config.paths.pluginsDir,
        appVersion: APP_VERSION
      });
    }
    case 'setup':
      // 安装向导自带交互与错误呈现，这里只管把参数原样交给它
      return runSetup(rootDir, [subCommand, ...rest].filter((item): item is string => Boolean(item)));
    case 'migrate':
      return runMigrate(rootDir);
    case 'plugin':
      return runPlugin(rootDir, subCommand, rest);
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

    const discovery = discoverPluginsFrom(pluginRoots(config));
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

async function runPlugin(rootDir: string, subCommand: string | undefined, args: string[]): Promise<number> {
  const config = loadConfig({ rootDir });
  const db = createDatabaseAdapter(config);
  if (!(await db.ping())) {
    process.stderr.write('无法连接数据库\n');
    await db.close();
    return 1;
  }

  const logger = createLogger({ level: config.logLevel });
  const store = new PluginStore(db);
  const discovery = discoverPluginsFrom(pluginRoots(config));

  try {
    if (!subCommand || subCommand === 'list') {
      const stored = new Map((await store.list()).map((row) => [row.id, row]));
      process.stdout.write('\n插件列表\n');
      for (const plugin of discovery.plugins) {
        const record = stored.get(plugin.manifest.id);
        const state = record?.state ?? 'NOT_INSTALLED';
        const enabled = record?.enabled ? 'enabled ' : 'disabled';
        const source = record?.source
          ? `${DIM}${describeSourceLabel(record.source)}${RESET}`
          : `${DIM}来源未知${RESET}`;
        process.stdout.write(
          `  ${plugin.manifest.id.padEnd(24)} v${plugin.manifest.version.padEnd(8)} ${enabled} ${DIM}${state}${RESET}  ${source}\n`
        );
      }
      for (const item of discovery.invalid) {
        process.stdout.write(`  ${RED}${item.dir}（清单非法）${RESET}\n`);
      }
      process.stdout.write(`\n${DIM}提示：启停后需重启进程才能让路由变更生效（ADR-004）。${RESET}\n\n`);
      return 0;
    }

    if (subCommand === 'install') {
      /*
       * 必须是 `return await`：本函数在 `finally` 里关闭数据库，
       * 若直接 `return <promise>`，`finally` 会在**安装开始之前**就把连接关掉
       * （异步函数返回 promise 时先执行 finally 再等待该 promise）。
       */
      return await runPluginInstall(config, db, logger, store, discovery, args);
    }


    if (subCommand === 'update' || subCommand === 'remove') {
      const pluginId = args.find((item) => !item.startsWith('--')) ?? '';
      if (!pluginId) {
        process.stderr.write(`用法：plugin ${subCommand} <pluginId>\n`);
        return 1;
      }
      const allowScripts = !args.includes('--no-scripts');
      const rows = await store.list();
      const runner = await createInstallRunner(config, db, logger, store, discovery, rows);

      if (subCommand === 'update') {
        const source = updateSourceOf(rows, pluginId);
        if (!source) return 1;
        const job = await runner.submit({ action: 'update', pluginId, source, allowScripts });
        return await reportJob(runner, job, config);
      }

      const job = await runner.submit({ action: 'remove', pluginId });
      return await reportJob(runner, job, config);
    }

    if (subCommand === 'updates') {
      const runner = await createInstallRunner(config, db, logger, store, discovery);
      const report = await runner.checkUpdates();
      process.stdout.write('\n更新检查\n');
      for (const item of report.items) {
        const mark = item.updateAvailable ? `${YELLOW}可更新${RESET}` : `${DIM}已是最新${RESET}`;
        const detail = item.updateAvailable
          ? `→ ${item.latestVersion}`
          : item.checkable
            ? ''
            : `${DIM}不可检查${RESET}`;
        process.stdout.write(
          `  ${item.pluginId.padEnd(24)} ${(item.currentVersion ?? '-').padEnd(10)} ${mark} ${detail}\n`
        );
        if (item.note) process.stdout.write(`    ${DIM}${item.note}${RESET}\n`);
      }
      return 0;
    }

    if (subCommand === 'jobs') {
      const jobId = args.find((item) => !item.startsWith('--'));
      const runner = await createInstallRunner(config, db, logger, store, discovery);
      const jobs = jobId ? [await runner.get(jobId)] : await runner.list(20);

      process.stdout.write('\n安装任务\n');
      for (const job of jobs) {
        if (!job) continue;
        printJobLine(job);
        if (jobId) process.stdout.write(`${job.log}\n`);
      }
      return 0;
    }

    const target = args.find((item) => !item.startsWith('--')) ?? '';
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

/* --------------------------- plugin install --------------------------- */

/**
 * 组装安装任务执行器。
 *
 * CLI 是**独立进程**：没有运行中的内核，所以这里用数据库 + 插件目录快照
 * 拼出一个最小的插件端口（与后台共用同一个执行器，行为一致）。
 */
async function createInstallRunner(
  config: RiceNoteConfig,
  db: ReturnType<typeof createDatabaseAdapter>,
  logger: ReturnType<typeof createLogger>,
  store: PluginStore,
  discovery: ReturnType<typeof discoverPluginsFrom>,
  snapshot?: Awaited<ReturnType<PluginStore['list']>>
): Promise<PluginInstallRunner> {
  const rows = snapshot ?? (await store.list());
  const restart = new RestartCoordinator({ config, logger, db });
  const audit = new AuditLogger(db, config.site.id, logger);

  return new PluginInstallRunner({
    db,
    config,
    logger,
    plugins: buildPluginPort(store, discovery, rows),
    markRestartRequired: (input) =>
      restart.markRestartRequired({
        reason: input.reason,
        ...(input.actorId === undefined ? {} : { actorId: input.actorId })
      }),
    audit: (input) =>
      audit.record({
        action: input.action,
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.targetId === undefined ? {} : { targetType: 'plugin', targetId: input.targetId }),
        detail: input.detail
      })
  });
}

/**
 * 用「插件目录快照 + 数据库记录」实现编排器需要的最小端口。
 *
 * 快照是**调用前取的**：CLI 一次只跑一个任务，任务期间其他插件的启停状态
 * 不会变化，所以用快照判断"内置""已启用依赖"是准确的。
 */
function buildPluginPort(
  store: PluginStore,
  discovery: ReturnType<typeof discoverPluginsFrom>,
  snapshot: Awaited<ReturnType<PluginStore['list']>>
): InstallRunnerPluginPort {
  const byId = new Map(snapshot.map((row) => [row.id, row]));
  const enabledIds = new Set(snapshot.filter((row) => row.enabled).map((row) => row.id));

  return {
    summary: () =>
      discovery.plugins.map((plugin) => {
        const record = byId.get(plugin.manifest.id);
        return {
          id: plugin.manifest.id,
          version: plugin.manifest.version,
          builtin: plugin.builtin,
          dependents: findDependents(discovery.plugins, plugin.manifest.id).filter((id) =>
            enabledIds.has(id)
          ),
          ...(record?.source ? { source: record.source } : {})
        };
      }),
    recordSource: (pluginId, source, meta) => store.setSource(pluginId, source, meta),
    forget: (pluginId) => store.remove(pluginId)
  };
}

/** 更新时沿用已记录的来源；本地来源没有版本概念，因此拒绝自动更新。 */
function updateSourceOf(
  rows: Awaited<ReturnType<PluginStore['list']>>,
  pluginId: string
): InstallSourceInput | undefined {
  const record = rows.find((row) => row.id === pluginId);
  if (!record?.source) {
    process.stderr.write(
      `插件 ${pluginId} 没有来源记录（v0.4.0 之前安装），无法自动更新：请卸载后按来源重新安装。\n`
    );
    return undefined;
  }
  if (record.source.type === 'local') {
    process.stderr.write(
      `插件 ${pluginId} 来自本地目录，不参与版本管理：请直接更新源目录（开发期改动即生效）。\n`
    );
    return undefined;
  }
  return record.source.type === 'registry'
    ? { type: 'registry', spec: record.source.spec }
    : { type: 'git', repo: record.source.spec, ref: record.source.ref ?? 'HEAD' };
}

/** 从命令行参数构造安装来源。 */
function parseInstallArgs(args: string[]): JobSource {
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const git = flag('--git');
  if (git) return { type: 'git', repo: git, ref: flag('--ref') ?? 'HEAD' };

  const dir = flag('--dir');
  if (dir) return { type: 'directory', path: dir };

  const zip = flag('--zip');
  if (zip) {
    if (!existsSync(zip)) {
      throw new Error(`压缩包不存在：${zip}`);
    }
    return { type: 'zip', fileName: zip, archive: readFileSync(zip) };
  }

  const spec = args.find((item) => !item.startsWith('--'));
  if (!spec) {
    throw new Error(
      '缺少安装来源。用法：plugin install <npm 包> | --git <仓库> [--ref <引用>] | --dir <目录> | --zip <压缩包>'
    );
  }
  return { type: 'registry', spec };
}

async function runPluginInstall(
  config: RiceNoteConfig,
  db: ReturnType<typeof createDatabaseAdapter>,
  logger: ReturnType<typeof createLogger>,
  store: PluginStore,
  discovery: ReturnType<typeof discoverPluginsFrom>,
  args: string[]
): Promise<number> {
  let source: JobSource;
  try {
    source = parseInstallArgs(args);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const runner = await createInstallRunner(config, db, logger, store, discovery);
  const job = await runner.submit({
    action: 'install',
    source,
    allowScripts: !args.includes('--no-scripts')
  });

  return reportJob(runner, job, config);
}

/** 轮询任务直到结束，实时打印日志。 */
async function reportJob(
  runner: PluginInstallRunner,
  job: PluginJobDto,
  config: RiceNoteConfig
): Promise<number> {
  let printed = 0;
  let lastProgress = -1;

  process.stdout.write(`\n任务 ${job.id}（${job.action}）已提交\n`);

  for (;;) {
    const current = await runner.get(job.id);
    if (!current) {
      process.stderr.write('任务记录丢失\n');
      return 1;
    }

    const lines = current.log.split('\n').filter((line) => line.length > 0);
    for (; printed < lines.length; printed += 1) {
      process.stdout.write(`  ${DIM}│${RESET} ${lines[printed]}\n`);
    }

    if (current.progress !== lastProgress) {
      lastProgress = current.progress;
      process.stdout.write(`  ${DIM}${current.step ?? ''} ${current.progress}%${RESET}\n`);
    }

    if (current.status === 'succeeded' || current.status === 'failed') {
      if (current.status === 'succeeded') {
        process.stdout.write(
          `${GREEN}✔${RESET} 完成：${current.pluginId ?? ''}。\n${DIM}提示：安装/更新/卸载都需要重启服务才能生效（ADR-012）。${RESET}\n`
        );
        return 0;
      }
      process.stderr.write(`${RED}✘ 失败${RESET}：${current.error ?? '未知错误'}\n`);
      return 1;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

function printJobLine(job: PluginJobDto): void {
  const color = job.status === 'failed' ? RED : job.status === 'succeeded' ? GREEN : DIM;
  process.stdout.write(
    `  ${job.id}  ${job.action.padEnd(8)} ${color}${job.status.padEnd(10)}${RESET} ${(job.pluginId ?? '-').padEnd(20)} ${job.progress}%  ${job.startedAt}\n`
  );
}

function describeSourceLabel(source: { type: string; spec: string; ref?: string }): string {
  if (source.type === 'registry') return `npm:${source.spec}`;
  if (source.type === 'git') return `git:${source.spec}#${source.ref ?? 'HEAD'}`;
  return `local:${source.spec}`;
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
