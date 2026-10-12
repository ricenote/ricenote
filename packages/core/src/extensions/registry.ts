/**
 * 命名扩展点注册表：声明 — 贡献 — 渲染/触发 的唯一事实来源。
 *
 * 三个作用域共用一套记录结构与裁决规则，但**不解释 payload**：
 * - `render`：payload 是 `SlotComponent`（由 `SlotRegistry` 门面渲染，保留单组件隔离）；
 * - `admin`：payload 是"浏览器可 import 的模块 URL"，由后台 SPA 的 `PluginSlot` 渲染；
 * - `server`：payload 是 `ExtensionHookModule`，由提供方用 `apply()` 串行触发。
 *
 * 与既有 `SlotRegistry` 的关系：后者退化为本注册表的 **render 作用域门面**，
 * 签名与错误隔离行为保持不变，因此主题渲染路径与第三方插件（如 reading-time）无需改动。
 */

import { ErrorCode, RiceNoteError } from '@ricenote/shared';
import { STANDARD_SLOTS } from '@ricenote/plugin-sdk';
import type {
  Dispose,
  ExtensionHookContext,
  ExtensionHookModule,
  ExtensionMode,
  ExtensionPointDeclaration,
  ExtensionErrorPolicy,
  ExtensionScope
} from '@ricenote/plugin-sdk';
import type { Logger } from '../logger.js';

/**
 * 扩展点名：`<pluginId>.<area>[.<position>]`，或 Core 预置的标准渲染插槽名。
 *
 * 段内**允许驼峰**：标准插槽里有 `post.beforeContent` / `post.afterContent`
 * 这类历史命名（theme-api §6 已对外承诺），正则若只认小写会把它们判为非法，
 * 于是插件 `start()` 时注册插槽直接抛错、连页面路由都注册不上。
 */
const POINT_PATTERN = /^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)+$/;

/** Core 预置扩展点的提供方标识。 */
export const CORE_PROVIDER = 'core';

/** admin 作用域贡献的附加元数据（声明式解析时带上，供后台接口下发）。 */
export interface AdminContributionMeta {
  /** 插件目录内的入口相对路径（如 ./admin/editor.js）。 */
  entry: string;
  style?: string;
  permission?: string;
  label?: string;
  /** 贡献方插件 ID（便于后台排错与分组）。 */
  pluginId: string;
}

export interface ExtensionContributionRecord {
  point: string;
  scope: ExtensionScope;
  /** 声明该扩展点的插件 ID；未声明（仅告警）时为空字符串。 */
  providerId: string;
  consumerId: string;
  mode: ExtensionMode;
  order: number;
  /** 稳定排序用的注册序号。 */
  sequence: number;
  payload: unknown;
  meta?: AdminContributionMeta;
}

export interface ExtensionDeclarationRecord {
  name: string;
  scope: ExtensionScope;
  replaceable: boolean;
  providerId: string;
  description?: string;
  props?: { name: string; description: string }[];
  sequence: number;
}

export interface ExtensionPointSummary {
  point: string;
  scope: ExtensionScope;
  provider: string;
  contributions: number;
}

export class ExtensionRegistry {
  private readonly declarations = new Map<string, ExtensionDeclarationRecord>();
  private contributions: ExtensionContributionRecord[] = [];
  private sequence = 0;

  constructor(private readonly logger: Logger) {
    /*
     * Core 预置标准渲染插槽：主题模板里 `{{ slot('post.comments') }}` 依赖它们。
     * 预置让"贡献到标准插槽"永远不需要先声明，且校验阶段不会报"扩展点不存在"。
     */
    for (const name of STANDARD_SLOTS) {
      this.declarations.set(name, {
        name,
        scope: 'render',
        replaceable: true,
        providerId: CORE_PROVIDER,
        description: 'Core 预置的标准渲染插槽（见 theme-api §6）',
        sequence: ++this.sequence
      });
    }
  }

  /* ------------------------------- 声明（提供方） ------------------------------- */

  declare(pluginId: string, declaration: ExtensionPointDeclaration): Dispose {
    if (!POINT_PATTERN.test(declaration.name)) {
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `扩展点名不合法：${declaration.name}（应形如 rice.posts.list.actions）`,
        { status: 400, details: { pluginId, point: declaration.name } }
      );
    }

    const existing = this.declarations.get(declaration.name);
    if (existing && existing.providerId !== pluginId && existing.providerId !== CORE_PROVIDER) {
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `扩展点 ${declaration.name} 已由插件 ${existing.providerId} 声明`,
        { status: 409, details: { pluginId, owner: existing.providerId } }
      );
    }
    if (existing && existing.providerId === CORE_PROVIDER) {
      // 覆盖 Core 预置插槽的元数据不改变其存在性，只更新契约说明
      this.logger.warn('插件重复声明了 Core 预置插槽，已忽略其声明', {
        plugin: pluginId,
        point: declaration.name
      });
      return () => undefined;
    }

    const record: ExtensionDeclarationRecord = {
      name: declaration.name,
      scope: declaration.scope,
      replaceable: declaration.replaceable ?? true,
      providerId: pluginId,
      ...(declaration.description ? { description: declaration.description } : {}),
      ...(declaration.props ? { props: declaration.props } : {}),
      sequence: ++this.sequence
    };
    this.declarations.set(record.name, record);

    return () => {
      if (this.declarations.get(record.name) === record) this.declarations.delete(record.name);
    };
  }

  /* ------------------------------ 贡献（消费方） ------------------------------ */

  contribute(
    pluginId: string,
    point: string,
    payload: unknown,
    options?: {
      scope?: ExtensionScope;
      mode?: ExtensionMode;
      order?: number;
      meta?: AdminContributionMeta;
    }
  ): Dispose {
    if (!POINT_PATTERN.test(point)) {
      throw new RiceNoteError(ErrorCode.VALIDATION_FAILED, `扩展点名不合法：${point}`, {
        status: 400,
        details: { pluginId, point }
      });
    }

    const scope = options?.scope ?? 'render';
    const mode = options?.mode ?? 'append';
    const declaration = this.declarations.get(point);

    /*
     * 未声明的扩展点**只告警不拒绝**：插件启停顺序不确定，
     * 消费方完全可能先于提供方启动。真正的拼写错误由 `pnpm validate` 静态拦下。
     */
    if (!declaration) {
      this.logger.warn('贡献指向未声明的扩展点（可能是拼写错误）', {
        plugin: pluginId,
        point,
        scope
      });
    } else if (
      mode === 'replace' &&
      !declaration.replaceable &&
      pluginId !== declaration.providerId
    ) {
      /*
       * `replaceable` 管的是**别人**能不能替换这个扩展点的内容，不管提供方自己。
       *
       * 提供方贡献一份 replace 往往是它最自然的出厂形态：媒体库声明
       * `rice.media.picker`，默认实现就是自己的选择面板 —— 它就是"默认内容"本身，
       * 没有理由被自己声明的开关拦下。若这里不排除提供方，`replaceable: false`
       * 就会被逼成"任何插件都能替换我的面板"，语义反而失真。
       */
      throw new RiceNoteError(
        ErrorCode.VALIDATION_FAILED,
        `扩展点 ${point} 声明为不可替换（replaceable: false），拒绝其他插件的 replace 贡献`,
        { status: 400, details: { pluginId, point, providerId: declaration.providerId } }
      );
    }

    const record: ExtensionContributionRecord = {
      point,
      scope,
      providerId: declaration?.providerId ?? '',
      consumerId: pluginId,
      mode,
      order: options?.order ?? 0,
      sequence: ++this.sequence,
      payload,
      ...(options?.meta ? { meta: options.meta } : {})
    };
    this.contributions.push(record);

    return () => {
      const index = this.contributions.indexOf(record);
      if (index >= 0) this.contributions.splice(index, 1);
    };
  }

  /* ------------------------------ 生效裁决（渲染/触发） ------------------------------ */

  /**
   * 计算某扩展点的生效贡献。
   *
   * - 存在 `replace` 贡献 → 默认内容与 `append` 贡献都不呈现，只返回胜出者；
   * - 否则按 `order` **降序**返回全部（同序保持注册顺序）。
   *
   * 胜出者判据：`order` 最大；同分取 `consumerId` 字典序在前的那个并记警告
   * （`pnpm validate` 会把这种冲突判为错误，运行期不猜）。
   */
  effective(point: string, scope: ExtensionScope): ExtensionContributionRecord[] {
    const scoped = this.contributions.filter(
      (entry) => entry.point === point && entry.scope === scope
    );
    if (scoped.length === 0) return [];

    const replacements = scoped.filter((entry) => entry.mode === 'replace');
    if (replacements.length > 0) {
      const ranked = [...replacements].sort(
        (left, right) =>
          right.order - left.order ||
          left.consumerId.localeCompare(right.consumerId) ||
          left.sequence - right.sequence
      );
      const winner = ranked[0]!;
      const tied = ranked.filter((entry) => entry.order === winner.order);
      if (tied.length > 1) {
        this.logger.warn('同一扩展点上存在多个同优先级的 replace 贡献，已按插件 ID 取其一', {
          point,
          scope,
          winner: winner.consumerId,
          others: tied.slice(1).map((entry) => entry.consumerId)
        });
      }
      return [winner];
    }

    return [...scoped].sort(
      (left, right) => right.order - left.order || left.sequence - right.sequence
    );
  }

  hasReplace(point: string, scope: ExtensionScope): boolean {
    return this.contributions.some(
      (entry) => entry.point === point && entry.scope === scope && entry.mode === 'replace'
    );
  }

  /* ------------------------------ 服务端钩子触发 ------------------------------ */

  /**
   * 触发服务端钩子：按 `order` **升序**串行传递 payload（filter 语义）。
   *
   * 错误策略默认 `abort`：贡献抛错直接上抛，让调用方（如"保存文章前"）失败 ——
   * 静默跳过会让未经验证的数据进库。需要容错时由调用方显式传 `skip`。
   * 这与渲染作用域的"单组件异常降级为空片段"是**刻意相反**的策略：
   * 页面少一块内容可以接受，数据被悄悄改坏不可以。
   */
  async apply<T>(
    point: string,
    payload: T,
    options?: { onError?: ExtensionErrorPolicy }
  ): Promise<T> {
    const entries = this.contributions
      .filter((entry) => entry.point === point && entry.scope === 'server')
      .sort((left, right) => left.order - right.order || left.sequence - right.sequence);
    if (entries.length === 0) return payload;

    const replacements = entries.filter((entry) => entry.mode === 'replace');
    const chain = replacements.length > 0 ? [replacements[replacements.length - 1]!] : entries;

    const policy = options?.onError ?? 'abort';
    let current = payload;

    for (const entry of chain) {
      const module = entry.payload as ExtensionHookModule<T>;
      const context: ExtensionHookContext = {
        point,
        pluginId: entry.consumerId,
        logger: this.logger.child({ plugin: entry.consumerId })
      };
      try {
        current = await module.apply(current, context);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (policy === 'abort') {
          this.logger.error('扩展点钩子执行失败（已按 abort 策略中断）', {
            point,
            plugin: entry.consumerId,
            error: reason
          });
          throw error instanceof RiceNoteError
            ? error
            : new RiceNoteError(
                ErrorCode.VALIDATION_FAILED,
                `扩展点 ${point} 的钩子（${entry.consumerId}）执行失败：${reason}`,
                { status: 500, details: { point, plugin: entry.consumerId } }
              );
        }
        this.logger.warn('扩展点钩子执行失败（已跳过并沿用上一版数据）', {
          point,
          plugin: entry.consumerId,
          error: reason
        });
      }
    }

    return current;
  }

  /* --------------------------------- 诊断与清理 --------------------------------- */

  /** 声明摘录（供 `pnpm validate`、后台目录与诊断使用）。 */
  declarationOf(point: string): ExtensionDeclarationRecord | undefined {
    return this.declarations.get(point);
  }

  declaredPoints(scope?: ExtensionScope): ExtensionDeclarationRecord[] {
    return [...this.declarations.values()]
      .filter((entry) => scope === undefined || entry.scope === scope)
      .sort((left, right) => left.sequence - right.sequence);
  }

  list(): ExtensionPointSummary[] {
    const counts = new Map<string, number>();
    for (const entry of this.contributions) {
      counts.set(entry.point, (counts.get(entry.point) ?? 0) + 1);
    }
    return [...this.declarations.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map((entry) => ({
        point: entry.name,
        scope: entry.scope,
        provider: entry.providerId,
        contributions: counts.get(entry.name) ?? 0
      }));
  }

  /** 某插件贡献过的扩展点名（按 scope 过滤可选），用于停用后零残留断言。 */
  contributionsOwnedBy(pluginId: string, scope?: ExtensionScope): string[] {
    return [
      ...new Set(
        this.contributions
          .filter((entry) => entry.consumerId === pluginId)
          .filter((entry) => scope === undefined || entry.scope === scope)
          .map((entry) => entry.point)
      )
    ].sort();
  }

  declarationsOwnedBy(pluginId: string): string[] {
    return [...this.declarations.values()]
      .filter((entry) => entry.providerId === pluginId)
      .map((entry) => entry.name)
      .sort();
  }

  ownedBy(pluginId: string): { declarations: string[]; contributions: string[] } {
    return {
      declarations: this.declarationsOwnedBy(pluginId),
      contributions: this.contributionsOwnedBy(pluginId)
    };
  }

  /** 清理：不给 scope 时清空全部（测试与关停用）；预置插槽始终保留。 */
  clear(scope?: ExtensionScope): void {
    this.contributions =
      scope === undefined ? [] : this.contributions.filter((entry) => entry.scope !== scope);
    for (const [name, entry] of [...this.declarations.entries()]) {
      if (entry.providerId === CORE_PROVIDER) continue;
      if (scope === undefined || entry.scope === scope) this.declarations.delete(name);
    }
  }
}
