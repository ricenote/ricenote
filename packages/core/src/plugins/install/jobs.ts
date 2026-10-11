/**
 * 插件安装任务队列（安装 / 更新 / 卸载）与更新检查。
 *
 * 为什么需要队列而不是"请求里直接装"：
 * - 安装会**改磁盘**（写 plugins 目录、装依赖、跑构建），并发执行必然互相踩踏；
 * - 一次安装可能几十秒到几分钟，HTTP 请求不该一直挂着；
 * - 失败原因与过程日志必须留在服务端可查（后台刷新页面后还能看到上次装到哪一步）。
 *
 * 因此：`submit()` 立刻返回任务记录，真正的执行在本进程内**串行**进行。
 */

import { randomBytes } from 'node:crypto';
import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import {
  ErrorCode,
  RiceNoteError,
  type PluginJobAction,
  type PluginJobDto,
  type PluginJobStatus,
  type PluginJobStep,
  type PluginSourceInfo,
  type PluginUpdateInfo,
  type PluginUpdateReport
} from '@ricenote/shared';
import type { RiceNoteConfig } from '../../config/loader.js';
import type { DatabaseAdapter } from '../../database/adapter.js';
import type { Logger } from '../../logger.js';
import { shortName, type PluginManager } from '../manager.js';
import { installPlugin, type InstallProgress } from './orchestrator.js';
import { parsePackageSpec, pickVersion, validateGitRepo } from './sources.js';
import { detectToolchain, requireGit, runCommand } from './toolchain.js';
import type { InstallSourceInput } from './sources.js';

/** 任务可执行的来源（比 `InstallSourceInput` 多一个"带缓冲区的压缩包"）。 */
export type JobSource =
  | InstallSourceInput
  | { type: 'zip'; fileName: string; archive: Buffer };

/** 编排器需要知道的"已安装插件"信息（比 `PluginSummary` 窄）。 */
export interface InstalledPluginInfo {
  id: string;
  version: string;
  builtin: boolean;
  dependents: string[];
  source?: PluginSourceInfo;
}

/**
 * 编排器对插件管理器的**最小依赖**。
 *
 * 刻意收窄成端口而不是直接依赖 `PluginManager`：后台在进程内跑（有完整管理器），
 * 而 CLI 是**独立进程**（没有运行中的内核，只有数据库与插件目录），
 * 二者需要的是同一件事 —— 读插件摘要、写来源、忘掉已卸载的插件。
 * `PluginManager` 结构上天然满足这个端口。
 */
export interface InstallRunnerPluginPort {
  summary(): InstalledPluginInfo[];
  /**
   * 写来源元数据。
   *
   * `meta` 用于"内核还没见过这个插件"的场景（装完还没重启）：此时数据库里
   * 没有记录，只做 UPDATE 会把来源丢掉，因此实现方需要补一条最小记录。
   */
  recordSource(
    pluginId: string,
    source: PluginSourceInfo | undefined,
    meta?: { name?: string; version?: string; dir?: string }
  ): Promise<void>;
  forget(pluginId: string): Promise<void>;
}

export interface PluginInstallRunnerDeps {
  db: DatabaseAdapter;
  config: RiceNoteConfig;
  logger: Logger;
  plugins: InstallRunnerPluginPort;
  /** 安装/更新/卸载后都需重启才生效（ADR-004 / ADR-012）。 */
  markRestartRequired: (input: { reason: string; actorId?: number }) => Promise<void>;
  /** 审计写入口（CLI 场景可能没有 actor，故为可选）。 */
  audit?: (input: {
    action: string;
    actorId?: number;
    targetId?: string;
    detail: Record<string, unknown>;
  }) => Promise<void>;
}

export interface SubmitJobInput {
  /** 卸载任务没有来源（它操作的是已安装目录），因此可选。 */
  source?: JobSource;
  action: PluginJobAction;
  /** 更新/卸载时的目标插件；安装时为空（解析后才能知道）。 */
  pluginId?: string;
  actorId?: number;
  allowScripts?: boolean;
}

/** 日志保留上限：任务面板看的是"最近的输出"，不需要完整历史。 */
const MAX_LOG_BYTES = 64 * 1024;
/** 日志/进度落库的最小间隔（避免每行日志都写一次数据库）。 */
const FLUSH_INTERVAL_MS = 600;

interface JobRow {
  id: string;
  plugin_id: string | null;
  action: string;
  source_json: string | Record<string, unknown>;
  status: string;
  step: string | null;
  progress: number;
  log_text: string | null;
  error: string | null;
  actor_id: number | null;
  started_at: Date | string;
  finished_at: Date | string | null;
}

export class PluginInstallRunner {
  private readonly jobs: PluginJobStore;
  /** 串行队列的尾指针：所有任务按提交顺序排队执行。 */
  private tail: Promise<void> = Promise.resolve();
  /** 正在排队/执行的任务键，用于拒绝重复提交。 */
  private readonly activeKeys = new Set<string>();

  constructor(private readonly deps: PluginInstallRunnerDeps) {
    this.jobs = new PluginJobStore(deps.db);
  }

  /**
   * 提交任务。立即返回任务记录，执行在后台串行进行。
   *
   * 重复提交（同一来源 + 同一动作仍在队列中）会被拒绝：重复点"安装"不该
   * 产生两次落盘，否则第二个任务会覆盖第一个刚装好的目录。
   */
  async submit(input: SubmitJobInput): Promise<PluginJobDto> {
    const key = `${input.action}:${input.source ? sourceKey(input.source) : '-'}:${input.pluginId ?? ''}`;
    if (this.activeKeys.has(key)) {
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        '同一插件的同类任务正在进行中，请等待其完成。',
        { status: 409 }
      );
    }

    const job = await this.jobs.create({
      pluginId: input.pluginId ?? null,
      action: input.action,
      source: input.source ? describeJobSource(input.source) : null,
      actorId: input.actorId ?? null
    });

    this.activeKeys.add(key);
    this.tail = this.tail.then(async () => {
      try {
        await this.run(job.id, input);
      } finally {
        this.activeKeys.delete(key);
      }
    });

    return job;
  }

  async get(jobId: string): Promise<PluginJobDto | undefined> {
    return this.jobs.get(jobId);
  }

  async list(limit = 20): Promise<PluginJobDto[]> {
    return this.jobs.list(limit);
  }

  /** 是否有任务在执行（CLI 退出前与后台提示用）。 */
  get busy(): boolean {
    return this.activeKeys.size > 0;
  }

  /* ------------------------------- 执行 ------------------------------- */

  private async run(jobId: string, input: SubmitJobInput): Promise<void> {
    const { logger } = this.deps;
    const collected: string[] = [];
    let lastFlush = 0;

    const flush = async (patch: Parameters<PluginJobStore['update']>[1]): Promise<void> => {
      await this.jobs.update(jobId, patch);
    };

    const onProgress = async (update: InstallProgress): Promise<void> => {
      if (update.log) collected.push(update.log);
      const now = Date.now();
      // 进度变化立即落库（步骤切换需要实时），纯日志按间隔合并
      const stepChanged = update.progress >= 100 || update.log === undefined;
      if (!stepChanged && now - lastFlush < FLUSH_INTERVAL_MS) return;
      lastFlush = now;
      await flush({
        status: 'running',
        step: update.step,
        progress: update.progress,
        ...(collected.length > 0 ? { log: tailLog(collected) } : {})
      });
    };

    try {
      await flush({ status: 'running', progress: 1, log: collected.length > 0 ? tailLog(collected) : null });

      switch (input.action) {
        case 'install':
        case 'update': {
          await this.runInstall(jobId, input, onProgress);
          break;
        }
        case 'remove': {
          await this.runRemove(jobId, input, onProgress);
          break;
        }
      }

      await flush({
        status: 'succeeded',
        progress: 100,
        log: tailLog(collected),
        finishedAt: new Date()
      });
      logger.info('插件安装任务完成', { job: jobId, action: input.action });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      collected.push(`✗ ${message}`);
      await flush({
        status: 'failed',
        error: message,
        log: tailLog(collected),
        finishedAt: new Date()
      });
      logger.error('插件安装任务失败', { job: jobId, action: input.action, error: message });
    }
  }

  private async runInstall(
    jobId: string,
    input: SubmitJobInput,
    onProgress: (update: InstallProgress) => Promise<void>
  ): Promise<void> {
    const { config, logger, plugins } = this.deps;

    if (!input.source) {
      // 安装/更新必须有来源；卸载任务的来源为空是合法的
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '安装任务缺少来源（source）', {
        status: 400
      });
    }

    const outcome = await installPlugin({
      source: toInstallSource(input.source),
      installDir: config.paths.pluginsInstallDir,
      cacheDir: config.paths.cacheDir,
      logger,
      allowScripts: input.allowScripts ?? config.pluginInstall.allowScripts,
      npm: {
        registry: config.pluginRegistry.registry,
        ...(config.pluginRegistry.token ? { token: config.pluginRegistry.token } : {})
      },
      commandTimeoutMs: config.pluginInstall.commandTimeoutSeconds * 1000,
      onProgress: (update) => {
        void onProgress(update);
      }
    });

    // 来源与插件 ID 需要在解析后才能确定：这里补齐任务记录
    await this.jobs.update(jobId, { pluginId: outcome.result.pluginId });
    await plugins.recordSource(outcome.result.pluginId, outcome.source, {
      name: outcome.result.name,
      version: outcome.result.version,
      dir: outcome.result.dir
    });

    await this.deps.markRestartRequired({
      reason: `插件 ${outcome.result.pluginId} ${outcome.result.upgraded ? '已升级' : '已安装'}，重启后生效`,
      ...(input.actorId ? { actorId: input.actorId } : {})
    });

    await this.deps.audit?.({
      action: `plugin.${outcome.result.upgraded ? 'update' : 'install'}`,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      targetId: outcome.result.pluginId,
      detail: {
        version: outcome.result.version,
        source: outcome.source,
        allowScripts: input.allowScripts ?? config.pluginInstall.allowScripts
      }
    });
  }

  private async runRemove(
    jobId: string,
    input: SubmitJobInput,
    onProgress: (update: InstallProgress) => Promise<void>
  ): Promise<void> {
    const { config, plugins, logger } = this.deps;
    const pluginId = input.pluginId;
    if (!pluginId) {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '卸载任务缺少插件 ID', { status: 400 });
    }

    const summary = plugins.summary().find((item) => item.id === pluginId);
    if (!summary) {
      throw new RiceNoteError(ErrorCode.NOT_FOUND, `未找到插件：${pluginId}`, { status: 404 });
    }
    if (summary.builtin) {
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `${pluginId} 是随仓库分发的内置插件，不能卸载（可停用）。`,
        { status: 400 }
      );
    }
    /*
     * 依赖保护：仍有启用的插件依赖它时拒绝卸载。
     * 否则重启后那些插件会因缺依赖而启动失败 —— 这是"卸载一个插件搞挂全站"的典型路径。
     */
    const dependents = summary.dependents.filter((id) => id !== pluginId);
    if (dependents.length > 0) {
      throw new RiceNoteError(
        ErrorCode.DEPENDENCY_MISSING,
        `${pluginId} 仍被以下插件依赖，请先停用它们：${dependents.join('、')}`,
        { status: 409, details: { dependents } }
      );
    }

    await onProgress({ step: 'resolve', progress: 5, log: `准备卸载 ${pluginId}` });

    const dir = path.join(config.paths.pluginsInstallDir, shortName(pluginId));
    if (!isInside(config.paths.pluginsInstallDir, dir)) {
      throw new RiceNoteError(ErrorCode.PLUGIN_INSTALL_FAILED, '卸载路径越出安装目录', {
        status: 400
      });
    }

    if (existsSync(dir) && statSync(dir).isDirectory()) {
      rmSync(dir, { recursive: true, force: true });
      await onProgress({ step: 'commit', progress: 70, log: `已删除目录 ${dir}` });
    } else {
      await onProgress({ step: 'commit', progress: 70, log: '目录不存在，仅清理元数据' });
    }

    await plugins.forget(pluginId);
    await this.deps.markRestartRequired({
      reason: `插件 ${pluginId} 已卸载，重启后生效`,
      ...(input.actorId ? { actorId: input.actorId } : {})
    });
    await this.deps.audit?.({
      action: 'plugin.remove',
      ...(input.actorId ? { actorId: input.actorId } : {}),
      targetId: pluginId,
      detail: { dir }
    });

    logger.info('插件已卸载', { pluginId, dir });
    await onProgress({ step: 'commit', progress: 100, log: `${pluginId} 已卸载` });
  }

  /* ----------------------------- 更新检查 ----------------------------- */

  /**
   * 检查所有插件是否有可用更新。
   *
   * 检查是**只读且可能联网**的，因此逐个失败都被降级为 `note`，
   * 不会因为某个插件的私有源不可达让整个报告失败。
   */
  async checkUpdates(): Promise<PluginUpdateReport> {
    const { config, plugins, logger } = this.deps;
    const items: PluginUpdateInfo[] = [];
    const toolchain = await detectToolchain(logger);

    for (const summary of plugins.summary()) {
      const source = summary.source;
      if (!source) {
        items.push({
          pluginId: summary.id,
          currentVersion: summary.version,
          source: { type: 'local', spec: '' },
          checkable: false,
          updateAvailable: false,
          note: '来源未知（v0.4.0 之前安装的插件没有记录来源），无法检查更新。'
        });
        continue;
      }

      if (source.type === 'local') {
        items.push({
          pluginId: summary.id,
          currentVersion: summary.version,
          source,
          checkable: false,
          updateAvailable: false,
          note: '本地目录来源不参与版本管理，请直接更新源目录（开发期改动即生效）。'
        });
        continue;
      }

      try {
        if (source.type === 'registry') {
          items.push(
            await checkRegistryUpdate(summary.id, summary.version, source, {
              registry: config.pluginRegistry.registry,
              ...(config.pluginRegistry.token ? { token: config.pluginRegistry.token } : {})
            })
          );
        } else {
          items.push(await checkGitUpdate(summary.id, source, toolchain, logger));
        }
      } catch (error) {
        items.push({
          pluginId: summary.id,
          currentVersion: summary.version,
          source,
          checkable: true,
          updateAvailable: false,
          note: `检查失败：${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    return { checkedAt: new Date().toISOString(), items };
  }
}

/* ----------------------------- 更新检查细节 ----------------------------- */

async function checkRegistryUpdate(
  pluginId: string,
  currentVersion: string,
  source: PluginSourceInfo,
  npm: { registry: string; token?: string }
): Promise<PluginUpdateInfo> {
  const { name, range } = parsePackageSpec(source.spec);
  const registry = npm.registry.replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (npm.token) headers.Authorization = `Bearer ${npm.token}`;

  const response = await fetch(`${registry}/${name.replace('/', '%2F')}`, { headers });
  if (!response.ok) {
    return {
      pluginId,
      currentVersion,
      source,
      checkable: true,
      updateAvailable: false,
      note: `registry 查询失败（${response.status}）`
    };
  }

  const packument = (await response.json()) as Parameters<typeof pickVersion>[0];
  const latest = pickVersion(packument, range, name);
  const updateAvailable = semver.valid(latest) !== null && semver.gt(latest, currentVersion);

  return {
    pluginId,
    currentVersion,
    source,
    checkable: true,
    updateAvailable,
    latestVersion: latest
  };
}

async function checkGitUpdate(
  pluginId: string,
  source: PluginSourceInfo,
  toolchain: Awaited<ReturnType<typeof detectToolchain>>,
  logger: Logger
): Promise<PluginUpdateInfo> {
  const git = requireGit(toolchain);
  const url = validateGitRepo(source.spec);

  const result = await runCommand(git.command, ['ls-remote', url, source.ref ?? 'HEAD'], {
    cwd: process.cwd(),
    timeoutMs: 30000
  });

  const head = result.stdout.trim().split(/\s+/)[0]?.slice(0, 7);
  const installed = source.resolvedVersion;
  const updateAvailable = Boolean(head && installed && head !== installed);

  logger.debug?.('Git 更新检查', { pluginId, head, installed });

  return {
    pluginId,
    currentVersion: installed ?? '未知',
    source,
    checkable: true,
    updateAvailable,
    ...(head ? { latestVersion: head } : {}),
    ...(installed ? {} : { note: '未记录安装时的提交，无法比较（可先更新一次以建立基线）。' })
  };
}

/* ------------------------------- 任务存储 ------------------------------- */

class PluginJobStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async create(input: {
    pluginId: string | null;
    action: PluginJobAction;
    source: PluginSourceInfo | null;
    actorId: number | null;
  }): Promise<PluginJobDto> {
    const id = randomBytes(9).toString('hex');
    await this.db.execute(
      `INSERT INTO rn_plugin_jobs
         (id, plugin_id, action, source_json, status, step, progress, log_text, error, actor_id, started_at)
       VALUES (?, ?, ?, CAST(? AS JSON), 'queued', NULL, 0, NULL, NULL, ?, NOW())`,
      [id, input.pluginId, input.action, JSON.stringify(input.source ?? {}), input.actorId]
    );
    const created = await this.get(id);
    if (!created) throw new RiceNoteError(ErrorCode.INTERNAL, '任务创建失败', { status: 500 });
    return created;
  }

  async update(
    id: string,
    patch: {
      pluginId?: string;
      status?: PluginJobStatus;
      step?: PluginJobStep;
      progress?: number;
      log?: string | null;
      error?: string | null;
      finishedAt?: Date;
    }
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.pluginId !== undefined) {
      sets.push('plugin_id = ?');
      values.push(patch.pluginId);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      values.push(patch.status);
    }
    if (patch.step !== undefined) {
      sets.push('step = ?');
      values.push(patch.step);
    }
    if (patch.progress !== undefined) {
      sets.push('progress = ?');
      values.push(Math.max(0, Math.min(100, Math.round(patch.progress))));
    }
    if (patch.log !== undefined) {
      sets.push('log_text = ?');
      values.push(patch.log === null ? null : truncateLog(patch.log));
    }
    if (patch.error !== undefined) {
      sets.push('error = ?');
      values.push(patch.error);
    }
    if (patch.finishedAt !== undefined) {
      sets.push('finished_at = ?');
      values.push(patch.finishedAt);
    }

    if (sets.length === 0) return;
    values.push(id);
    await this.db.execute(`UPDATE rn_plugin_jobs SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  async get(id: string): Promise<PluginJobDto | undefined> {
    const rows = await this.db.query<JobRow>('SELECT * FROM rn_plugin_jobs WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? toJobDto(rows[0]) : undefined;
  }

  async list(limit: number): Promise<PluginJobDto[]> {
    const rows = await this.db.query<JobRow>(
      'SELECT * FROM rn_plugin_jobs ORDER BY started_at DESC, id DESC LIMIT ?',
      [Math.max(1, Math.min(100, limit))]
    );
    return rows.map(toJobDto);
  }
}

function toJobDto(row: JobRow): PluginJobDto {
  let source: PluginSourceInfo | null = null;
  const raw = row.source_json;
  if (raw) {
    try {
      const parsed = (
        typeof raw === 'string' ? JSON.parse(raw) : raw
      ) as unknown as PluginSourceInfo;
      source = parsed.type ? parsed : null;
    } catch {
      source = null;
    }
  }

  return {
    id: row.id,
    pluginId: row.plugin_id,
    action: row.action as PluginJobAction,
    source,
    status: row.status as PluginJobStatus,
    step: (row.step as PluginJobStep | null) ?? null,
    progress: Number(row.progress ?? 0),
    log: row.log_text ?? '',
    error: row.error,
    actorId: row.actor_id === null ? null : Number(row.actor_id),
    startedAt: toIso(row.started_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : null
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/* --------------------------------- 工具 --------------------------------- */

function tailLog(lines: string[]): string {
  return truncateLog(lines.join('\n'));
}

/** 只保留末尾若干 KB：任务面板看的是最近的输出。 */
function truncateLog(text: string): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= MAX_LOG_BYTES) return text;
  return `…（已截断较早的日志）\n${buffer.subarray(buffer.byteLength - MAX_LOG_BYTES).toString('utf8')}`;
}

function sourceKey(source: JobSource): string {
  switch (source.type) {
    case 'registry':
      return `registry:${source.spec}`;
    case 'git':
      return `git:${source.repo}#${source.ref}`;
    case 'directory':
      return `directory:${source.path}`;
    case 'zip':
      return `zip:${source.fileName}`;
  }
}

/** 只有能写进数据库的形状才入库（压缩包只记文件名）。 */
function describeJobSource(source: JobSource): PluginSourceInfo | null {
  switch (source.type) {
    case 'registry':
      return { type: 'registry', spec: source.spec };
    case 'git':
      return { type: 'git', spec: source.repo, ref: source.ref };
    case 'directory':
      return { type: 'local', spec: source.path, via: 'directory' };
    case 'zip':
      return { type: 'local', spec: source.fileName, via: 'zip' };
  }
}

function toInstallSource(source: JobSource): InstallSourceInput {
  return source;
}

function isInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}
