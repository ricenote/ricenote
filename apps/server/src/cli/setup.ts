/**
 * `ricenote setup` —— 交互式安装向导（ADR-016）。
 *
 * 一条命令走完：环境检查 → 数据库（可自动建库）→ 站点与管理员 → 写 `.env`
 * → 内核迁移 → **勾选官方插件并从 npm 安装** → 首次启动（建管理员、启用插件）
 * → 输出后续步骤。
 *
 * 三条不可动摇的性质：
 * 1. **可重入**：已存在的 `.env` 作为默认值沿用，已安装的插件跳过，
 *    任何一步失败都可以修好后重跑（安装编排自带串行与回滚）；
 * 2. **无 TTY 可用**：`--yes` 与显式参数覆盖全部交互，容器构建不依赖终端；
 * 3. **不做半成品**：Core 迁移在安装之前完成（否则 `rn_plugins` 还不存在），
 *    必需插件安装失败直接以非零退出码结束并给出修复指引。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  APP_VERSION,
  bootstrap,
  createDatabaseAdapter,
  detectToolchain,
  ensureDatabase,
  loadConfig,
  MigrationCoordinator,
  PluginInstallRunner,
  PluginStore,
  discoverPluginsFrom,
  pluginDiscoveryRoots,
  validateDatabaseName,
  type InstallRunnerPluginPort,
  type Logger,
  type RiceNoteConfig
} from '@ricenote/core';
import type { PluginJobDto } from '@ricenote/shared';
import {
  findCatalogEntryById,
  findCatalogEntryByNpm,
  getPluginCatalog,
  requiredCatalogEntries,
  withRequiredDependencies,
  type PluginCatalogEntry
} from '@ricenote/shared';
import { Prompter, SetupInputError } from './prompts.js';
import {
  buildDatabaseUrl,
  envFilePath,
  generateAdminPassword,
  generateSessionSecret,
  readEnvFile,
  upsertEnvFile
} from './setup-env.js';

const USAGE = `
用法：pnpm run setup [选项]        # 脚本形式（等价：pnpm ricenote setup，需先 pnpm build）
       pnpm run setup -- --yes    # 传参数时用 -- 分隔，之后的值原样交给向导

  --yes                 采用默认值/推荐档，全程不提问（容器与 CI 用）
  --plugins=<列表>      指定要安装的插件（ID / npm 包名 / 短名，逗号分隔）
  --from-manifest       按 .env 中已有的 RICENOTE_PLUGINS 补齐缺失插件
  --skip-install        只准备环境与数据库，不安装插件
  --force-env           覆盖已有 .env 中的值（默认沿用为默认值）
  --no-scripts          安装时不执行依赖安装脚本与构建脚本
  --db-url=<连接串>     mysql://user:pass@host:port/name
  --db-host/--db-port/--db-user/--db-password/--db-name
  --site-title/--site-url/--site-language
  --admin-username/--admin-password/--admin-email
  --help                显示本帮助
`;

interface SetupOptions {
  help: boolean;
  yes: boolean;
  forceEnv: boolean;
  skipInstall: boolean;
  fromManifest: boolean;
  allowScripts: boolean;
  plugins: string[];
  db: { host?: string; port?: number; user?: string; password?: string; name?: string };
  site: { title?: string; url?: string; language?: string };
  admin: { username?: string; password?: string; email?: string };
}

const TIMEOUT_MS = 15 * 60 * 1000;

export function parseSetupArgs(argv: readonly string[]): SetupOptions {
  const options: SetupOptions = {
    help: argv.includes('--help') || argv.includes('-h'),
    yes: argv.includes('--yes') || argv.includes('-y'),
    forceEnv: argv.includes('--force-env'),
    skipInstall: argv.includes('--skip-install'),
    fromManifest: argv.includes('--from-manifest'),
    allowScripts: !argv.includes('--no-scripts'),
    plugins: [],
    db: {},
    site: {},
    admin: {}
  };

  const valueOf = (name: string): string | undefined => {
    const inline = argv.find((item) => item.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const plugins = valueOf('--plugins');
  if (plugins) {
    options.plugins = plugins.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  }

  const dbUrl = valueOf('--db-url');
  if (dbUrl) {
    const parsed = parseDatabaseUrlLoose(dbUrl);
    options.db = { ...options.db, ...parsed };
  }

  options.db.host = valueOf('--db-host') ?? options.db.host;
  options.db.user = valueOf('--db-user') ?? options.db.user;
  options.db.password = valueOf('--db-password') ?? options.db.password;
  options.db.name = valueOf('--db-name') ?? options.db.name;
  const port = valueOf('--db-port');
  if (port) options.db.port = Number.parseInt(port, 10);

  options.site.title = valueOf('--site-title');
  options.site.url = valueOf('--site-url');
  options.site.language = valueOf('--site-language');

  options.admin.username = valueOf('--admin-username');
  options.admin.password = valueOf('--admin-password');
  options.admin.email = valueOf('--admin-email');

  return options;
}

/** 宽松解析 `mysql://user:pass@host:port/name`（缺项留空，由后续默认值补齐）。 */
function parseDatabaseUrlLoose(url: string): SetupOptions['db'] {
  const match = /^mysql:\/\/(?:([^:@]*)(?::([^@]*))?@)?([^:/]+)(?::(\d+))?\/([^?]+)/.exec(url.trim());
  if (!match) return {};
  return {
    user: match[1] ? decodeURIComponent(match[1]) : undefined,
    password: match[2] === undefined ? undefined : decodeURIComponent(match[2]),
    host: match[3],
    ...(match[4] ? { port: Number.parseInt(match[4], 10) } : {}),
    name: match[5] ? decodeURIComponent(match[5]) : undefined
  };
}

/** 安装向导主流程，返回进程退出码。 */
export async function runSetup(rootDir: string, argv: readonly string[]): Promise<number> {
  const options = parseSetupArgs(argv);
  const io = new Prompter({ interactive: options.yes ? false : undefined });

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  process.stdout.write(`\nRiceNote 安装向导  ${APP_VERSION}\n`);
  io.info(`根目录：${rootDir}`);

  try {
    const envFile = envFilePath(rootDir);
    const existing = readEnvFile(envFile);
    const hasEnv = existsSync(envFile);
    if (hasEnv && !options.forceEnv) {
      io.skip('检测到已有 .env：其中的值将作为默认值沿用（--force-env 可全部重填）');
    }

    /* ---------------------------- 1) 环境检查 ---------------------------- */
    io.section('环境检查');
    const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
    if (nodeMajor < 20) {
      io.error(`Node.js 版本过低（当前 ${process.versions.node}，需要 >= 20.11）`);
      return 1;
    }
    io.success(`Node.js ${process.versions.node}`);

    const toolchain = await detectToolchain();
    if (toolchain.packageManager) {
      io.success(`包管理器：${toolchain.packageManager.kind}`);
    } else {
      io.warn('未找到 pnpm/npm：从 npm 安装插件需要它（请先安装 Node.js 自带的 npm）');
    }

    /* ---------------------------- 2) 数据库 ---------------------------- */
    io.section('数据库');
    const db = {
      host:
        options.db.host ??
        (await io.text('主机', { defaultValue: existing.DB_HOST ?? '127.0.0.1', required: true })),
      port:
        options.db.port ??
        Number.parseInt(
          await io.text('端口', { defaultValue: existing.DB_PORT ?? '3306', required: true }),
          10
        ),
      user:
        options.db.user ??
        (await io.text('用户名', { defaultValue: existing.DB_USER ?? 'root', required: true })),
      password:
        options.db.password ??
        (await io.text('密码', { defaultValue: existing.DB_PASSWORD ?? '', secret: true })),
      name:
        options.db.name ??
        (await io.text('数据库名', {
          defaultValue: existing.DB_NAME ?? 'ricenote',
          required: true,
          validate: (value) => validateDatabaseName(value)
        }))
    };

    const ensured = await ensureDatabase({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      name: db.name
    });
    io.success(
      ensured.created ? `已创建数据库 ${db.name}（utf8mb4）` : `已连接数据库 ${db.name}`
    );

    /* ------------------------- 3) 站点与管理员 ------------------------- */
    io.section('站点与管理员');
    const site = {
      title:
        options.site.title ??
        (await io.text('站点名称', { defaultValue: existing.SITE_TITLE ?? 'RiceNote', required: true })),
      url:
        options.site.url ??
        (await io.text('站点地址', {
          defaultValue: existing.SITE_URL ?? 'http://localhost:3000',
          required: true,
          validate: (value) => (/^https?:\/\//.test(value) ? undefined : '必须以 http:// 或 https:// 开头')
        })),
      language:
        options.site.language ??
        (await io.text('站点语言', { defaultValue: existing.SITE_LANGUAGE ?? 'zh-CN', required: true }))
    };

    /*
     * 初始管理员密码：交互模式让用户自己填；`--yes`（或非交互）自动生成，
     * 并在最后一次性打印 —— 默认密码是安全债，随机密码至少不会长期存在。
     */
    const generatedPassword = options.admin.password ? undefined : generateAdminPassword();
    const adminPassword =
      options.admin.password ??
      (await io.text('管理员密码', {
        defaultValue: generatedPassword,
        secret: true,
        required: true,
        validate: (value) =>
          value.length < 8
            ? '至少 8 位'
            : /^\d+$/.test(value)
              ? '不能是纯数字'
              : undefined
      }));
    const admin = {
      username:
        options.admin.username ??
        (await io.text('管理员账号', { defaultValue: existing.BOOTSTRAP_ADMIN_USERNAME ?? 'admin', required: true })),
      email:
        options.admin.email ??
        (await io.text('管理员邮箱', { defaultValue: existing.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@example.com', required: true })),
      password: adminPassword
    };
    io.success(`站点「${site.title}」· ${site.url} · ${site.language}`);
    io.success(`管理员账号 ${admin.username}（${admin.email}）`);

    /* ---------------------------- 4) 写入 .env ---------------------------- */
    io.section('写入配置');
    const sessionSecret =
      existing.SESSION_SECRET && existing.SESSION_SECRET !== 'change-me-in-production' && !options.forceEnv
        ? existing.SESSION_SECRET
        : generateSessionSecret();

    const writeResult = upsertEnvFile(
      envFile,
      [
        { key: 'NODE_ENV', value: existing.NODE_ENV ?? 'development' },
        { key: 'LOG_LEVEL', value: existing.LOG_LEVEL ?? 'info' },
        { key: 'SITE_URL', value: site.url },
        { key: 'DATABASE_URL', value: buildDatabaseUrl(db) },
        { key: 'DB_HOST', value: db.host },
        { key: 'DB_PORT', value: String(db.port) },
        { key: 'DB_USER', value: db.user },
        { key: 'DB_PASSWORD', value: db.password },
        { key: 'DB_NAME', value: db.name },
        { key: 'SESSION_SECRET', value: sessionSecret },
        { key: 'BOOTSTRAP_ADMIN_USERNAME', value: admin.username },
        { key: 'BOOTSTRAP_ADMIN_PASSWORD', value: admin.password },
        { key: 'BOOTSTRAP_ADMIN_EMAIL', value: admin.email },
        { key: 'SITE_TITLE', value: site.title },
        { key: 'SITE_LANGUAGE', value: site.language },
        { key: 'PLUGINS_DIR', value: existing.PLUGINS_DIR ?? './plugins/official' },
        { key: 'THEMES_DIR', value: existing.THEMES_DIR ?? './themes' }
      ],
      { header: '# 以下键由 ricenote setup 维护' }
    );
    io.success(`已写入 .env（更新 ${writeResult.updated.length} 项、新增 ${writeResult.added.length} 项）`);

    const config = loadConfig({ rootDir });
    /*
     * 向导自己负责输出（分节 + 勾选 + 摘要），安装细节通过任务日志呈现；
     * 因此这里用**静默日志器**：混进结构化 JSON 日志只会淹没向导。
     */
    const logger = silentLogger();
    const adapter = createDatabaseAdapter(config);
    if (!(await adapter.ping())) {
      io.error('写入配置后仍无法连接数据库，请检查 .env 中的 DB_* 配置');
      await adapter.close();
      return 1;
    }

    /* --------------------------- 5) 内核迁移 --------------------------- */
    io.section('数据库结构');
    const migrations = new MigrationCoordinator(config, logger);
    await migrations.ensureLedger();
    if (!(await migrations.acquireLock())) {
      io.error('迁移锁被占用（另一个实例正在迁移），请稍后重试');
      await adapter.close();
      return 1;
    }
    try {
      const core = await migrations.applyCore();
      io.success(`Core 迁移：新增 ${core.applied.length} 项、跳过 ${core.skipped.length} 项`);
    } finally {
      await migrations.releaseLock().catch(() => undefined);
    }

    /* --------------------------- 6) 选择插件 --------------------------- */
    const catalogEntries = options.skipInstall
      ? []
      : await selectPlugins(io, options, envFilePath(rootDir));
    const installed: PluginCatalogEntry[] = [];
    const skipped: string[] = [];
    const failed: { entry: PluginCatalogEntry; reason: string }[] = [];

    if (!options.skipInstall && catalogEntries.length > 0) {
      io.section('安装插件');

      const discovery = discoverPluginsFrom(pluginDiscoveryRoots(config));
      const known = new Set(discovery.plugins.map((plugin) => plugin.manifest.id));
      const store = new PluginStore(adapter);
      const runner = new PluginInstallRunner({
        db: adapter,
        config,
        logger,
        plugins: buildPluginPort(store, discovery),
        markRestartRequired: async () => undefined
      });

      for (const entry of catalogEntries) {
        if (known.has(entry.id)) {
          io.skip(`${entry.label}（${entry.id}）已存在，跳过`);
          skipped.push(entry.id);
          continue;
        }
        const result = await installFromRegistry(runner, entry, io, options.allowScripts);
        if (!result) {
          failed.push({ entry, reason: '安装失败（详见上方日志）' });
          continue;
        }

        /*
         * **安装后必须显式启用**。
         *
         * `RICENOTE_SEED_PLUGINS` 只在插件**首次被发现**（数据库里还没有记录）时生效，
         * 而安装器已经先写入了 `enabled = 0` 的记录 —— 于是种子永远不会命中，
         * 结果是"装好了却一个都没启用"，首次启动看到零个插件生效。
         */
        await store.setEnabled(entry.id, true);
        installed.push(entry);
        io.success(`${entry.label} 已安装并启用`);
      }
    }

    const requiredFailures = failed.filter((item) => item.entry.category === 'required');

    /* ---------------------- 7) 写入插件声明式清单 ---------------------- */
    const successful = [...installed, ...skipped.map((id) => findCatalogEntryById(id)).filter((item): item is PluginCatalogEntry => item !== undefined)];
    if (successful.length > 0) {
      upsertEnvFile(envFilePath(rootDir), [
        {
          key: 'RICENOTE_PLUGINS',
          value: successful.map((entry) => `${entry.npm}@${entry.version}`).join(',')
        },
        {
          // 兼容键：既有部署与首次启用逻辑仍在用短名列表
          key: 'RICENOTE_SEED_PLUGINS',
          value: successful
            .map((entry) => entry.id.split('.').pop() as string)
            .join(',')
        }
      ]);
      io.success(`已写入 RICENOTE_PLUGINS（${successful.length} 项）`);
    }

    /* --------------------------- 8) 首次启动 --------------------------- */
    let themeMissing = false;
    if (!options.skipInstall) {
      io.section('初始化');
      // 关掉向导自己的连接池：bootstrap 会建立自己的连接
      await adapter.close();

      /*
       * 主题是**启动前**的硬前提：内核激活主题失败会直接拒绝启动。
       * 全新部署时 themes/ 通常是空的，所以先查一次并给出可操作指引，
       * 而不是等 bootstrap 抛一句"没有任何可用主题"。
       */
      const themes = discoverThemes(config.paths.themesDir);
      if (themes.length === 0) {
        themeMissing = true;
        io.warn(`主题目录为空（${config.paths.themesDir}）`);
        io.info('内核需要至少一个可用主题才能启动。请任选其一：');
        io.info('  · 把主题目录放到 themes/（需含 theme.json）');
        io.info('  · 或执行 pnpm theme install <主题包.zip>');
        io.info('安装主题后重跑本命令（已完成的步骤会被跳过）');
      } else {
        io.success(`可用主题：${themes.join('、')}`);
        const kernel = await bootstrap({
          rootDir,
          // 启动横幅与 info 日志会打断向导的输出节奏，压到 error
          overrides: { logLevel: 'error' }
        });

        /*
         * 只报**事实**：把"期望安装的插件"与"真正启动的插件"对照。
         *
         * 这一步是被一次真实事故换来的：插件装好但没启用时，内核会以
         * "0 个插件生效"正常启动，向导却照样打印"管理员已就绪" ——
         * 用户拿到的是一个进不去的后台，且毫无线索。
         */
        const startedIds = new Set(kernel.pluginReport.started);
        const notStarted = catalogEntries.filter((entry) => !startedIds.has(entry.id));
        const failures = new Map(
          kernel.plugins.summary().map((plugin) => [plugin.id, plugin.lastError])
        );

        io.success(`内核已启动：插件 ${startedIds.size} 个已生效`);
        for (const entry of notStarted) {
          const reason = failures.get(entry.id);
          io.error(`${entry.label}（${entry.id}）未启动${reason ? `：${reason}` : ''}`);
          if (!failed.some((item) => item.entry.id === entry.id)) {
            failed.push({ entry, reason: reason ?? '插件未启动' });
          }
        }

        if (startedIds.has('rice.identity')) {
          io.success(`管理员 ${admin.username} 已就绪`);
        } else {
          io.error('身份插件未启动，初始管理员尚未创建');
        }
        await kernel.shutdown();
      }
    } else {
      await adapter.close();
    }

    /* ---------------------------- 9) 结果摘要 ---------------------------- */
    io.section('完成');
    io.info(`已安装 ${installed.length} 项，跳过 ${skipped.length} 项，失败 ${failed.length} 项`);
    for (const item of failed) io.error(`${item.entry.label}（${item.entry.id}）：${item.reason}`);
    io.info('');
    io.info(`后台地址：${site.url.replace(/\/+$/, '')}/admin/`);
    io.info(`登录账号：${admin.username}`);
    if (generatedPassword !== undefined && admin.password === generatedPassword) {
      io.warn(`初始密码（仅本次显示，请立即保存）：${generatedPassword}`);
    }
    io.info('');
    io.info('后续步骤：');
    io.info('  1) pnpm build        # 若尚未构建过前台与后台产物');
    io.info('  2) pnpm start        # 启动服务');
    io.info('  3) 插件更新：后台「扩展中心 → 官方插件目录」或 pnpm plugin updates');

    if (themeMissing) {
      io.error('尚未安装任何主题：站点无法启动，请先安装主题后重跑本命令');
      return 1;
    }
    if (requiredFailures.length > 0) {
      io.error(
        `必需插件安装失败：${requiredFailures
          .map((item) => item.entry.id)
          .join('、')}。缺它们无法登录后台，请修好网络/权限后重跑 pnpm ricenote setup`
      );
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof SetupInputError) {
      io.error(error.message);
    } else {
      io.error(error instanceof Error ? error.message : String(error));
    }
    process.stdout.write(USAGE);
    return 1;
  } finally {
    io.close();
  }
}

/* ------------------------------ 内部实现 ------------------------------ */

/** 按选项/交互结果解析出要安装的清单条目（必需项锁定，含依赖闭包）。 */
async function selectPlugins(
  io: Prompter,
  options: SetupOptions,
  envFile: string
): Promise<PluginCatalogEntry[]> {
  const catalog = getPluginCatalog();
  const required = requiredCatalogEntries();

  if (options.plugins.length > 0) {
    return resolveRequested(options.plugins);
  }

  if (options.fromManifest) {
    const declared = readEnvFile(envFile).RICENOTE_PLUGINS;
    if (!declared) {
      io.warn('RICENOTE_PLUGINS 为空，改为按推荐档选择');
    } else {
      const requested = declared
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => item.split('@').slice(0, item.startsWith('@') ? 2 : 1).join('@'));
      io.info(`按 .env 清单补齐：${requested.length} 项`);
      return resolveRequested(requested);
    }
  }

  if (options.yes) {
    const recommended = catalog.plugins.filter((entry) => entry.category === 'recommended');
    io.section('插件选择');
    io.info(`--yes：采用推荐档（必需 ${required.length} 项 + 推荐 ${recommended.length} 项）`);
    return withRequiredDependencies([...required, ...recommended].map((entry) => entry.id));
  }

  io.section('插件选择');
  io.info('必需插件无法取消（缺 identity 无法登录，缺 authorization 权限校验全拒）');
  const selected = await io.multiSelect(
    '选择要安装的官方插件：',
    catalog.plugins.map((entry) => ({
      value: entry.id,
      label: `${entry.label}（${entry.npm}）v${entry.version}`,
      hint: entry.description.slice(0, 40),
      locked: entry.category === 'required',
      checked: entry.category === 'required' || entry.category === 'recommended'
    }))
  );

  return withRequiredDependencies(selected);
}

/** 把用户输入（ID / npm 包名 / 短名）解析成清单条目。 */
function resolveRequested(values: readonly string[]): PluginCatalogEntry[] {
  const catalog = getPluginCatalog();
  const ids: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const withoutVersion = trimmed.replace(/@[^@/]+$/, '');
    const entry =
      findCatalogEntryById(trimmed) ??
      findCatalogEntryByNpm(trimmed) ??
      findCatalogEntryByNpm(withoutVersion) ??
      catalog.plugins.find((item) => item.id.endsWith(`.${trimmed}`));

    if (!entry) {
      throw new Error(
        `未知插件：${trimmed}（可用：${catalog.plugins.map((item) => item.id).join('、')}）`
      );
    }
    ids.push(entry.id);
  }

  /*
   * **必需插件始终并入**：用户可以只指定 `--plugins=posts`，
   * 但缺 identity 没有登录端点、缺 authorization 权限校验全拒 ——
   * 那不是"精简安装"，而是一个装完就进不去的后台。
   * 只靠"依赖闭包"不够：posts 只声明依赖 identity，authorization 不会被带上。
   */
  return withRequiredDependencies([
    ...requiredCatalogEntries().map((entry) => entry.id),
    ...ids
  ]);
}

/** 从 registry 安装一个清单条目，返回是否成功。 */
async function installFromRegistry(
  runner: PluginInstallRunner,
  entry: PluginCatalogEntry,
  io: Prompter,
  allowScripts: boolean
): Promise<boolean> {
  const spec = `${entry.npm}@${entry.version}`;
  io.info(`安装 ${entry.label}（${spec}）`);

  const job = await runner.submit({
    action: 'install',
    source: { type: 'registry', spec },
    allowScripts
  });

  const finished = await waitForJob(runner, job, io);
  if (finished.status === 'succeeded') {
    io.success(`${entry.label} 已安装`);
    return true;
  }
  io.error(`${entry.label} 安装失败：${finished.error ?? '未知原因'}`);
  return false;
}

/** 轮询任务直到结束（安装是串行的，这里只做等待与日志呈现）。 */
async function waitForJob(
  runner: PluginInstallRunner,
  job: PluginJobDto,
  io: Prompter
): Promise<PluginJobDto> {
  const started = Date.now();
  let current = job;
  let lastStep = '';

  while (current.status === 'queued' || current.status === 'running') {
    if (Date.now() - started > TIMEOUT_MS) {
      io.error(`任务超时（${Math.round(TIMEOUT_MS / 60000)} 分钟）`);
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const next = await runner.get(job.id);
    if (!next) continue;
    current = next;
    if (current.step && current.step !== lastStep) {
      lastStep = current.step;
      io.info(`  步骤 ${current.step}（${current.progress}%）`);
    }
  }

  const tail = current.log.split('\n').filter((line) => line.trim().length > 0).slice(-6);
  for (const line of tail) io.info(`  \u001b[2m${line}\u001b[0m`);
  return current;
}

/**
 * 只读的插件端口：向导在一次运行内不需要热更新，快照足够。
 */
function buildPluginPort(
  store: PluginStore,
  discovery: ReturnType<typeof discoverPluginsFrom>
): InstallRunnerPluginPort {
  return {
    summary: () =>
      discovery.plugins.map((plugin) => ({
        id: plugin.manifest.id,
        version: plugin.manifest.version,
        builtin: plugin.builtin,
        dependents: []
      })),
    recordSource: (pluginId, source, meta) => store.setSource(pluginId, source, meta),
    forget: (pluginId) => store.remove(pluginId)
  };
}

/** 供测试与诊断使用：导出向导用到的库名校验（与 core 同一份实现）。 */
export { validateDatabaseName };

/** 静默日志器：向导自己输出，内部日志不参与。 */
function silentLogger(): Logger {
  const noop = (): void => undefined;
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger
  };
  return logger;
}

/**
 * 列出可用的主题（`themes/<dir>/theme.json`）。
 *
 * 只用于"全新部署时提前告知缺主题"这一件事：内核激活主题失败会直接拒绝启动，
 * 而全新目录里 `themes/` 通常是空的 —— 与其在最后抛一句抽象错误，
 * 不如在初始化前就说清楚要装什么。
 */
function discoverThemes(themesDir: string): string[] {
  if (!existsSync(themesDir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(themesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const manifestPath = path.join(themesDir, entry.name, 'theme.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
      names.push(manifest.name ?? entry.name);
    } catch {
      names.push(entry.name);
    }
  }
  return names;
}
