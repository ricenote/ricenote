/**
 * Capability（能力契约）解析与版本匹配工具。
 *
 * 契约格式：`<namespace>.<name>@<major>`，例如 `content.posts@1`。
 * - 依赖声明键既可以是 capability 契约，也可以是插件 ID（如 `rice.posts`）。
 * - 本模块只负责"字符串层"的解析与判定，不涉及插件发现。
 */

import semver from 'semver';
import { ErrorCode, RiceNoteError } from './errors.js';

export interface CapabilityRef {
  /** 完整原文，例如 `content.posts@1` */
  raw: string;
  /** 命名空间路径，例如 `content.posts` */
  name: string;
  /** 主版本号，例如 `1` */
  major: number;
}

const CAPABILITY_PATTERN = /^([a-z][a-z0-9]*(?:[.-][a-z0-9]+)*)@(\d+)$/;

/** 解析 capability 契约字符串；格式非法时抛出领域错误。 */
export function parseCapability(raw: string): CapabilityRef {
  const matched = CAPABILITY_PATTERN.exec(raw);
  if (!matched) {
    throw new RiceNoteError(
      ErrorCode.MANIFEST_INVALID,
      `capability 契约格式非法：${raw}（期望形如 content.posts@1）`,
      { status: 400, details: { value: raw } }
    );
  }
  const name = matched[1] as string;
  const majorText = matched[2] as string;
  return { raw, name, major: Number.parseInt(majorText, 10) };
}

/** 判断某个字符串是否为合法 capability 契约。 */
export function isCapability(raw: string): boolean {
  return CAPABILITY_PATTERN.test(raw);
}

export interface ProvidedCapability {
  pluginId: string;
  raw: string;
  ref: CapabilityRef;
}

/**
 * 在已声明的 capability 集合中查找提供者。
 * 优先精确匹配 major 版本；找不到时返回 undefined。
 */
export function findProvider(
  provided: readonly ProvidedCapability[],
  raw: string
): ProvidedCapability | undefined {
  const exact = provided.find((entry) => entry.raw === raw);
  if (exact) return exact;

  if (!isCapability(raw)) return undefined;
  const target = parseCapability(raw);
  return provided.find(
    (entry) => entry.ref.name === target.name && entry.ref.major === target.major
  );
}

/** 校验版本是否落在 semver 区间内；非法区间会抛出领域错误。 */
export function satisfiesRange(version: string, range: string): boolean {
  const normalized = semver.validRange(range);
  if (!normalized) {
    throw new RiceNoteError(
      ErrorCode.API_VERSION_UNSUPPORTED,
      `版本区间非法：${range}`,
      { status: 400, details: { range } }
    );
  }
  return semver.satisfies(version, normalized, { includePrerelease: true });
}

/** 判断依赖键是否为 capability 契约（否则视为插件 ID）。 */
export function isCapabilityKey(key: string): boolean {
  return isCapability(key);
}

/** 从插件版本推导其对外提供的主版本（用于 capability 记录校验）。 */
export function majorOf(version: string): number | undefined {
  const parsed = semver.parse(version);
  return parsed ? parsed.major : undefined;
}
