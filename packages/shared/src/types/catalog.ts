/**
 * 官方插件目录（推荐插件清单）的类型。
 *
 * 这份清单是「装哪个版本、哪些是必需」的**唯一事实来源**：
 * 安装向导、扩展中心的「官方插件目录」、`pnpm validate` 与发布脚本
 * 都读同一份数据，避免规则散落在文档与多处代码里。
 */

/**
 * 插件在安装向导中的推荐档位。
 *
 * - `required`：**不可取消勾选**。缺 `rice.identity` 没有登录端点、
 *   缺 `rice.authorization` 权限校验全拒，两者缺失都会让后台无法使用；
 * - `recommended`：默认勾选，用户可取消；
 * - `optional`：默认不勾选，用户主动选择才安装；
 * - `example`：示例/演示插件，仅供试用。
 */
export type PluginCatalogCategory = 'required' | 'recommended' | 'optional' | 'example';

export interface PluginCatalogEntry {
  /** 插件 ID，必须与 manifest.json 的 `id` 一致（如 `rice.posts`）。 */
  id: string;
  /** npm 包名（如 `@ricenote/plugin-posts`）。 */
  npm: string;
  /**
   * **推荐版本**：随主程序发布，代表"经测试可用"的版本组合。
   *
   * 与"最新版本"（registry 的 dist-tags）是两件事：向导默认装推荐版本，
   * 后台以推荐版本作为"有更新"的提示基线；升级主程序才会提升这个值。
   */
  version: string;
  category: PluginCatalogCategory;
  /** 显示名称（向导与后台共用）。 */
  label: string;
  description: string;
  /** 插件声明的能力白名单（与 manifest.capabilities 一致，用于展示与校验）。 */
  capabilities: string[];
  /**
   * 依赖的**其他插件 ID**（不是 capability 契约）。
   *
   * 用于安装顺序与"必需项联动"：例如 `rice.authorization` 依赖 `rice.identity`，
   * 向导勾选前者时会把后者一并选中。
   */
  requires: string[];
  /** 源码仓库地址（镜像仓库脚本与 README 使用；仓库尚未创建时仅作占位）。 */
  repository: string;
  /** 许可证标识（与 manifest.license 一致）。 */
  license: string;
}

export interface PluginCatalog {
  /** 清单结构版本，v1 固定为 1。 */
  schemaVersion: 1;
  /** 这份清单随哪个 RiceNote 版本发布（用于提示"推荐版本是否已更新"）。 */
  appVersion: string;
  plugins: PluginCatalogEntry[];
}

/**
 * 由**宿主进程**提供、插件不得自带也不能被安装进插件目录的包。
 *
 * 原因（见 `docs/plugin-api/v1.md` §11 与 ADR-014）：
 * - 这些包由内核从项目根 `node_modules` 解析，插件自带会产生**第二份实例**
 *   （曾出现"两份 Vue → 页面空白且控制台干净"的排查噩梦）；
 * - 发布包把它们写成普通 `dependencies` 就会在安装时把 SDK 复制进插件目录。
 *
 * 因此插件声明为 `peerDependencies` + `peerDependenciesMeta.optional`，
 * 安装编排在 `prepare` 阶段再跳过一次（双保险）。
 */
export const HOST_PROVIDED_PACKAGES = [
  '@ricenote/plugin-sdk',
  '@ricenote/shared',
  '@ricenote/theme-sdk',
  '@ricenote/admin-sdk'
] as const;

/** 判断某个包名是否由宿主提供。 */
export function isHostProvidedPackage(name: string): boolean {
  return (HOST_PROVIDED_PACKAGES as readonly string[]).includes(name);
}
