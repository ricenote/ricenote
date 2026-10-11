/**
 * 主题 ZIP 安装的安全校验。
 *
 * 防护清单（说明书第 10 章）：
 * - 压缩包体积与条目数限额；
 * - 单条目与总解压体积限额（zip bomb）；
 * - Zip Slip：拒绝绝对路径、`..` 穿越、Windows 盘符与反斜杠绕过；
 * - 符号链接穿越：识别并拒绝指向外部的 symlink 条目；
 * - 扩展名白名单：只允许主题合法的静态资源类型；
 * - 路径深度限制，避免畸形目录树。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { ErrorCode, RiceNoteError } from '@ricenote/shared';

export interface ZipGuardOptions {
  maxArchiveBytes: number;
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxEntryUncompressedBytes: number;
  maxPathDepth: number;
  allowedExtensions: string[];
}

export const DEFAULT_ZIP_GUARD: ZipGuardOptions = {
  maxArchiveBytes: 32 * 1024 * 1024,
  maxEntries: 3000,
  maxTotalUncompressedBytes: 128 * 1024 * 1024,
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxPathDepth: 12,
  allowedExtensions: [
    '.json', '.njk', '.html', '.htm', '.css', '.js', '.mjs',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.md', '.txt', '.map'
  ]
};

/** 判定非法路径穿越。 */
function unsafePathReason(entryName: string): string | undefined {
  if (entryName.includes('\0')) return '包含空字节';
  if (/^[a-zA-Z]:/.test(entryName)) return '包含 Windows 盘符';
  if (entryName.startsWith('/') || entryName.startsWith('\\')) return '使用了绝对路径';
  if (entryName.includes('\\')) return '包含反斜杠（可能是绕过尝试）';

  const segments = entryName.split('/');
  if (segments.some((segment) => segment === '..')) return '包含 .. 路径穿越';
  if (segments.length > DEFAULT_ZIP_GUARD.maxPathDepth) return '目录层级过深';

  return undefined;
}

/** 判断条目是否为符号链接（Unix mode 高位为 0xA000）。 */
function isSymlink(entry: AdmZip.IZipEntry): boolean {
  const attr = (entry.header as unknown as { attr?: number }).attr;
  if (typeof attr !== 'number' || attr === 0) return false;
  const unixMode = (attr >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

function fail(message: string, details?: Record<string, unknown>): never {
  throw new RiceNoteError(ErrorCode.THEME_ARCHIVE_UNSAFE, message, { status: 400, details });
}

/**
 * 安全解压 ZIP 到目标目录。
 *
 * 所有校验在写入任何文件之前完成（两阶段：先校验，再落盘），
 * 避免"部分写入后才发现恶意条目"的中间态。
 */
export function extractZipSafely(
  archive: Buffer,
  targetDir: string,
  options: ZipGuardOptions = DEFAULT_ZIP_GUARD
): { files: string[] } {
  if (archive.byteLength > options.maxArchiveBytes) {
    fail(`压缩包体积超出上限（${Math.round(options.maxArchiveBytes / 1024 / 1024)}MB）`, {
      size: archive.byteLength
    });
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(archive);
  } catch (error) {
    fail(`无法解析压缩包：${String(error)}`);
  }

  const entries = zip.getEntries();
  if (entries.length > options.maxEntries) {
    fail(`压缩包条目数超出上限（${options.maxEntries}）`, { count: entries.length });
  }

  const absoluteTarget = path.resolve(targetDir);
  const planned: { entry: AdmZip.IZipEntry; destination: string; relative: string }[] = [];
  let totalUncompressed = 0;

  for (const entry of entries) {
    const rawName = entry.entryName;

    if (entry.isDirectory) {
      const reason = unsafePathReason(rawName.replace(/\/$/, '') + '/');
      if (reason) fail(`目录条目路径非法（${reason}）：${rawName}`, { entry: rawName });
      continue;
    }

    const reason = unsafePathReason(rawName);
    if (reason) fail(`条目路径非法（${reason}）：${rawName}`, { entry: rawName, reason });

    if (isSymlink(entry)) {
      fail(`拒绝符号链接条目：${rawName}`, { entry: rawName });
    }

    const extension = path.extname(rawName).toLowerCase();
    if (!options.allowedExtensions.includes(extension)) {
      fail(`不允许的文件类型：${rawName}`, { entry: rawName, extension });
    }

    const size = entry.header.size;
    if (size > options.maxEntryUncompressedBytes) {
      fail(`单文件解压体积超出上限：${rawName}`, { entry: rawName, size });
    }
    totalUncompressed += size;
    if (totalUncompressed > options.maxTotalUncompressedBytes) {
      fail('压缩包解压后总体积超出上限', { totalUncompressed });
    }

    const destination = path.resolve(absoluteTarget, rawName);
    // 归一化后再确认仍位于目标目录内部（双保险）
    if (destination !== absoluteTarget && !destination.startsWith(`${absoluteTarget}${path.sep}`)) {
      fail(`条目路径逃逸出目标目录：${rawName}`, { entry: rawName, destination });
    }

    planned.push({ entry, destination, relative: rawName });
  }

  mkdirSync(absoluteTarget, { recursive: true });

  const written: string[] = [];
  for (const item of planned) {
    if (existsSync(item.destination)) {
      // 覆盖安装：允许同名文件被替换
      writeFileSync(item.destination, item.entry.getData());
      written.push(item.relative);
      continue;
    }
    mkdirSync(path.dirname(item.destination), { recursive: true });
    writeFileSync(item.destination, item.entry.getData());
    written.push(item.relative);
  }

  return { files: written };
}
