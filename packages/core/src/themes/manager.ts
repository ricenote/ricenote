/**
 * 主题管理器：发现、校验、安装、激活、设置合成与回滚。
 *
 * 与插件管理器的关键差异：
 * - 主题**不执行服务端代码**，因此无需生命周期钩子，只有"激活/切换"；
 * - 主题切换是单点原子操作（`rn_site_state.active_theme_id`），失败即回退；
 * - 设置三层合成在 `resolveSettings()` 中完成，公众请求永不读取草稿。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ErrorCode,
  RiceNoteError,
  createManifestValidator,
  satisfiesRange,
  type ThemeManifest,
  type ThemeSettingValues,
  type ThemeSummary,
  type ThemeSettingsGroupDto,
  type ValidationIssue
} from '@ricenote/shared';
import { composeSettings, buildDefaults } from '@ricenote/theme-sdk';
import type { RiceNoteConfig } from '../config/loader.js';
import type { Logger } from '../logger.js';
import type { DatabaseAdapter } from '../database/adapter.js';
import type { HtmlCache } from '../render/cache.js';
import { ThemeSettingsStore } from './settings.js';
import { extractZipSafely } from './zip-guard.js';

const THEME_API_VERSION = '1.0.0';
const manifestValidator = createManifestValidator();

export interface LoadedTheme {
  manifest: ThemeManifest;
  dir: string;
  templatesDir: string;
  assetsDir: string;
  screenshotPath?: string;
}

export interface InvalidTheme {
  dir: string;
  id?: string;
  issues: ValidationIssue[];
}

export interface ThemeManagerDeps {
  config: RiceNoteConfig;
  logger: Logger;
  db: DatabaseAdapter;
  cache: HtmlCache;
}

export class ThemeManager {
  public readonly settings: ThemeSettingsStore;
  private themes = new Map<string, LoadedTheme>();
  private invalidThemes: InvalidTheme[] = [];

  constructor(private readonly deps: ThemeManagerDeps) {
    this.settings = new ThemeSettingsStore(deps.db);
  }

  /* --------------------------- 发现与安装 --------------------------- */

  /** 扫描主题目录并完成 Manifest 校验与模板存在性检查。 */
  discover(): { themes: LoadedTheme[]; invalid: InvalidTheme[] } {
    const { themesDir } = this.deps.config.paths;
    this.themes = new Map();
    this.invalidThemes = [];

    if (!existsSync(themesDir)) {
      this.deps.logger.warn('主题目录不存在', { dir: themesDir });
      return { themes: [], invalid: [] };
    }

    for (const name of readdirSync(themesDir).sort()) {
      const dir = path.join(themesDir, name);
      if (!statSync(dir).isDirectory()) continue;

      const manifestPath = path.join(dir, 'theme.json');
      if (!existsSync(manifestPath)) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        this.invalidThemes.push({
          dir,
          issues: [{ path: '/', message: `theme.json 不是合法 JSON：${String(error)}` }]
        });
        continue;
      }

      const result = manifestValidator.validateTheme(parsed);
      if (!result.valid) {
        this.invalidThemes.push({ dir, issues: result.issues });
        continue;
      }

      const manifest = parsed as ThemeManifest;
      const issues: ValidationIssue[] = [];

      if (!satisfiesRange(THEME_API_VERSION, manifest.apiVersion)) {
        issues.push({
          path: '/apiVersion',
          message: `主题要求 Theme API ${manifest.apiVersion}，当前为 ${THEME_API_VERSION}`,
          keyword: 'apiVersion'
        });
      }

      const templatesDir = path.join(dir, 'templates');
      for (const [kind, file] of Object.entries(manifest.templates)) {
        if (!existsSync(path.join(templatesDir, file))) {
          issues.push({
            path: `/templates/${kind}`,
            message: `模板文件缺失：templates/${file}`,
            keyword: 'file'
          });
        }
      }

      if (issues.length > 0) {
        this.invalidThemes.push({ dir, id: manifest.id, issues });
        continue;
      }

      const screenshotPath = manifest.screenshot ? path.resolve(dir, manifest.screenshot) : undefined;
      this.themes.set(manifest.id, {
        manifest,
        dir,
        templatesDir,
        assetsDir: path.join(dir, 'assets'),
        ...(screenshotPath && existsSync(screenshotPath) ? { screenshotPath } : {})
      });
    }

    return { themes: [...this.themes.values()], invalid: this.invalidThemes };
  }

  /** 同步到 `rn_themes` 并确保站点有激活主题。 */
  async sync(): Promise<void> {
    this.discover();

    for (const theme of this.themes.values()) {
      await this.deps.db.execute(
        `INSERT INTO rn_themes (id, name, version, api_version, path, manifest_json, installed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           version = VALUES(version),
           api_version = VALUES(api_version),
           path = VALUES(path),
           manifest_json = VALUES(manifest_json),
           updated_at = NOW()`,
        [
          theme.manifest.id,
          theme.manifest.name,
          theme.manifest.version,
          theme.manifest.apiVersion,
          theme.dir,
          JSON.stringify(theme.manifest)
        ]
      );
    }

    // 清理磁盘上已不存在的主题记录（不删除文件，仅同步元数据）
    const known = [...this.themes.keys()];
    if (known.length > 0) {
      const placeholders = known.map(() => '?').join(', ');
      await this.deps.db.execute(`DELETE FROM rn_themes WHERE id NOT IN (${placeholders})`, known);
    }

    const site = await this.readSiteState();
    const fallbackId = this.resolveThemeId(this.deps.config.site.defaultTheme);

    if (!site) {
      await this.deps.db.execute(
        `INSERT INTO rn_site_state (site_id, active_theme_id, runtime_status, app_version, updated_at)
         VALUES (?, ?, 'starting', ?, NOW())`,
        [this.deps.config.site.id, fallbackId ?? null, '0.1.0']
      );
      return;
    }

    const activeId = site.activeThemeId ? this.resolveThemeId(site.activeThemeId) : undefined;
    if (!activeId) {
      if (fallbackId) {
        this.deps.logger.warn('激活主题不可用，回退到默认主题', {
          previous: site.activeThemeId,
          next: fallbackId
        });
        await this.deps.db.execute(
          'UPDATE rn_site_state SET active_theme_id = ?, updated_at = NOW() WHERE site_id = ?',
          [fallbackId, this.deps.config.site.id]
        );
      }
    }
  }

  /* --------------------------- 查询 --------------------------- */

  async getActive(): Promise<LoadedTheme> {
    const site = await this.readSiteState();
    const activeId = this.resolveThemeId(
      site?.activeThemeId ?? this.deps.config.site.defaultTheme
    );
    const theme = (activeId ? this.themes.get(activeId) : undefined) ?? [...this.themes.values()][0];

    if (!theme) {
      throw new RiceNoteError(ErrorCode.THEME_NOT_FOUND, '没有任何可用主题，请先安装主题', {
        status: 503
      });
    }
    return theme;
  }

  getTheme(themeId: string): LoadedTheme | undefined {
    return this.themes.get(themeId);
  }

  listLoaded(): LoadedTheme[] {
    return [...this.themes.values()].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  }

  getInvalidThemes(): InvalidTheme[] {
    return this.invalidThemes;
  }

  /** 后台主题列表（含设置分组与依赖缺失信息）。 */
  async listSummaries(availableCapabilities: readonly string[] = []): Promise<ThemeSummary[]> {
    const site = await this.readSiteState();
    const activeId = site?.activeThemeId ?? this.deps.config.site.defaultTheme;
    const summaries: ThemeSummary[] = [];

    for (const theme of this.listLoaded()) {
      const { values } = await this.resolveSettings(theme);
      const requires = Object.keys(theme.manifest.requires ?? {});
      const missingRequirements = requires.filter((key) => !availableCapabilities.includes(key));

      summaries.push({
        id: theme.manifest.id,
        name: theme.manifest.name,
        ...(theme.manifest.description ? { description: theme.manifest.description } : {}),
        version: theme.manifest.version,
        apiVersion: theme.manifest.apiVersion,
        ...(theme.manifest.author ? { author: theme.manifest.author } : {}),
        ...(theme.screenshotPath ? { screenshotUrl: `/api/admin/themes/${theme.manifest.id}/screenshot` } : {}),
        active: theme.manifest.id === activeId,
        path: theme.dir,
        templates: theme.manifest.templates,
        requires,
        missingRequirements,
        settingsGroups: buildSettingGroups(theme.manifest, values)
      });
    }

    return summaries;
  }

  /* --------------------------- 设置 --------------------------- */

  /**
   * 合成主题生效设置。
   * @param draft 预览草稿（仅后台预览传入，公众请求必须为空）。
   */
  async resolveSettings(
    theme: LoadedTheme,
    draft?: ThemeSettingValues
  ): Promise<{ values: ThemeSettingValues; revision: number }> {
    const defaults = buildDefaults(theme.manifest);
    const published = await this.settings.getPublished(this.deps.config.site.id, theme.manifest.id);
    const values = composeSettings(defaults, published?.values, draft);
    return { values, revision: published?.revision ?? 0 };
  }

  /* --------------------------- 激活 --------------------------- */

  /**
   * 激活主题。
   *
   * 流程：校验目标主题 → 校验模板齐备 → 事务更新 `rn_site_state` → 清缓存 → 审计。
   * 任一步失败保持原主题不变。
   */
  async activate(themeId: string, actorId?: number): Promise<void> {
    const theme = this.themes.get(themeId);
    if (!theme) {
      throw new RiceNoteError(ErrorCode.THEME_NOT_FOUND, `主题不存在或校验未通过：${themeId}`, {
        status: 404,
        details: { themeId }
      });
    }

    const issues = this.invalidThemes.find((item) => item.id === themeId)?.issues;
    if (issues && issues.length > 0) {
      throw new RiceNoteError(ErrorCode.THEME_INVALID, `主题 ${themeId} 校验未通过，无法激活`, {
        status: 400,
        details: { issues }
      });
    }

    for (const [kind, file] of Object.entries(theme.manifest.templates)) {
      if (!existsSync(path.join(theme.templatesDir, file))) {
        throw new RiceNoteError(
          ErrorCode.THEME_TEMPLATE_MISSING,
          `主题 ${themeId} 缺少模板 templates/${file}（kind=${kind}）`,
          { status: 400, details: { kind, file } }
        );
      }
    }

    const previous = (await this.readSiteState())?.activeThemeId ?? null;

    await this.deps.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO rn_site_state (site_id, active_theme_id, runtime_status, app_version, updated_at)
         VALUES (?, ?, 'running', ?, NOW())
         ON DUPLICATE KEY UPDATE active_theme_id = VALUES(active_theme_id), updated_at = NOW()`,
        [this.deps.config.site.id, themeId, '0.1.0']
      );
      await tx.execute(
        `INSERT INTO rn_audit_logs (site_id, actor_id, action, target_type, target_id, detail_json, created_at)
         VALUES (?, ?, 'theme.activate', 'theme', ?, CAST(? AS JSON), NOW())`,
        [
          this.deps.config.site.id,
          actorId ?? null,
          themeId,
          JSON.stringify({ previous, next: themeId })
        ]
      );
    });

    // 主题变化必须清空 HTML 缓存，避免旧主题页面残留
    this.deps.cache.clear();
    this.deps.logger.info('主题已切换', { from: previous, to: themeId });
  }

  /* --------------------------- 安装 / 卸载 --------------------------- */

  /** 从 ZIP 安装主题（安全校验后解压到主题目录）。 */
  async installFromZip(archive: Buffer): Promise<{ themeId: string; dir: string }> {
    const stagingDir = path.join(this.deps.config.paths.cacheDir, `theme-install-${Date.now()}`);
    mkdirSync(stagingDir, { recursive: true });

    try {
      extractZipSafely(archive, stagingDir);

      // 兼容"压缩包内多了一层目录"的常见打包方式
      const root = locateThemeRoot(stagingDir);
      const manifestPath = path.join(root, 'theme.json');
      if (!existsSync(manifestPath)) {
        throw new RiceNoteError(ErrorCode.THEME_INVALID, '压缩包中未找到 theme.json', { status: 400 });
      }

      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
      const result = manifestValidator.validateTheme(parsed);
      if (!result.valid) {
        throw new RiceNoteError(ErrorCode.THEME_INVALID, '主题 Manifest 校验失败', {
          status: 400,
          details: { issues: result.issues }
        });
      }

      const manifest = parsed as ThemeManifest;
      const targetDir = path.join(this.deps.config.paths.themesDir, manifest.id);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      mkdirSync(path.dirname(targetDir), { recursive: true });
      copyDirectory(root, targetDir);

      this.deps.logger.info('主题已安装', { theme: manifest.id, dir: targetDir });
      return { themeId: manifest.id, dir: targetDir };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  /** 卸载主题（禁止卸载当前激活主题）。 */
  async remove(themeId: string): Promise<void> {
    const theme = this.themes.get(themeId);
    if (!theme) {
      throw new RiceNoteError(ErrorCode.THEME_NOT_FOUND, `主题不存在：${themeId}`, { status: 404 });
    }
    const site = await this.readSiteState();
    if (site?.activeThemeId === themeId) {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, '无法卸载当前激活的主题', {
        status: 409,
        details: { themeId }
      });
    }

    rmSync(theme.dir, { recursive: true, force: true });
    await this.deps.db.execute('DELETE FROM rn_themes WHERE id = ?', [themeId]);
    await this.themes.delete(themeId);
    this.deps.logger.info('主题已卸载', { theme: themeId });
  }

  /** 供后台截图接口使用。 */
  screenshotOf(themeId: string): string | undefined {
    return this.themes.get(themeId)?.screenshotPath;
  }

  /* --------------------------- 内部 --------------------------- */

  /**
   * 把主题标识解析为已安装主题的 ID。
   *
   * 支持两种写法，便于部署配置书写简洁：
   * - 完整 ID：`rice.minimal`
   * - 短名：`minimal`（匹配 ID 的最后一段；唯一命中时才生效）
   */
  resolveThemeId(themeIdOrShortName: string): string | undefined {
    if (!themeIdOrShortName) return undefined;
    if (this.themes.has(themeIdOrShortName)) return themeIdOrShortName;

    const matched = [...this.themes.keys()].filter(
      (id) => id === themeIdOrShortName || id.endsWith(`.${themeIdOrShortName}`)
    );
    if (matched.length === 1) return matched[0];

    return [...this.themes.keys()].sort()[0];
  }

  private async readSiteState(): Promise<{ activeThemeId: string | null } | undefined> {
    const rows = await this.deps.db.query<{ active_theme_id: string | null }>(
      'SELECT active_theme_id FROM rn_site_state WHERE site_id = ? LIMIT 1',
      [this.deps.config.site.id]
    );
    const row = rows[0];
    return row ? { activeThemeId: row.active_theme_id } : undefined;
  }
}

/** 在解压目录中定位真正的主题根（兼容多包一层目录）。 */
function locateThemeRoot(dir: string): string {
  if (existsSync(path.join(dir, 'theme.json'))) return dir;
  const children = readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isDirectory());
  if (children.length === 1) {
    const nested = path.join(dir, children[0] as string);
    if (existsSync(path.join(nested, 'theme.json'))) return nested;
  }
  return dir;
}

function copyDirectory(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source)) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    if (statSync(from).isDirectory()) {
      copyDirectory(from, to);
    } else {
      writeFileSync(to, readFileSync(from));
    }
  }
}

/** 把 Manifest 的 settings 声明与该主题当前值合并为后台可渲染的 DTO。 */
function buildSettingGroups(
  manifest: ThemeManifest,
  values: ThemeSettingValues
): ThemeSettingsGroupDto[] {
  const groups = manifest.settings ?? {};
  return Object.entries(groups).map(([key, group]) => ({
    key,
    label: group.label,
    ...(group.description ? { description: group.description } : {}),
    fields: Object.entries(group.fields ?? {}).map(([fieldKey, field]) => ({
      ...field,
      key: fieldKey,
      value: values[fieldKey] ?? field.default ?? null,
      default: field.default ?? null
    }))
  }));
}
