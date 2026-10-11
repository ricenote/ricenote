/**
 * 备份与恢复（说明书第 10 章：数据库 + storage + 已安装插件与主题清单）。
 *
 * 关键设计：
 * - **流式打包**：`mysqldump` 输出直接进入 ZIP 归档流，内存占用与数据量无关；
 * - **凭据不入命令行**：数据库密码经临时 `--defaults-extra-file`（0600）传递，
 *   用后立即删除，避免出现在 argv 与进程列表中；
 * - **恢复前必先快照**：恢复会覆盖现有数据，因此先把当前状态导出为快照文件，
 *   失败时可以回滚；
 * - **工具缺失可诊断**：`mysqldump`/`mysql` 不在 PATH 时抛出
 *   `RN_BACKUP_TOOL_MISSING` 并给出修复提示，而不是 500 或半个下载。
 *
 * 备份包结构：
 * ```text
 * manifest.json      # 清单元数据（版本、插件/主题清单、uploads 统计）
 * database.sql       # mysqldump 全量导出
 * uploads/**         # storage/uploads 全量文件
 * ```
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import archiver from 'archiver';
import { ErrorCode, RiceNoteError, type BackupManifest, type BackupSnapshot } from '@ricenote/shared';
import type { RiceNoteConfig } from '../config/loader.js';
import type { DatabaseAdapter } from '../database/adapter.js';
import type { Logger } from '../logger.js';
import { PluginStore } from '../plugins/plugin-store.js';
import { DEFAULT_ZIP_GUARD, extractZipSafely, type ZipGuardOptions } from '../themes/zip-guard.js';
import { APP_VERSION } from '../version.js';

/** 备份包内固定文件名。 */
const MANIFEST_NAME = 'manifest.json';
const DUMP_NAME = 'database.sql';
const UPLOADS_PREFIX = 'uploads';

/** 恢复包的安全限额与允许类型（在主题默认白名单基础上补上备份自身的内容类型）。 */
export const RESTORE_ZIP_GUARD: ZipGuardOptions = {
  ...DEFAULT_ZIP_GUARD,
  // 备份包含 mysqldump 输出与媒体文件，因此放宽体积上限；
  // 与 HTTP 传输层上限（apps/server 的 MAX_UPLOAD_BYTES）保持一致，避免出现
  // "传输层拦得住、校验层拦不住"的认知差。
  maxArchiveBytes: 128 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxEntryUncompressedBytes: 128 * 1024 * 1024,
  allowedExtensions: [
    '.json',
    '.sql',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.avif',
    '.svg',
    '.pdf',
    '.txt',
    '.md',
    '.zip'
  ],
  errorCode: ErrorCode.RESTORE_FAILED
};

export interface BackupServiceDeps {
  config: RiceNoteConfig;
  logger: Logger;
  db: DatabaseAdapter;
  /** `mysqldump` 可执行文件名（测试可覆盖为不存在以验证错误码）。 */
  mysqldumpBinary?: string;
  /** `mysql` 可执行文件名。 */
  mysqlBinary?: string;
}

export class BackupService {
  private readonly config: RiceNoteConfig;
  private readonly logger: Logger;
  private readonly db: DatabaseAdapter;
  private readonly mysqldumpBinary: string;
  private readonly mysqlBinary: string;

  constructor(deps: BackupServiceDeps) {
    this.config = deps.config;
    this.logger = deps.logger;
    this.db = deps.db;
    // 默认取配置（可指向绝对路径），测试可显式覆盖为不存在的命令以验证错误码
    this.mysqldumpBinary = deps.mysqldumpBinary ?? deps.config.database.dumpBinary;
    this.mysqlBinary = deps.mysqlBinary ?? deps.config.database.clientBinary;
  }

  /**
   * 导出为 ZIP 流。
   *
   * 调用方在**开始流式输出之前**应先调用 {@link assertToolsAvailable}，
   * 这样"缺工具"能返回结构化错误而不是中断的下载。
   */
  async exportToStream(): Promise<Readable> {
    const manifest = await this.buildManifest();

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (error: unknown) => {
      this.logger.warn('备份归档告警', { error: String(error) });
    });

    archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_NAME });

    const uploadsDir = this.config.paths.uploadsDir;
    if (existsSync(uploadsDir)) {
      /*
       * 用 glob 而非 directory()：需要**跳过点文件**（`.gitkeep`、`.DS_Store` 等）。
       * 它们没有扩展名，会被恢复端的扩展名白名单拒绝，
       * 导致"自己导出的备份无法恢复"这一自相矛盾的结果。
       */
      archive.glob('**/*', {
        cwd: uploadsDir,
        dot: false,
        nodir: true,
        ignore: ['**/.*', '**/.*/**']
      });
    }

    archive.append(this.createDumpStream(), { name: DUMP_NAME });
    void archive.finalize();

    this.logger.info('备份已开始导出', {
      database: manifest.database.name,
      uploads: manifest.uploads
    });

    return archive;
  }

  /** 导出到 `backupsDir` 下的文件（用于恢复前快照）。返回绝对路径。 */
  async exportToFile(): Promise<string> {
    mkdirSync(this.config.paths.backupsDir, { recursive: true });
    const filePath = path.join(this.config.paths.backupsDir, `backup-${stamp(new Date())}.zip`);

    const stream = await this.exportToStream();
    await pipeline(stream, createWriteStream(filePath));

    this.logger.info('备份快照已生成', { file: path.basename(filePath) });
    return filePath;
  }

  /** 列出历史快照（按时间倒序）。 */
  listSnapshots(): BackupSnapshot[] {
    const dir = this.config.paths.backupsDir;
    if (!existsSync(dir)) return [];

    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.zip$/i.test(entry.name))
      .map((entry) => {
        const stat = statSync(path.join(dir, entry.name));
        return { name: entry.name, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /** 解析快照文件路径（含路径归一化校验）。 */
  resolveSnapshotPath(name: string): string {
    const base = path.basename(name);
    if (base !== name || !/\.zip$/i.test(base)) {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `非法的快照文件名：${name}`, { status: 400 });
    }
    const resolved = path.join(this.config.paths.backupsDir, base);
    if (!existsSync(resolved)) {
      throw new RiceNoteError(ErrorCode.NOT_FOUND, `快照不存在：${name}`, { status: 404 });
    }
    return resolved;
  }

  /** 删除快照。 */
  deleteSnapshot(name: string): void {
    const resolved = this.resolveSnapshotPath(name);
    rmSync(resolved, { force: true });
    this.logger.info('备份快照已删除', { file: path.basename(resolved) });
  }

  /**
   * 只读解析备份包（不写数据库、不覆盖任何文件）。
   *
   * 用途：恢复前的"包内清单预览"，让管理员在确认前看到备份来源与规模。
   * 复用同一套 ZIP 安全校验，因此恶意包在预览阶段就会被拒绝。
   */
  async inspect(archive: Buffer): Promise<{
    manifest: BackupManifest;
    dumpBytes: number;
  }> {
    const stagingDir = path.join(this.config.paths.cacheDir, `inspect-${Date.now()}-${randomSuffix()}`);
    mkdirSync(stagingDir, { recursive: true });

    try {
      extractZipSafely(archive, stagingDir, RESTORE_ZIP_GUARD);

      const manifest = readBackupManifest(stagingDir);
      const dumpPath = path.join(stagingDir, DUMP_NAME);
      if (!existsSync(dumpPath)) {
        throw new RiceNoteError(ErrorCode.RESTORE_FAILED, `备份包缺少 ${DUMP_NAME}`, { status: 400 });
      }

      return { manifest, dumpBytes: statSync(dumpPath).size };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  /** 从磁盘上的历史快照恢复（用于"回滚"）。 */
  async restoreFromSnapshot(name: string): Promise<{ snapshot: BackupSnapshot; manifest: BackupManifest }> {
    const filePath = this.resolveSnapshotPath(name);
    const archive = readFileSync(filePath);
    this.logger.warn('正在从历史快照回滚', { snapshot: name });
    return this.runRestore(archive);
  }

  /**
   * 从 ZIP 恢复。
   *
   * 顺序：安全解压 → 校验清单 → **生成当前状态快照** → 导入数据库 → 还原上传文件。
   */
  async restore(archive: Buffer): Promise<{ snapshot: BackupSnapshot; manifest: BackupManifest }> {
    return this.runRestore(archive);
  }

  private async runRestore(
    archive: Buffer
  ): Promise<{ snapshot: BackupSnapshot; manifest: BackupManifest }> {
    await this.assertToolsAvailable();

    const stagingDir = path.join(this.config.paths.cacheDir, `restore-${Date.now()}-${randomSuffix()}`);
    mkdirSync(stagingDir, { recursive: true });

    try {
      extractZipSafely(archive, stagingDir, RESTORE_ZIP_GUARD);

      const manifest = readBackupManifest(stagingDir);
      const dumpPath = path.join(stagingDir, DUMP_NAME);
      if (!existsSync(dumpPath)) {
        throw new RiceNoteError(ErrorCode.RESTORE_FAILED, `备份包缺少 ${DUMP_NAME}`, { status: 400 });
      }

      // 恢复前快照：这是"可回滚"承诺的关键一步
      const snapshotPath = await this.exportToFile();
      const snapshotStat = statSync(snapshotPath);
      const snapshot: BackupSnapshot = {
        name: path.basename(snapshotPath),
        size: snapshotStat.size,
        createdAt: snapshotStat.mtime.toISOString()
      };

      await this.importDatabase(dumpPath);
      this.restoreUploads(path.join(stagingDir, UPLOADS_PREFIX));

      this.logger.info('备份已恢复', {
        snapshot: snapshot.name,
        restoredFrom: manifest.createdAt,
        plugins: manifest.plugins.length,
        themes: manifest.themes.length
      });

      return { snapshot, manifest };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  /** 检查 mysqldump / mysql 是否可用，缺失时给出可操作的提示。 */
  async assertToolsAvailable(): Promise<void> {
    await Promise.all([
      this.assertBinary(this.mysqldumpBinary, '备份'),
      this.assertBinary(this.mysqlBinary, '恢复')
    ]);
  }

  private assertBinary(binary: string, action: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ['--version'], { stdio: 'ignore' });
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(
            new RiceNoteError(
              ErrorCode.BACKUP_TOOL_MISSING,
              `${action}所需的命令行工具 ${binary} 不在 PATH 中，请安装 MySQL 客户端工具后重试`,
              { status: 503, details: { binary } }
            )
          );
          return;
        }
        reject(error);
      });
      child.on('close', () => resolve());
    });
  }

  /** 启动 mysqldump 并把 stdout 作为归档流的输入。 */
  private createDumpStream(): Readable {
    const credentials = writeCredentialFile(this.config);
    const child = spawn(this.mysqldumpBinary, this.dumpArguments(credentials.file), {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      credentials.cleanup();
    };

    const stderrChunks: string[] = [];
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrChunks.join('').length < 2000) stderrChunks.push(chunk.toString());
    });

    child.on('error', (error) => {
      cleanup();
      this.logger.error('mysqldump 启动失败', { error: String(error) });
      child.stdout?.destroy(error);
    });

    child.on('close', (code) => {
      cleanup();
      if (code !== 0) {
        const detail = stderrChunks.join('').trim().slice(0, 500);
        this.logger.error('mysqldump 退出异常', { code, detail });
        child.stdout?.destroy(
          new RiceNoteError(ErrorCode.BACKUP_FAILED, `数据库导出失败（退出码 ${code}）`, {
            status: 500,
            details: detail ? { detail } : undefined
          })
        );
      }
    });

    if (!child.stdout) {
      cleanup();
      throw new RiceNoteError(ErrorCode.BACKUP_FAILED, '无法读取 mysqldump 输出', { status: 500 });
    }
    return child.stdout;
  }

  private dumpArguments(credentialFile: string): string[] {
    return [
      `--defaults-extra-file=${credentialFile}`,
      '--single-transaction',
      '--quick',
      '--skip-lock-tables',
      '--routines',
      '--events',
      '--default-character-set=utf8mb4',
      this.config.database.name
    ];
  }

  /** 把 dump 文件导入数据库。 */
  private async importDatabase(dumpPath: string): Promise<void> {
    const credentials = writeCredentialFile(this.config);
    try {
      const child = spawn(this.mysqlBinary, [`--defaults-extra-file=${credentials.file}`, this.config.database.name], {
        stdio: ['pipe', 'ignore', 'pipe']
      });

      const stderrChunks: string[] = [];
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrChunks.join('').length < 2000) stderrChunks.push(chunk.toString());
      });

      const closed = new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? -1));
      });

      await pipeline(createReadStream(dumpPath), child.stdin!);
      const code = await closed;

      if (code !== 0) {
        const detail = stderrChunks.join('').trim().slice(0, 500);
        throw new RiceNoteError(ErrorCode.RESTORE_FAILED, `数据库导入失败（退出码 ${code}）`, {
          status: 500,
          details: detail ? { detail } : undefined
        });
      }
    } finally {
      credentials.cleanup();
    }
  }

  /** 覆盖式还原上传目录（数据库已成功导入后才执行）。 */
  private restoreUploads(stagedUploadsDir: string): void {
    if (!existsSync(stagedUploadsDir)) return;

    const uploadsDir = this.config.paths.uploadsDir;
    if (existsSync(uploadsDir)) {
      rmSync(uploadsDir, { recursive: true, force: true });
    }
    mkdirSync(path.dirname(uploadsDir), { recursive: true });
    cpSync(stagedUploadsDir, uploadsDir, { recursive: true });
  }

  private async buildManifest(): Promise<BackupManifest> {
    const plugins = await new PluginStore(this.db).list();
    const themeRows = await this.db.query<{ id: string; version: string }>(
      'SELECT id, version FROM rn_themes'
    );
    const stateRows = await this.db.query<{ active_theme_id: string | null }>(
      'SELECT active_theme_id FROM rn_site_state WHERE site_id = ? LIMIT 1',
      [this.config.site.id]
    );
    const activeThemeId = stateRows[0]?.active_theme_id ?? null;

    return {
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      siteId: this.config.site.id,
      database: {
        name: this.config.database.name,
        host: this.config.database.host,
        port: this.config.database.port
      },
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        version: plugin.version,
        enabled: plugin.enabled
      })),
      themes: themeRows.map((theme) => ({
        id: theme.id,
        version: theme.version,
        active: theme.id === activeThemeId
      })),
      uploads: collectUploadsStats(this.config.paths.uploadsDir)
    };
  }
}

/* ------------------------------ 内部工具 ------------------------------ */

/** 统计上传目录的文件数与总体积。 */
function collectUploadsStats(uploadsDir: string): { fileCount: number; totalBytes: number } {
  let fileCount = 0;
  let totalBytes = 0;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // 与归档时的过滤保持一致：点文件不进备份，也不计入统计
      if (entry.name.startsWith('.')) continue;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      fileCount += 1;
      totalBytes += statSync(full).size;
    }
  };

  if (existsSync(uploadsDir)) walk(uploadsDir);
  return { fileCount, totalBytes };
}

/** 读取并校验备份包清单。 */
function readBackupManifest(stagingDir: string): BackupManifest {
  const manifestPath = path.join(stagingDir, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    throw new RiceNoteError(ErrorCode.RESTORE_FAILED, `备份包缺少 ${MANIFEST_NAME}`, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new RiceNoteError(ErrorCode.RESTORE_FAILED, `备份清单不是合法 JSON：${String(error)}`, {
      status: 400
    });
  }

  const manifest = parsed as Partial<BackupManifest>;
  if (manifest.formatVersion !== 1) {
    throw new RiceNoteError(
      ErrorCode.RESTORE_FAILED,
      `不支持的备份格式版本：${String(manifest.formatVersion)}（当前仅支持 1）`,
      { status: 400, details: { formatVersion: manifest.formatVersion } }
    );
  }

  return {
    formatVersion: 1,
    createdAt: manifest.createdAt ?? '',
    appVersion: manifest.appVersion ?? '',
    siteId: manifest.siteId ?? '',
    database: manifest.database ?? { name: '', host: '', port: 0 },
    plugins: manifest.plugins ?? [],
    themes: manifest.themes ?? [],
    uploads: manifest.uploads ?? { fileCount: 0, totalBytes: 0 }
  };
}

/**
 * 写入临时凭据文件（0600）。
 *
 * 密码不进入 argv，避免出现在 `ps` 输出与结构化日志中。
 */
function writeCredentialFile(config: RiceNoteConfig): { file: string; cleanup: () => void } {
  const file = path.join(tmpdir(), `ricenote-my-${randomSuffix()}.cnf`);
  const password = config.database.password.replace(/[\r\n]/g, '');
  const content = [
    '[client]',
    `host=${config.database.host}`,
    `port=${config.database.port}`,
    `user=${config.database.user}`,
    `password=${password}`,
    ''
  ].join('\n');

  const descriptor = openSync(file, 'w', 0o600);
  try {
    writeFileSync(descriptor, content, 'utf8');
  } finally {
    closeSync(descriptor);
  }

  return {
    file,
    cleanup: () => rmSync(file, { force: true })
  };
}

function randomSuffix(): string {
  return randomBytes(6).toString('hex');
}

/** 生成 `YYYYMMDD-HHmmss` 形式的时间戳。 */
function stamp(date: Date): string {
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}
