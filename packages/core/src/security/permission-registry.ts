/**
 * 权限点登记表：把「谁声明」与「谁使用」合到一处。
 *
 * 三方分工：
 * - **声明**：拥有权限点的插件（`manifest.permissions`）或 Core（`CORE_PERMISSIONS`）；
 * - **使用**：`manifest.admin.pages[].permission` / `contributions[].permission`（静态）
 *   与运行期的 `ctx.routes.adminApi` / `ctx.adminMenu.add`（插件启动时注册）；
 * - **校验**：安全网关按标识字符串比对，**与本表无关**。
 *
 * 因此本表只服务两件事：权限管理界面的展示，以及"用了却没声明"的告警。
 * 对应两条刻意不对称的规则：
 * - **未声明 = 警告**（宽松）：第三方插件在补上声明之前照旧可用，鉴权不受影响；
 * - **重复声明 = 错误**（严格）：同一个标识被两方声明说明"归属不清"，
 *   会让权限目录出现两个同名项、也让"谁该给它写文案"无解，必须早失败。
 */

import {
  ErrorCode,
  RiceNoteError,
  type DeclaredPermission,
  type PluginManifest,
  type PluginPermissionDeclaration
} from '@ricenote/shared';

/** 权限点标识格式：`<域>.<动作>`，两段都允许短横线。 */
const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** 使用来源：告警时用来指出"哪个入口用的"，便于作者定位。 */
export type PermissionUsageSource = 'admin-page' | 'admin-api' | 'admin-menu' | 'admin-contribution';

export interface UndeclaredPermission {
  key: string;
  /** 使用它的插件 ID（按字典序）。 */
  usedBy: string[];
  sources: PermissionUsageSource[];
}

interface Declaration {
  declaration: PluginPermissionDeclaration;
  /** 声明者插件 ID；`null` 表示 Core 自有。 */
  declaredBy: string | null;
}

export class PermissionRegistry {
  private readonly declarations = new Map<string, Declaration>();
  /** 权限点 → 插件 ID → 使用来源集合。 */
  private readonly usages = new Map<string, Map<string, Set<PermissionUsageSource>>>();

  /**
   * 登记一批声明。
   *
   * @param declaredBy 声明者插件 ID；Core 自有权限点传 `null`。
   * @throws 标识格式非法、同一方重复声明、或该标识已被另一方声明。
   */
  declare(declaredBy: string | null, list: readonly PluginPermissionDeclaration[] | undefined): void {
    const owner = declaredBy ?? 'Core';
    const seen = new Set<string>();

    for (const item of list ?? []) {
      const key = item.key;

      if (!PERMISSION_KEY_PATTERN.test(key)) {
        throw new RiceNoteError(
          ErrorCode.MANIFEST_INVALID,
          `${owner} 声明的权限点标识非法：${key}（应形如 post.publish）`,
          { status: 400, details: { key, declaredBy: owner } }
        );
      }
      if (seen.has(key)) {
        throw new RiceNoteError(ErrorCode.MANIFEST_INVALID, `${owner} 重复声明权限点：${key}`, {
          status: 400,
          details: { key, declaredBy: owner }
        });
      }
      seen.add(key);

      const existing = this.declarations.get(key);
      if (existing) {
        throw new RiceNoteError(
          ErrorCode.MANIFEST_INVALID,
          `权限点重复声明：${key}（已由 ${existing.declaredBy ?? 'Core'} 声明）`,
          { status: 400, details: { key, declaredBy: owner, owner: existing.declaredBy } }
        );
      }

      this.declarations.set(key, { declaration: item, declaredBy });
    }
  }

  /** 登记一个插件清单里的声明与静态使用（后台页面、扩展点贡献）。 */
  declareManifest(pluginId: string, manifest: Pick<PluginManifest, 'permissions' | 'admin' | 'contributions'>): void {
    this.declare(pluginId, manifest.permissions);

    for (const page of manifest.admin?.pages ?? []) {
      this.track(page.permission, pluginId, 'admin-page');
    }
    for (const contribution of manifest.contributions ?? []) {
      this.track(contribution.permission, pluginId, 'admin-contribution');
    }
  }

  /** 记录一次使用；`key` 为空（仅需登录的路由/菜单）时忽略。 */
  track(
    key: string | undefined | null,
    pluginId: string,
    source: PermissionUsageSource
  ): void {
    if (!key) return;

    const byPlugin = this.usages.get(key) ?? new Map<string, Set<PermissionUsageSource>>();
    const sources = byPlugin.get(pluginId) ?? new Set<PermissionUsageSource>();
    sources.add(source);
    byPlugin.set(pluginId, sources);
    this.usages.set(key, byPlugin);
  }

  /** 声明 + 使用的合并视图（按标识排序）。 */
  list(): DeclaredPermission[] {
    const keys = new Set([...this.declarations.keys(), ...this.usages.keys()]);

    return [...keys].sort().map((key) => {
      const declared = this.declarations.get(key);
      return {
        key,
        label: declared?.declaration.label ?? null,
        group: declared?.declaration.group ?? null,
        declaredBy: declared?.declaredBy ?? null,
        usedBy: [...(this.usages.get(key)?.keys() ?? [])].sort()
      };
    });
  }

  /** 被使用、但没有任何声明方的权限点（宽松策略：只告警，不拦截）。 */
  undeclared(): UndeclaredPermission[] {
    const output: UndeclaredPermission[] = [];

    for (const [key, byPlugin] of this.usages) {
      if (this.declarations.has(key)) continue;

      const sources = new Set<PermissionUsageSource>();
      for (const list of byPlugin.values()) {
        for (const source of list) sources.add(source);
      }

      output.push({
        key,
        usedBy: [...byPlugin.keys()].sort(),
        sources: [...sources].sort()
      });
    }

    return output.sort((left, right) => left.key.localeCompare(right.key));
  }

  /** 已声明的权限点数量（供启动日志与校验摘要）。 */
  declaredCount(): number {
    return this.declarations.size;
  }
}
