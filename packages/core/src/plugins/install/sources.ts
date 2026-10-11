/**
 * 三种安装来源的解析：npm Registry / Git 仓库 / 本地目录（含压缩包）。
 *
 * 职责边界：**只负责把来源变成"磁盘上一个含 manifest.json 的目录"**，
 * 并把来源元数据整理成可以写进数据库的形状。依赖安装、构建、落盘与回滚
 * 都不在这里（见 `orchestrator.ts`）—— 这样每种来源的差异被限制在本文件中。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import * as tar from 'tar';
import { ErrorCode, RiceNoteError, type PluginSourceInfo } from '@ricenote/shared';
import type { Logger } from '../../logger.js';
import { extractZipSafely } from '../../themes/zip-guard.js';
import { PLUGIN_ZIP_GUARD, failInstall, locatePluginRoot } from './package-validation.js';
import { requireGit, runCommand, type ToolchainInfo } from './toolchain.js';

/** 安装来源（比入库的来源类型更细：ZIP 与目录都归 `local`，但解析方式不同）。 */
export type InstallSourceInput =
  | { type: 'registry'; spec: string }
  | { type: 'git'; repo: string; ref: string }
  | { type: 'directory'; path: string }
  | { type: 'zip'; fileName: string; archive: Buffer };

export interface SourceResolveContext {
  /** 本次安装的临时工作区（调用方负责清理）。 */
  workDir: string;
  logger: Logger;
  toolchain: ToolchainInfo;
  onLog?: (line: string) => void;
  /** npm 私有源配置（只从环境变量来，不落库、不进日志）。 */
  npm?: { registry?: string; token?: string };
  signal?: AbortSignal;
}

export interface ResolvedSource {
  /** 含 `manifest.json` 的目录（仍位于工作区，尚未落盘）。 */
  rootDir: string;
  /** 入库的来源元数据。 */
  record: PluginSourceInfo;
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export async function resolveSource(
  input: InstallSourceInput,
  ctx: SourceResolveContext
): Promise<ResolvedSource> {
  switch (input.type) {
    case 'registry':
      return resolveFromRegistry(input.spec, ctx);
    case 'git':
      return resolveFromGit(input.repo, input.ref, ctx);
    case 'directory':
      return resolveFromDirectory(input.path);
    case 'zip':
      return resolveFromZip(input.fileName, input.archive, ctx);
  }
}

/* ------------------------------- npm Registry ------------------------------- */

interface NpmPackument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<
    string,
    { version: string; dist?: { tarball?: string; integrity?: string; shasum?: string } }
  >;
}

/**
 * 解析 `包名` 或 `包名@版本区间`。
 *
 * 作用域包（`@scope/name`）里也有 `@`，因此不能简单按第一个 `@` 切分。
 */
export function parsePackageSpec(spec: string): { name: string; range: string } {
  const trimmed = spec.trim();
  if (trimmed.length === 0) failInstall('npm 包名不能为空');

  const match = /^(@[^/@]+\/[^@]+|[^@]+)(?:@(.+))?$/.exec(trimmed);
  if (!match) failInstall(`无法解析 npm 包名：${spec}（示例：ricenote-plugin-nav 或 @acme/ricenote-nav@^1.2.0）`);

  return { name: match[1]!.trim(), range: (match[2] ?? '').trim() || 'latest' };
}

/**
 * 从 registry 取回包并解包。
 *
 * 只下载 **npm tarball**（`dist.tarball`）而不调用包管理器下载：
 * 依赖安装交给 `prepare` 阶段在最终目录里做，这样依赖与插件始终在一起，
 * 落盘后 Node 的向上查找就能命中（不需要额外的解析机制）。
 */
async function resolveFromRegistry(
  spec: string,
  ctx: SourceResolveContext
): Promise<ResolvedSource> {
  const { name, range } = parsePackageSpec(spec);
  const registry = (ctx.npm?.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, '');

  ctx.onLog?.(`查询 npm registry：${name}@${range}`);
  const packument = await fetchPackument(registry, name, ctx);

  const version = pickVersion(packument, range, name);
  const entry = packument.versions?.[version];
  const tarballUrl = entry?.dist?.tarball;
  if (!tarballUrl) {
    failInstall(`registry 未给出 ${name}@${version} 的 tarball 地址`);
  }

  ctx.onLog?.(`下载 ${tarballUrl}`);
  const buffer = await fetchBuffer(tarballUrl, ctx, { token: ctx.npm?.token });
  verifyIntegrity(buffer, entry?.dist?.integrity, name, version);

  const extractDir = path.join(ctx.workDir, 'registry');
  mkdirSync(extractDir, { recursive: true });
  const archivePath = path.join(ctx.workDir, `${name.replace(/[/@]/g, '_')}-${version}.tgz`);
  writeFileSync(archivePath, buffer);

  await tar.extract({ file: archivePath, cwd: extractDir, strict: true });
  ctx.onLog?.(`已解包 ${name}@${version}`);

  return {
    rootDir: locatePluginRoot(extractDir),
    record: {
      type: 'registry',
      spec,
      resolvedVersion: version,
      ...(entry?.dist?.integrity ? { integrity: entry.dist.integrity } : {})
    }
  };
}

async function fetchPackument(
  registry: string,
  name: string,
  ctx: SourceResolveContext
): Promise<NpmPackument> {
  const url = `${registry}/${name.replace('/', '%2F')}`;
  const response = await fetchWithAuth(url, ctx, { token: ctx.npm?.token });
  if (!response.ok) {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_INSTALL_FAILED,
      `registry 查询失败（${response.status} ${response.statusText}）：${name}。请确认包名正确，私有包请配置 RICENOTE_NPM_REGISTRY 与 RICENOTE_NPM_TOKEN。`,
      { status: 502, details: { name, status: response.status } }
    );
  }
  return (await response.json()) as NpmPackument;
}

/** 选版本：优先 dist-tag，其次 semver 区间。 */
export function pickVersion(packument: NpmPackument, range: string, name: string): string {
  const versions = Object.keys(packument.versions ?? {});
  if (versions.length === 0) {
    failInstall(`registry 中没有 ${name} 的任何版本（可能不是插件包，或私有包缺少访问令牌）`);
  }

  const tagged = packument['dist-tags']?.[range];
  if (tagged && versions.includes(tagged)) return tagged;

  if (semver.valid(range, { loose: true })) return semver.clean(range, { loose: true }) ?? range;

  const best = semver.maxSatisfying(versions, range, { loose: true });
  if (!best) {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_INSTALL_FAILED,
      `${name} 没有满足 ${range} 的版本（可用：${semver
        .rsort(versions)
        .slice(0, 5)
        .join(', ')}…）`,
      { status: 404, details: { name, range } }
    );
  }
  return best;
}

/** 校验 `dist.integrity`（sha512）—— 下载内容必须与 registry 声明一致。 */
export function verifyIntegrity(
  buffer: Buffer,
  integrity: string | undefined,
  name: string,
  version: string
): void {
  if (!integrity) return;

  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity.trim());
  if (!match) return;

  const actual = createHash('sha512').update(buffer).digest('base64');
  if (actual !== match[1]) {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_INSTALL_FAILED,
      `${name}@${version} 的包完整性校验失败（内容与 registry 声明不一致），已中止安装。`,
      { status: 502, details: { name, version } }
    );
  }
}

/* -------------------------------- Git 仓库 -------------------------------- */

/**
 * Git 来源允许的地址形式。
 *
 * **必须白名单**：git 支持 `ext::` 传输助手，那等于让被安装的字符串直接执行命令；
 * 本地路径与 `file://` 也会读到服务器上的任意仓库。只允许网络协议。
 */
const GIT_URL_PATTERNS = [
  /^https:\/\/[^\s]+$/,
  /^ssh:\/\/[^\s]+$/,
  /^git@[A-Za-z0-9._-]+:[^\s]+$/
];

export function validateGitRepo(repo: string): string {
  const trimmed = repo.trim();
  if (!GIT_URL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    failInstall(
      `Git 仓库地址不被允许：${repo}。只支持 https:// 、ssh:// 与 git@host:path 形式（不接受本地路径与 file:// —— 那会让服务器去读任意本地仓库）。`
    );
  }
  return trimmed;
}

async function resolveFromGit(
  repo: string,
  ref: string,
  ctx: SourceResolveContext
): Promise<ResolvedSource> {
  const url = validateGitRepo(repo);
  const desiredRef = ref.trim() || 'HEAD';
  const git = requireGit(ctx.toolchain);
  const cloneDir = path.join(ctx.workDir, 'git');

  ctx.onLog?.(`克隆 ${url}`);
  await runCommand(git.command, ['clone', '--quiet', url, cloneDir], {
    cwd: ctx.workDir,
    env: gitEnv(),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(ctx.onLog ? { onLog: ctx.onLog } : {})
  });

  ctx.onLog?.(`检出 ${desiredRef}`);
  await runCommand(git.command, ['checkout', '--quiet', desiredRef], {
    cwd: cloneDir,
    env: gitEnv(),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(ctx.onLog ? { onLog: ctx.onLog } : {})
  });

  /*
   * 记录**实际检出的提交**（而不只是用户写的 tag/分支）：
   * 更新检查要靠它判断远端是否有新提交，否则每次都得重新解析引用，
   * 而且分支移动后会失去"装的到底是哪一版"这个事实。
   */
  const head = await runCommand(git.command, ['rev-parse', '--short', 'HEAD'], {
    cwd: cloneDir,
    env: gitEnv()
  });
  const commit = head.stdout.trim();
  ctx.onLog?.(`已检出提交 ${commit}`);

  return {
    rootDir: locatePluginRoot(cloneDir),
    record: {
      type: 'git',
      spec: url,
      ref: desiredRef,
      ...(commit ? { resolvedVersion: commit } : {})
    }
  };
}

/**
 * Git 的非交互环境变量。
 *
 * 不加这些，`git clone` 在无 TTY 的服务端可能挂在交互式认证提示上，
 * 表现为"安装卡住"而不是报错。
 */
function gitEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    GIT_CONFIG_NOSYSTEM: '1'
  };
}

/* -------------------------------- 本地目录 -------------------------------- */

async function resolveFromDirectory(inputPath: string): Promise<ResolvedSource> {
  const absolute = path.resolve(inputPath);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    failInstall(`本地插件目录不存在：${inputPath}`);
  }
  if (!existsSync(path.join(absolute, 'manifest.json'))) {
    failInstall(`本地插件目录缺少 manifest.json：${inputPath}`);
  }

  return {
    rootDir: locatePluginRoot(absolute),
    record: { type: 'local', spec: absolute, via: 'directory' }
  };
}

/* --------------------------------- 压缩包 --------------------------------- */

/**
 * 压缩包来源：解包后按 `local` 处理。
 *
 * 这里刻意**复用 ZIP 的两阶段安全校验**（先全量校验、再落盘），
 * 与主题安装共用同一套实现。
 */
async function resolveFromZip(
  fileName: string,
  archive: Buffer,
  ctx: SourceResolveContext
): Promise<ResolvedSource> {
  const extractDir = path.join(ctx.workDir, 'zip');
  mkdirSync(extractDir, { recursive: true });

  extractZipSafely(archive, extractDir, PLUGIN_ZIP_GUARD);
  ctx.onLog?.(`已解包 ${fileName}`);

  return {
    rootDir: locatePluginRoot(extractDir),
    record: { type: 'local', spec: fileName, via: 'zip' }
  };
}

/* --------------------------------- HTTP ---------------------------------- */

async function fetchWithAuth(
  url: string,
  ctx: SourceResolveContext,
  options: { token?: string }
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  try {
    return await fetch(url, {
      headers,
      ...(ctx.signal ? { signal: ctx.signal } : {})
    });
  } catch (error) {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_INSTALL_FAILED,
      `无法连接 ${url}：${error instanceof Error ? error.message : String(error)}。请检查网络、代理或 registry 地址配置。`,
      { status: 502 }
    );
  }
}

async function fetchBuffer(
  url: string,
  ctx: SourceResolveContext,
  options: { token?: string }
): Promise<Buffer> {
  const response = await fetchWithAuth(url, ctx, options);
  if (!response.ok) {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_INSTALL_FAILED,
      `下载插件包失败（${response.status} ${response.statusText}）：${url}`,
      { status: 502, details: { url, status: response.status } }
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const limit = PLUGIN_ZIP_GUARD.maxArchiveBytes;
  if (buffer.byteLength > limit) {
    throw new RiceNoteError(
      ErrorCode.PLUGIN_ARCHIVE_UNSAFE,
      `插件包体积超出上限（${buffer.byteLength} > ${limit} 字节）`,
      { status: 413, details: { bytes: buffer.byteLength, limit } }
    );
  }
  return buffer;
}
