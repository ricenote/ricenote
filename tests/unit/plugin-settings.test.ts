/**
 * 插件设置（声明式 settingsSchema）的单元测试。
 *
 * 重点覆盖"两套写法并存"的边界：
 * - 声明式：字段级校验（类型 / min / max / 枚举）与后台表单分组；
 * - 旧写法：只校验"键必须在声明范围内"，值保持宽松以兼容既有插件；
 * - 合并顺序：settings 默认值 → settingsSchema 默认值 → 数据库覆盖。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { PluginManifest } from '@ricenote/shared';
import {
  buildPluginSettingsGroups,
  declaredSettingKeys,
  hasDeclarativeSettings,
  resolvePluginSettings,
  validatePluginSettingsValues
} from '@ricenote/core';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 读取一个插件清单（不经内核，用于"声明与代码对齐"的守卫测试）。 */
function readManifest(relativePath: string): PluginManifest {
  const file = path.join(rootDir, relativePath, 'manifest.json');
  return JSON.parse(readFileSync(file, 'utf8')) as PluginManifest;
}

/**
 * 声明式写法的示例清单。
 *
 * 刻意与任何真实插件解耦：这里是"校验与合并逻辑"的测试，
 * 真实清单的字段与默认值由下面「官方插件清单的设置声明」用显式期望值钉住。
 */
const DECLARATIVE: Pick<PluginManifest, 'settings' | 'settingsSchema'> = {
  settingsSchema: {
    general: {
      label: { 'zh-CN': '通用', en: 'General' },
      description: { 'zh-CN': '影响前台展示' },
      fields: {
        navLimit: {
          type: 'number',
          label: { 'zh-CN': '导航最多展示页面数', en: 'Max pages' },
          default: 20,
          min: 1,
          max: 100
        },
        cacheEnabled: { type: 'boolean', label: '启用缓存', default: true },
        layout: {
          type: 'select',
          label: '版式',
          default: 'list',
          options: [
            { label: { 'zh-CN': '列表', en: 'List' }, value: 'list' },
            { label: { 'zh-CN': '卡片', en: 'Cards' }, value: 'cards' }
          ]
        },
        homepage: { type: 'url', label: '外部主页', default: '' }
      }
    }
  }
};

/** 旧写法的示例清单（与 rice.identity / rice.search 的 shape 一致）。 */
const LEGACY: Pick<PluginManifest, 'settings' | 'settingsSchema'> = {
  settings: { sessionTtlSeconds: 7200, maxSessionsPerUser: 10 }
};

describe('插件设置的声明式与旧写法', () => {
  it('只有 settingsSchema 才被视为声明式', () => {
    assert.equal(hasDeclarativeSettings(DECLARATIVE), true);
    assert.equal(hasDeclarativeSettings(LEGACY), false);
    assert.equal(hasDeclarativeSettings({ settingsSchema: {} }), false);
  });

  it('声明字段名 = 旧写法键 ∪ settingsSchema 字段', () => {
    assert.deepEqual(declaredSettingKeys(DECLARATIVE), ['cacheEnabled', 'homepage', 'layout', 'navLimit']);
    assert.deepEqual(declaredSettingKeys(LEGACY), ['maxSessionsPerUser', 'sessionTtlSeconds']);
  });

  it('合并顺序：settings → settingsSchema 默认值 → 数据库覆盖', () => {
    const merged = resolvePluginSettings(
      { settings: { navLimit: 5, legacyOnly: 'x' }, settingsSchema: DECLARATIVE.settingsSchema },
      { navLimit: 33 }
    );

    assert.equal(merged.navLimit, 33, '数据库覆盖优先');
    assert.equal(merged.legacyOnly, 'x', '旧写法仍生效');
    assert.equal(merged.cacheEnabled, true, '声明式默认值补齐');
    assert.equal(merged.layout, 'list');
  });

  it('声明式校验：接受合法值，拒绝越界与未声明字段', () => {
    const ok = validatePluginSettingsValues(DECLARATIVE, { navLimit: 50, cacheEnabled: false });
    assert.equal(ok.valid, true);
    assert.deepEqual(ok.normalized, { navLimit: 50, cacheEnabled: false });

    const tooLarge = validatePluginSettingsValues(DECLARATIVE, { navLimit: 101 });
    assert.equal(tooLarge.valid, false);
    assert.equal(tooLarge.issues[0]?.keyword, 'maximum');

    const badEnum = validatePluginSettingsValues(DECLARATIVE, { layout: 'grid' });
    assert.equal(badEnum.valid, false);
    assert.equal(badEnum.issues[0]?.keyword, 'enum');

    const badUrl = validatePluginSettingsValues(DECLARATIVE, { homepage: 'example.com' });
    assert.equal(badUrl.valid, false);

    const unknown = validatePluginSettingsValues(DECLARATIVE, { nope: 1 });
    assert.equal(unknown.valid, false);
    assert.equal(unknown.issues[0]?.keyword, 'unknownField');
  });

  it('声明式校验只回传本次提交的字段（不落库默认值，保证升级后默认值仍动态生效）', () => {
    const result = validatePluginSettingsValues(DECLARATIVE, { navLimit: 7 });
    assert.equal(result.valid, true);
    assert.deepEqual(Object.keys(result.normalized), ['navLimit']);
  });

  it('旧写法校验：键必须在声明范围内，但值保持宽松', () => {
    const ok = validatePluginSettingsValues(LEGACY, { sessionTtlSeconds: 60 });
    assert.equal(ok.valid, true);
    assert.deepEqual(ok.normalized, { sessionTtlSeconds: 60 });

    // 任意键被拒绝（此前会接受，属于收紧）
    const unknown = validatePluginSettingsValues(LEGACY, { adminPassword: 'x' });
    assert.equal(unknown.valid, false);
    assert.equal(unknown.issues[0]?.keyword, 'unknownField');

    // 对象/数组值被拒绝（避免把结构化数据塞进扁平配置）
    const badType = validatePluginSettingsValues(LEGACY, { sessionTtlSeconds: { a: 1 } as never });
    assert.equal(badType.valid, false);
    assert.equal(badType.issues[0]?.keyword, 'type');
  });

  it('后台分组 DTO 的文案按站点语言解析', () => {
    const values = resolvePluginSettings(DECLARATIVE, { navLimit: 42 });

    const zh = buildPluginSettingsGroups(DECLARATIVE, values, 'zh-CN');
    assert.equal(zh.length, 1);
    assert.equal(zh[0]?.label, '通用');
    assert.equal(zh[0]?.description, '影响前台展示');
    const navLimitZh = zh[0]?.fields.find((field) => field.key === 'navLimit');
    assert.equal(navLimitZh?.label, '导航最多展示页面数');
    assert.equal(navLimitZh?.value, 42);
    assert.equal(navLimitZh?.min, 1);
    assert.equal(navLimitZh?.max, 100);

    const en = buildPluginSettingsGroups(DECLARATIVE, values, 'en');
    assert.equal(en[0]?.label, 'General');
    // 声明了英文的字段取英文
    assert.equal(en[0]?.fields.find((field) => field.key === 'navLimit')?.label, 'Max pages');
    // 未声明英文的字段回落到首个非空值（这里是中文）
    assert.equal(en[0]?.fields.find((field) => field.key === 'cacheEnabled')?.label, '启用缓存');
    // select 选项的 label 也按语言解析
    assert.deepEqual(
      en[0]?.fields.find((field) => field.key === 'layout')?.options,
      [
        { label: 'List', value: 'list' },
        { label: 'Cards', value: 'cards' }
      ]
    );
  });

  it('未声明的字段在 DTO 中不出现（前端无法渲染越界字段）', () => {
    const groups = buildPluginSettingsGroups(DECLARATIVE, {}, 'zh-CN');
    const keys = groups[0]?.fields.map((field) => field.key) ?? [];
    assert.deepEqual(keys.sort(), ['cacheEnabled', 'homepage', 'layout', 'navLimit']);
  });
});

/** `stringList` 字段（评论的屏蔽关键词、SEO 的 robots 禁止路径用到的类型）。 */
const STRING_LIST: Pick<PluginManifest, 'settings' | 'settingsSchema'> = {
  settingsSchema: {
    antispam: {
      label: '反垃圾',
      fields: {
        blockedKeywords: {
          type: 'stringList',
          label: '屏蔽关键词',
          default: [],
          maxItems: 3,
          maxLength: 10
        },
        noLimit: { type: 'stringList', label: '无上限列表', default: ['a'] }
      }
    }
  }
};

describe('stringList 字段类型', () => {
  it('缺省默认值是空数组（而非空字符串）', () => {
    const values = resolvePluginSettings(STRING_LIST, undefined);
    assert.deepEqual(values.blockedKeywords, []);
    assert.deepEqual(values.noLimit, ['a']);
  });

  it('接受字符串数组，并归一化（去空白、丢空项）', () => {
    const result = validatePluginSettingsValues(STRING_LIST, {
      noLimit: ['  赌场  ', '', '   ', 'casino']
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.normalized, { noLimit: ['赌场', 'casino'] });
  });

  it('接受按行分隔的字符串（后台表单直接提交多行文本）', () => {
    const result = validatePluginSettingsValues(STRING_LIST, {
      noLimit: '第一项\n  第二项  \n\n第三项'
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.normalized, { noLimit: ['第一项', '第二项', '第三项'] });
  });

  it('拒绝非数组非字符串的值', () => {
    for (const bad of [123, true, { a: 1 }]) {
      const result = validatePluginSettingsValues(STRING_LIST, { noLimit: bad as never });
      assert.equal(result.valid, false, `${JSON.stringify(bad)} 应被拒绝`);
      assert.equal(result.issues[0]?.keyword, 'type');
    }
    // 数组里混入非字符串同样拒绝（避免把结构化数据塞进列表）
    const mixed = validatePluginSettingsValues(STRING_LIST, { noLimit: ['ok', 5] as never });
    assert.equal(mixed.valid, false);
    assert.equal(mixed.issues[0]?.keyword, 'type');
  });

  it('maxItems 与单项 maxLength 生效', () => {
    const tooMany = validatePluginSettingsValues(STRING_LIST, {
      blockedKeywords: ['a', 'b', 'c', 'd']
    });
    assert.equal(tooMany.valid, false);
    assert.equal(tooMany.issues[0]?.keyword, 'maxItems');

    const tooLong = validatePluginSettingsValues(STRING_LIST, {
      blockedKeywords: ['a'.repeat(11)]
    });
    assert.equal(tooLong.valid, false);
    assert.equal(tooLong.issues[0]?.keyword, 'maxLength');

    // 未声明 maxItems 时默认 200
    const atLimit = validatePluginSettingsValues(STRING_LIST, {
      noLimit: Array.from({ length: 200 }, (_, i) => `k${i}`)
    });
    assert.equal(atLimit.valid, true);
    const overLimit = validatePluginSettingsValues(STRING_LIST, {
      noLimit: Array.from({ length: 201 }, (_, i) => `k${i}`)
    });
    assert.equal(overLimit.valid, false);
  });
});

/**
 * 清单与代码对齐的守卫。
 *
 * 声明式设置最容易出的问题是"两处漂移"：
 * - 插件里 `ctx.config.get('foo')` 有 foo，但清单漏声明 → 后台看不到、也写不进去；
 * - 清单里的默认值与代码里的兜底默认值不一致 → 后台显示 20，插件实际按 10 运行。
 *
 * 这里把两者都钉死成显式期望值：改代码或改清单都必须同步改这张表。
 */
describe('官方插件清单的设置声明', () => {
  const EXPECTED: Array<{
    path: string;
    /** 字段名 → 声明默认值（必须与插件代码里的兜底值一致）。 */
    fields: Record<string, unknown>;
    /** 声明式表单的分组键。 */
    groups: string[];
  }> = [
    {
      path: 'plugins/official/seo',
      groups: ['social', 'crawler'],
      fields: {
        enableOpenGraph: true,
        enableTwitterCard: true,
        twitterSite: '',
        defaultOgImage: '',
        enableJsonLd: true,
        enableSitemap: true,
        enableRobots: true,
        sitemapMaxUrls: 1000,
        sitemapPageSize: 50,
        robotsDisallow: ['/admin', '/api']
      }
    },
    {
      path: 'plugins/official/search',
      groups: ['general'],
      fields: { resultPageSize: 10, maxKeywordLength: 100, maxItemsPerSource: 50 }
    },
    {
      path: 'plugins/official/comments',
      groups: ['general', 'antispam'],
      fields: {
        enabled: true,
        requireApproval: true,
        requireEmail: true,
        pageSize: 20,
        maxLength: 2000,
        maxDepth: 5,
        rateLimitWindowSeconds: 60,
        rateLimitMaxSubmissions: 3,
        maxLinksPerComment: 2,
        blockedKeywords: []
      }
    },
    {
      path: 'plugins/official/posts',
      groups: ['general'],
      fields: { pageSize: 10, excerptLength: 160 }
    },
    {
      path: 'plugins/official/identity',
      groups: ['session'],
      fields: { sessionTtlSeconds: 7200, maxSessionsPerUser: 10 }
    },
    {
      path: 'plugins/official/media',
      groups: ['upload'],
      fields: { maxFileBytes: 8388608 }
    },
    {
      path: 'plugins/official/pages',
      groups: ['general'],
      fields: { listPageSize: 20, cacheEnabled: true }
    },
    {
      path: 'plugins/official/navigation',
      groups: ['general'],
      fields: { maxItems: 10 }
    },
    {
      path: 'plugins/official/feed',
      groups: ['feed'],
      fields: { enableFeed: true, itemLimit: 20, fullText: false, cacheMaxAge: 1800 }
    },
    {
      path: 'plugins/third-party/reading-time',
      groups: ['display'],
      fields: { wordsPerMinute: 300, showWordCount: true, label: '阅读时长' }
    }
  ];

  for (const expected of EXPECTED) {
    it(`${expected.path} 的声明式设置齐全且默认值稳定`, () => {
      const manifest = readManifest(expected.path);

      assert.equal(hasDeclarativeSettings(manifest), true, '应声明 settingsSchema');
      assert.deepEqual(
        Object.keys(manifest.settingsSchema ?? {}),
        expected.groups,
        '分组键应与预期一致'
      );
      // 默认值只声明在 settingsSchema 里，不允许与旧写法重复（避免两处漂移）
      assert.equal(manifest.settings, undefined, '不应再保留旧写法 settings');
      assert.deepEqual(declaredSettingKeys(manifest), Object.keys(expected.fields).sort());

      const values = resolvePluginSettings(manifest, undefined);
      for (const [key, expectedDefault] of Object.entries(expected.fields)) {
        assert.deepEqual(values[key], expectedDefault, `字段 ${key} 的默认值`);
      }

      // 每个字段都必须有中文文案，否则后台表单会出现空标签
      for (const group of Object.values(manifest.settingsSchema ?? {})) {
        for (const [key, field] of Object.entries(group.fields ?? {})) {
          assert.ok(
            typeof field.label === 'string' || Object.keys(field.label ?? {}).length > 0,
            `字段 ${key} 缺少 label`
          );
        }
      }
    });
  }

  it('列表型字段用 stringList，且默认值是数组', () => {
    const seo = readManifest('plugins/official/seo');
    const crawler = seo.settingsSchema?.crawler;
    assert.equal(crawler?.fields.robotsDisallow?.type, 'stringList');
    assert.ok(Array.isArray(crawler?.fields.robotsDisallow?.default));

    const comments = readManifest('plugins/official/comments');
    const antispam = comments.settingsSchema?.antispam;
    assert.equal(antispam?.fields.blockedKeywords?.type, 'stringList');
    assert.ok(Array.isArray(antispam?.fields.blockedKeywords?.default));
  });
});
