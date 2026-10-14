/**
 * 固定链接插件的内置方案（属于**插件自己的配置**，因此不放进 `@ricenote/shared`）。
 *
 * 三套内置方案与第三方通过 `rice.permalink.schemes` 贡献的方案使用**同一个结构**，
 * 因此后台区块渲染、模板校验、路径接管与地址生成只有一份实现。
 *
 * 默认模板刻意与插件未启用时的现状完全一致（`/post/{slug}`、`/page/{slug}`、
 * `/category/{slug}`）：装了但没改设置，站点地址不会发生任何变化。
 */

import {
  PERMALINK_SCHEME_IDS,
  type PermalinkSchemeDeclaration
} from '@ricenote/shared';

/** 文章路径方案。 */
const POST_SCHEME: PermalinkSchemeDeclaration = {
  id: PERMALINK_SCHEME_IDS.POST,
  label: '文章路径',
  routeName: 'post.show',
  tokens: [
    { name: 'cid', label: '日志 ID', description: '文章的编号，例如 12' },
    { name: 'slug', label: '日志缩略名', description: '文章地址用的短名，例如 hello-world' },
    { name: 'category', label: '分类', description: '文章所属分类的缩略名' },
    { name: 'year', label: '年', description: '发布时间所在年份，例如 2026' },
    { name: 'month', label: '月', description: '发布时间所在月份，例如 10' },
    { name: 'day', label: '日', description: '发布时间所在日期，例如 14' }
  ],
  defaultTemplate: '/post/{slug}',
  presets: [
    { label: '内核默认（保持现状）', template: '/post/{slug}' },
    { label: '默认风格', template: '/archives/{cid}/' },
    { label: 'WordPress 风格', template: '/archives/{slug}.html' },
    { label: '按日期归档', template: '/{year}/{month}/{day}/{slug}.html' },
    { label: '按分类归档', template: '/{category}/{slug}.html' }
  ],
  sample: { cid: 12, slug: 'hello-world', category: 'notes', year: 2026, month: 10, day: 14 }
};

/** 独立页面路径方案。 */
const PAGE_SCHEME: PermalinkSchemeDeclaration = {
  id: PERMALINK_SCHEME_IDS.PAGE,
  label: '独立页面路径',
  routeName: 'page.show',
  tokens: [
    { name: 'cid', label: '页面 ID', description: '独立页面的编号，例如 3' },
    { name: 'slug', label: '页面缩略名', description: '页面地址用的短名，例如 about' }
  ],
  defaultTemplate: '/page/{slug}',
  presets: [
    { label: '内核默认（保持现状）', template: '/page/{slug}' },
    { label: '简洁风格', template: '/{slug}.html' }
  ],
  sample: { cid: 3, slug: 'about' }
};

/** 分类路径方案。 */
const CATEGORY_SCHEME: PermalinkSchemeDeclaration = {
  id: PERMALINK_SCHEME_IDS.CATEGORY,
  label: '分类路径',
  routeName: 'term.category',
  tokens: [
    { name: 'mid', label: '分类 ID', description: '分类的编号，例如 5' },
    { name: 'slug', label: '分类缩略名', description: '分类地址用的短名，例如 notes' }
  ],
  defaultTemplate: '/category/{slug}',
  presets: [
    { label: '内核默认（保持现状）', template: '/category/{slug}' },
    { label: '带尾斜杠', template: '/category/{slug}/' }
  ],
  sample: { mid: 5, slug: 'notes' }
};

/** 内置方案清单（顺序即后台展示顺序）。 */
export const BUILTIN_SCHEMES: PermalinkSchemeDeclaration[] = [
  POST_SCHEME,
  PAGE_SCHEME,
  CATEGORY_SCHEME
];

/** 插件对外声明的扩展点名。 */
export const EXTENSION_POINTS = {
  SCHEMES: 'rice.permalink.schemes',
  TOKENS: 'rice.permalink.tokens'
} as const;

/** 模板长度上限（与 `manifest` 无关，校验用）。 */
export const MAX_TEMPLATE_LENGTH = 200;

/** 方案 id 的合法形态（第三方方案也要满足，避免与内置方案混淆）。 */
export const SCHEME_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
