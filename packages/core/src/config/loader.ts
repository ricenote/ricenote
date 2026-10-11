/**
 * 配置加载：`.env` → 环境变量 → 结构化对象 → JSON Schema 校验。
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { Ajv } from 'ajv';
import dotenv from 'dotenv';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import { CONFIG_SCHEMA } from './schema.js';
import { parseLogLevel, type LogLevel } from '../logger.js';

export interface RiceNoteConfig {
  env: 'development' | 'production' | 'test';
  logLevel: LogLevel;
  http: { host: string; port: number; siteUrl: string };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    url?: string;
    connectionLimit: number;
    readonly: boolean;
    /**
     * 备份工具可执行文件路径。
     *
     * 允许写绝对路径，以支持"MySQL 客户端未加入 PATH"的安装方式
     * （Windows 上 MySQL 官方安装包默认就不在 PATH 中）。
     */
    dumpBinary: string;
    clientBinary: string;
  };
  security: { sessionSecret: string; sessionTtlSeconds: number; csrfEnabled: boolean };
  bootstrap: { adminUsername: string; adminPassword: string; adminEmail: string };
  paths: {
    /** 项目根目录：所有相对路径的基准，也是定位 apps/ 等源码目录的依据。 */
    rootDir: string;
    storageDir: string;
    uploadsDir: string;
    cacheDir: string;
    logsDir: string;
    /** 备份与恢复前快照的存放目录。 */
    backupsDir: string;
    pluginsDir: string;
    /** 第三方插件的安装目录（后台 ZIP 上传安装的落盘位置）。 */
    pluginsInstallDir: string;
    themesDir: string;
  };
  site: {
    id: string;
    title: string;
    description: string;
    language: string;
    defaultTheme: string;
  };
  seedPlugins: string[];
  preview: { ttlSeconds: number };
  render: { cacheEnabled: boolean; cacheTtlSeconds: number };
}

function env(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value !== undefined && value.trim() !== '') return value.trim();
  if (fallback !== undefined) return fallback;
  throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `缺少必需的环境变量：${key}`, {
    status: 500,
    details: { key }
  });
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    throw new RiceNoteError(
      ErrorCode.VALIDATION_FAILED,
      `环境变量 ${key} 必须是整数，当前值：${raw}`,
      { status: 500 }
    );
  }
  return parsed;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * 解析 `mysql://user:pass@host:port/db` 形式的连接串。
 * 解析失败返回 undefined，由分字段配置兜底。
 */
export function parseDatabaseUrl(url: string): RiceNoteConfig['database'] | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith('mysql')) return undefined;
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 3306,
      user: decodeURIComponent(parsed.username || 'root'),
      password: decodeURIComponent(parsed.password || ''),
      name: parsed.pathname.replace(/^\//, '') || 'ricenote',
      url,
      connectionLimit: 10,
      readonly: false,
      // 备份工具路径不属于连接串信息，仍由环境变量决定
      dumpBinary: env('MYSQLDUMP_BIN', 'mysqldump'),
      clientBinary: env('MYSQL_BIN', 'mysql')
    };
  } catch {
    return undefined;
  }
}

export interface LoadConfigOptions {
  /** 项目根目录（用于解析相对路径）；默认从 cwd 向上查找项目根。 */
  rootDir?: string;
  /** 是否加载 .env 文件，默认 true。 */
  loadDotEnv?: boolean;
  /** 允许覆盖的配置片段（测试用）。 */
  overrides?: Partial<RiceNoteConfig>;
}

/** 用于识别项目根目录的标记文件。 */
const ROOT_MARKERS = ['pnpm-workspace.yaml', 'pnpm-workspace.yml'] as const;

/**
 * 定位项目根目录。
 *
 * 不能直接使用 `process.cwd()`：通过 pnpm 运行包内脚本时（例如
 * `pnpm --filter @ricenote/server dev`），工作目录是**包目录** `apps/server`，
 * 此时 `.env`、`plugins/`、`themes/`、`storage/` 全部会解析到错误的位置。
 * 因此这里从起始目录向上查找工作区标记文件，向上最多 12 层，找不到再回退。
 */
export function resolveRootDir(startDir: string = process.cwd()): string {
  const start = path.resolve(startDir);
  let current = start;

  for (let depth = 0; depth < 12; depth += 1) {
    if (ROOT_MARKERS.some((marker) => existsSync(path.join(current, marker)))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return start;
}

/** 加载并校验配置。 */
export function loadConfig(options: LoadConfigOptions = {}): RiceNoteConfig {
  const rootDir = options.rootDir ?? resolveRootDir();

  if (options.loadDotEnv !== false) {
    const envFile = path.join(rootDir, '.env');
    if (existsSync(envFile)) {
      dotenv.config({ path: envFile, quiet: true });
    }
  }

  const storageDir = path.resolve(rootDir, env('STORAGE_DIR', './storage'));
  const urlParts = process.env.DATABASE_URL ? parseDatabaseUrl(process.env.DATABASE_URL.trim()) : undefined;

  const candidate: RiceNoteConfig = {
    env: (env('NODE_ENV', 'development') as RiceNoteConfig['env']) ?? 'development',
    logLevel: parseLogLevel(process.env.LOG_LEVEL, 'info'),
    http: {
      host: env('HOST', '0.0.0.0'),
      port: intEnv('PORT', 3000),
      siteUrl: env('SITE_URL', 'http://localhost:3000').replace(/\/+$/, '')
    },
    database: {
      host: env('DB_HOST', urlParts?.host ?? '127.0.0.1'),
      port: intEnv('DB_PORT', urlParts?.port ?? 3306),
      user: env('DB_USER', urlParts?.user ?? 'root'),
      password: process.env.DB_PASSWORD ?? urlParts?.password ?? '',
      name: env('DB_NAME', urlParts?.name ?? 'ricenote'),
      ...(process.env.DATABASE_URL ? { url: process.env.DATABASE_URL.trim() } : {}),
      connectionLimit: intEnv('DB_CONNECTION_LIMIT', 10),
      readonly: boolEnv('DB_READONLY', false),
      dumpBinary: env('MYSQLDUMP_BIN', 'mysqldump'),
      clientBinary: env('MYSQL_BIN', 'mysql')
    },
    security: {
      sessionSecret: env('SESSION_SECRET', 'change-me-in-production'),
      sessionTtlSeconds: intEnv('SESSION_TTL_SECONDS', 7200),
      csrfEnabled: boolEnv('CSRF_ENABLED', true)
    },
    bootstrap: {
      adminUsername: env('BOOTSTRAP_ADMIN_USERNAME', 'admin'),
      adminPassword: env('BOOTSTRAP_ADMIN_PASSWORD', 'admin12345'),
      adminEmail: env('BOOTSTRAP_ADMIN_EMAIL', 'admin@example.com')
    },
    paths: {
      rootDir,
      storageDir,
      uploadsDir: path.join(storageDir, 'uploads'),
      cacheDir: path.join(storageDir, 'cache'),
      logsDir: path.join(storageDir, 'logs'),
      backupsDir: path.join(storageDir, 'backups'),
      pluginsDir: path.resolve(rootDir, env('PLUGINS_DIR', './plugins/official')),
      pluginsInstallDir: path.resolve(rootDir, env('PLUGINS_INSTALL_DIR', './plugins/third-party')),
      themesDir: path.resolve(rootDir, env('THEMES_DIR', './themes'))
    },
    site: {
      id: env('SITE_ID', 'default'),
      title: env('SITE_TITLE', 'RiceNote'),
      description: env('SITE_DESCRIPTION', '插件优先的轻量级博客与内容管理系统'),
      language: env('SITE_LANGUAGE', 'zh-CN'),
      defaultTheme: env('DEFAULT_THEME', 'minimal')
    },
    seedPlugins: env('RICENOTE_SEED_PLUGINS', '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    preview: {
      ttlSeconds: intEnv('PREVIEW_TTL_SECONDS', 900)
    },
    render: {
      cacheEnabled: boolEnv('RENDER_CACHE_ENABLED', true),
      cacheTtlSeconds: intEnv('RENDER_CACHE_TTL_SECONDS', 120)
    }
  };

  const merged: RiceNoteConfig = options.overrides
    ? (deepMerge(
        candidate as unknown as Record<string, unknown>,
        options.overrides as unknown as Record<string, unknown>
      ) as unknown as RiceNoteConfig)
    : candidate;

  assertConfig(merged);
  return merged;
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = output[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      output[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

/** 使用 JSON Schema 校验配置对象；失败时抛出携带详细路径的领域错误。 */
export function assertConfig(config: unknown): void {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(CONFIG_SCHEMA as unknown as Record<string, unknown>);
  if (validate(config) === true) return;

  const issues = (validate.errors ?? []).map((error) => ({
    path: error.instancePath || '/',
    message: error.message ?? '校验失败'
  }));

  throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '运行时配置校验失败', {
    status: 500,
    details: { issues }
  });
}
