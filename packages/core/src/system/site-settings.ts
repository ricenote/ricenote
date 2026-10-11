/**
 * 站点信息运行时设置（env 默认值 → 数据库覆盖层）。
 *
 * 为什么需要覆盖层：`.env` 属于部署配置，改一次要重启进程；
 * 而站点标题/描述/地址这类信息更适合在后台即改即生效。
 * 因此这里采用**稀疏覆盖**：
 *   - `.env` 始终是默认值与兜底来源；
 *   - `rn_site_settings.settings_json` 只存被后台显式修改过的字段；
 *   - 清空某个键即回落到 `.env`（`delete` 覆盖项，而不是写入空字符串）。
 *
 * 读取路径为同步（`info()`），因为渲染与 `ctx.site` 都在热路径上；
 * 写入路径负责校验白名单 + 乐观锁，并在成功后失效缓存。
 */

import {
  ErrorCode,
  RiceNoteError,
  type EffectiveSiteInfo,
  type SiteSettingsUpdate,
  type ValidationIssue
} from '@ricenote/shared';
import type { RiceNoteConfig } from '../config/loader.js';
import type { Logger } from '../logger.js';
import type { DatabaseAdapter } from '../database/adapter.js';

/** 允许后台写入的字段白名单（其余键一律拒绝，防止任意配置注入）。 */
export const SITE_SETTING_KEYS = [
  'title',
  'description',
  'language',
  'url',
  'logoUrl',
  'faviconUrl',
  'icpText',
  'icpUrl'
] as const;

export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number];

/** 受管的本地资源前缀：只允许媒体库产出的路径。 */
const MANAGED_ASSET_PREFIX = /^\/(?:uploads|media)\//;
const LANGUAGE_PATTERN = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;

export interface SiteSettingsProviderDeps {
  config: RiceNoteConfig;
  logger: Logger;
  db: DatabaseAdapter;
}

export interface SiteSettingsUpdateResult {
  info: EffectiveSiteInfo;
  /** 相对上一次的 revision。 */
  revision: number;
}

export class SiteSettingsProvider {
  /** 数据库中的稀疏覆盖项。 */
  private values: Record<string, unknown> = {};
  private revision = 0;
  private loaded = false;
  private loading: Promise<void> | undefined;

  constructor(private readonly deps: SiteSettingsProviderDeps) {}

  /** 首次载入（bootstrap 阶段调用一次）。 */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = this.reload().finally(() => {
        this.loading = undefined;
      });
    }
    await this.loading;
  }

  /** 强制从数据库重新载入（备份恢复等场景）。 */
  async refresh(): Promise<void> {
    this.loaded = false;
    await this.ensureLoaded();
  }

  /** 生效中的站点信息（同步，带内存缓存）。 */
  info(): EffectiveSiteInfo {
    const { config } = this.deps;
    const pick = (key: SiteSettingKey): string | undefined => {
      const value = this.values[key];
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    };

    return {
      siteId: config.site.id,
      title: pick('title') ?? config.site.title,
      description: pick('description') ?? config.site.description,
      language: pick('language') ?? config.site.language,
      url: pick('url') ?? config.http.siteUrl,
      ...optional('logoUrl', pick('logoUrl')),
      ...optional('faviconUrl', pick('faviconUrl')),
      ...optional('icpText', pick('icpText')),
      ...optional('icpUrl', pick('icpUrl')),
      revision: this.revision,
      overridden: Object.keys(this.values).sort()
    };
  }

  /** 已覆盖的字段名（用于后台提示"该项已覆盖 .env"）。 */
  overriddenKeys(): SiteSettingKey[] {
    return SITE_SETTING_KEYS.filter((key) => this.values[key] !== undefined);
  }

  /** 写入站点信息（白名单校验 + 乐观锁）。 */
  async update(input: SiteSettingsUpdate, actorId?: number): Promise<SiteSettingsUpdateResult> {
    await this.ensureLoaded();

    if (input.revision !== undefined && input.revision !== this.revision) {
      throw new RiceNoteError(
        ErrorCode.REVISION_CONFLICT,
        '站点信息已被其他人修改，请重新加载后再保存',
        { status: 409, details: { expected: input.revision, actual: this.revision } }
      );
    }

    const result = validateSiteSettingsUpdate(input);
    if (!result.valid) {
      throw new RiceNoteError(ErrorCode.SITE_SETTING_INVALID, '站点信息校验失败', {
        status: 400,
        details: { issues: result.issues }
      });
    }

    const merged: Record<string, unknown> = { ...this.values };
    for (const [key, value] of Object.entries(result.normalized)) {
      if (value === null || value === '') {
        // 显式清空 = 移除覆盖，回落到 .env 默认值
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }

    await this.persist(merged, actorId);
    this.values = merged;
    this.revision += 1;
    this.deps.logger.info('站点信息已更新', { revision: this.revision, fields: Object.keys(result.normalized) });

    return { info: this.info(), revision: this.revision };
  }

  /* --------------------------- 内部 --------------------------- */

  private async reload(): Promise<void> {
    const { config, db } = this.deps;
    const rows = await db.query<{ settings_json: string | Record<string, unknown>; revision: number }>(
      'SELECT settings_json, revision FROM rn_site_settings WHERE site_id = ? LIMIT 1',
      [config.site.id]
    );
    const row = rows[0];
    this.values = row ? parseJsonObject(row.settings_json) : {};
    this.revision = row ? Number(row.revision) : 0;
    this.loaded = true;
  }

  private async persist(values: Record<string, unknown>, actorId?: number): Promise<void> {
    const { config, db } = this.deps;
    const payload = JSON.stringify(values);
    await db.execute(
      `INSERT INTO rn_site_settings (site_id, settings_json, revision, updated_by, updated_at)
       VALUES (?, CAST(? AS JSON), 1, ?, NOW())
       ON DUPLICATE KEY UPDATE
         settings_json = VALUES(settings_json),
         revision = revision + 1,
         updated_by = VALUES(updated_by),
         updated_at = NOW()`,
      [config.site.id, payload, actorId ?? null]
    );
  }
}

/** 只把有值的可选项挂到对象上，避免出现 `logoUrl: undefined` 这类噪声键。 */
function optional(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

/** `settings_json` 在不同驱动配置下可能是对象或字符串。 */
function parseJsonObject(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export interface SiteSettingsValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** 归一化后的补丁（`''`/`null` 表示清除该覆盖项）。 */
  normalized: Record<string, unknown>;
}

/**
 * 校验站点信息更新补丁。
 *
 * 只接受 `SITE_SETTING_KEYS` 中的键；未声明的键直接判为非法，
 * 因此后台无法借该接口写入任意配置（说明书第 10 章的配置写入约束）。
 */
export function validateSiteSettingsUpdate(input: SiteSettingsUpdate): SiteSettingsValidationResult {
  const issues: ValidationIssue[] = [];
  const normalized: Record<string, unknown> = {};
  const entries = Object.entries(input as Record<string, unknown>);

  if (entries.length === 0) {
    issues.push({ path: '/', message: '没有需要更新的字段', keyword: 'minProperties' });
  }

  for (const [key, raw] of entries) {
    if (key === 'revision') continue;
    if (!SITE_SETTING_KEYS.includes(key as SiteSettingKey)) {
      issues.push({ path: `/${key}`, message: `不允许修改该字段：${key}`, keyword: 'unknownField' });
      continue;
    }

    const checked = checkValue(key as SiteSettingKey, raw);
    if (checked.ok) {
      normalized[key] = checked.value;
    } else {
      issues.push({ path: `/${key}`, message: checked.message, keyword: checked.keyword });
    }
  }

  return { valid: issues.length === 0, issues, normalized };
}

function checkValue(
  key: SiteSettingKey,
  raw: unknown
): { ok: true; value: string | null } | { ok: false; message: string; keyword: string } {
  const fail = (message: string, keyword = 'format') => ({ ok: false as const, message, keyword });
  const asString = (): { ok: true; text: string } | { ok: false; message: string; keyword: string } => {
    if (raw === null || raw === undefined) return { ok: true, text: '' };
    if (typeof raw !== 'string') return fail('期望字符串', 'type');
    return { ok: true, text: raw.trim() };
  };

  const text = asString();
  if (!text.ok) return text;
  const value = text.text;

  const requireText = (max: number, allowEmpty: boolean): ReturnType<typeof checkValue> => {
    if (!allowEmpty && value.length === 0) return fail('不能为空', 'minLength');
    if (value.length > max) return fail(`长度不得超过 ${max}`, 'maxLength');
    return { ok: true, value };
  };

  const requireHttpUrl = (max: number, allowEmpty: boolean): ReturnType<typeof checkValue> => {
    if (value.length === 0) return allowEmpty ? { ok: true, value } : fail('不能为空', 'minLength');
    if (value.length > max) return fail(`长度不得超过 ${max}`, 'maxLength');
    if (!/^https?:\/\//i.test(value)) return fail('必须以 http:// 或 https:// 开头');
    return { ok: true, value };
  };

  switch (key) {
    case 'title':
      return requireText(160, false);
    case 'description':
      return requireText(500, true);
    case 'language':
      if (!LANGUAGE_PATTERN.test(value)) return fail('语言标签形如 zh-CN 或 en');
      return { ok: true, value };
    case 'url':
      if (value.length === 0) return fail('站点地址不能为空', 'minLength');
      if (value.length > 300) return fail('长度不得超过 300', 'maxLength');
      if (!/^https?:\/\//i.test(value)) return fail('必须以 http:// 或 https:// 开头');
      // 统一去掉尾部斜杠，避免与 absoluteUrl 拼接出双斜杠
      return { ok: true, value: value.replace(/\/+$/, '') };
    case 'logoUrl':
    case 'faviconUrl':
      if (value.length === 0) return { ok: true, value: '' };
      if (value.length > 500) return fail('长度不得超过 500', 'maxLength');
      if (/^https?:\/\//i.test(value) || MANAGED_ASSET_PREFIX.test(value)) return { ok: true, value };
      return fail('必须是 http(s) 地址或媒体库相对路径（/uploads/...）');
    case 'icpText':
      return requireText(120, true);
    case 'icpUrl':
      return requireHttpUrl(300, true);
    default:
      return fail('未知字段', 'unknownField');
  }
}
