/**
 * 插件设置（声明式 settingsSchema）的单元测试。
 *
 * 重点覆盖"两套写法并存"的边界：
 * - 声明式：字段级校验（类型 / min / max / 枚举）与后台表单分组；
 * - 旧写法：只校验"键必须在声明范围内"，值保持宽松以兼容既有插件；
 * - 合并顺序：settings 默认值 → settingsSchema 默认值 → 数据库覆盖。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PluginManifest } from '@ricenote/shared';
import {
  buildPluginSettingsGroups,
  declaredSettingKeys,
  hasDeclarativeSettings,
  resolvePluginSettings,
  validatePluginSettingsValues
} from '@ricenote/core';

/** 声明式写法的示例清单（与 rice.pages 的 shape 一致）。 */
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
