/**
 * 内容自定义字段的两半：**值级校验**（@ricenote/shared，保存路径复用）
 * 与**本地化 DTO 解析**（core，后台渲染用）。
 *
 * 为什么值得锁：
 * - 值校验是 fail-closed：未声明的键**必须报错而不是丢弃**，
 *   否则作者会以为"填了却没生效"；
 * - 空串/空数组视为"未填写"（不落结果），而 `false`/`0` 是有效值 ——
 *   这条口径决定模板端 `{% if %}` 的语义；
 * - 声明解析必须按站点语言逐项解析，且不下发一堆 undefined 键；
 * - `defineAdminContribution` 的 `props` 是刚补的契约：不声明 props 时字段只会
 *   落进 `ctx.attrs`，`setup(props)` 读不到值 —— 容易被"简化"掉。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ErrorCode,
  assertContentFieldValues,
  hasContentFields,
  isContentFieldType,
  isRiceNoteError,
  pickDeclaredContentFields,
  validateContentFieldValues,
  type ContentFieldsSchema
} from '@ricenote/shared';
import { resolveContentFields } from '@ricenote/core';

const FIELDS: ContentFieldsSchema = {
  featuredImage: { type: 'image', label: '特色图片' },
  summary: { type: 'textarea', label: '摘要', maxLength: 20 },
  count: { type: 'number', label: '数量', min: 1, max: 10 },
  tags: { type: 'stringList', label: '标签', maxItems: 2 },
  layout: {
    type: 'select',
    label: '布局',
    options: [
      { label: '宽屏', value: 'wide' },
      { label: '窄屏', value: 'narrow' }
    ]
  },
  pinned: { type: 'boolean', label: '置顶' }
};

describe('内容字段值校验：fail-closed 与空值口径', () => {
  it('未声明的键报错而不是静默丢弃（换主题后的旧键同样报错）', () => {
    const undeclared = validateContentFieldValues(undefined, { anything: 1 });
    assert.deepEqual(undeclared.values, {});
    assert.equal(undeclared.issues[0]?.keyword, 'additionalProperties');

    const stale = validateContentFieldValues(FIELDS, {
      featuredImage: '/uploads/a.jpg',
      legacyKey: '旧主题的键'
    });
    // 已声明的键照常落值，只有未声明的键被拒绝 —— 报错但不整单丢弃
    assert.deepEqual(stale.values, { featuredImage: '/uploads/a.jpg' });
    assert.equal(stale.issues.length, 1);
    assert.equal(stale.issues[0]?.path, '/fields/legacyKey');
    assert.match(stale.issues[0]?.message ?? '', /未声明的内容字段/);
  });

  it('类型不符 / 越界 / 超长 / 超项 / 枚举外一律报错且不落值', () => {
    const cases: [string, unknown, string][] = [
      ['count', 'abc', 'type'],
      ['count', 99, 'maximum'],
      ['count', 0, 'minimum'],
      ['summary', 'x'.repeat(21), 'maxLength'],
      ['tags', ['a', 'b', 'c'], 'maxItems'],
      ['tags', [1, 2], 'type'],
      ['layout', 'center', 'enum'],
      ['pinned', 'yes', 'type']
    ];

    for (const [key, value, keyword] of cases) {
      const { values, issues } = validateContentFieldValues(FIELDS, { [key]: value });
      assert.deepEqual(values, {}, `${key} 不应写入任何值`);
      assert.equal(issues[0]?.keyword, keyword, `${key} 应以 ${keyword} 报错，实际 ${issues[0]?.keyword}`);
      assert.equal(issues[0]?.path, `/fields/${key}`);
    }
  });

  it('空串与空数组视为"未填写"：不落结果，也不报错', () => {
    const { values, issues } = validateContentFieldValues(FIELDS, {
      featuredImage: '   ',
      summary: '',
      tags: ['  ', ''],
      layout: ''
    });

    assert.deepEqual(values, {});
    assert.deepEqual(issues, []);
  });

  it('false 与 0 是有效值，不能被当成"未填写"丢掉', () => {
    const { values, issues } = validateContentFieldValues(FIELDS, { pinned: false, count: 5 });

    assert.deepEqual(values, { pinned: false, count: 5 });
    assert.deepEqual(issues, []);
  });

  it('归一化：字符串 trim，stringList 去空项（顺序保持）', () => {
    const { values } = validateContentFieldValues(FIELDS, {
      summary: '  摘要  ',
      tags: [' a ', '  ', 'b']
    });

    assert.deepEqual(values, { summary: '摘要', tags: ['a', 'b'] });
  });

  it('assertContentFieldValues 校验失败即抛 RN_VALIDATION_FAILED 并带 issues', () => {
    assert.throws(
      () => assertContentFieldValues(FIELDS, { ghost: 'x' }),
      (error: unknown) => {
        assert.ok(isRiceNoteError(error));
        assert.equal(error.code, ErrorCode.VALIDATION_FAILED);
        assert.equal(error.status, 400);
        assert.ok(Array.isArray(error.details.issues));
        return true;
      }
    );
    assert.deepEqual(assertContentFieldValues(FIELDS, { summary: '  摘要 ' }), { summary: '摘要' });
  });

  it('pickDeclaredContentFields 按声明过滤掉换主题后的旧键', () => {
    assert.deepEqual(
      pickDeclaredContentFields({ featuredImage: FIELDS.featuredImage }, {
        featuredImage: '/uploads/a.jpg',
        legacyKey: '旧键',
        summary: '未被声明'
      }),
      { featuredImage: '/uploads/a.jpg' }
    );
    // 主题没声明字段 / 存值不是对象时都必须退化为空（模板侧不应看到脏数据）
    assert.deepEqual(pickDeclaredContentFields(undefined, { featuredImage: '/a.jpg' }), {});
    assert.deepEqual(pickDeclaredContentFields(FIELDS, null), {});
  });

  it('hasContentFields / isContentFieldType 的口径', () => {
    assert.equal(hasContentFields(undefined), false);
    assert.equal(hasContentFields({}), false);
    assert.equal(hasContentFields({ summary: { type: 'text', label: '摘要' } }), true);
    assert.equal(isContentFieldType('image'), true);
    assert.equal(isContentFieldType('richtext'), false);
  });
});

describe('resolveContentFields：多语言解析与 DTO 形状', () => {
  const SCHEMA: ContentFieldsSchema = {
    featuredImage: {
      type: 'image',
      label: { 'zh-CN': '特色图片', en: 'Featured image' },
      description: { 'zh-CN': '列表页展示的封面', en: 'Cover shown in lists' },
      placeholder: { 'zh-CN': 'https://…', en: 'https://…' }
    },
    layout: {
      type: 'select',
      label: { 'zh-CN': '布局', en: 'Layout' },
      options: [
        { value: 'wide', label: { 'zh-CN': '宽屏', en: 'Wide' } },
        { value: 'narrow', label: { 'zh-CN': '窄屏', en: 'Narrow' } }
      ]
    },
    count: { type: 'number', label: '数量', min: 1, max: 5 },
    tags: { type: 'stringList', label: '标签', maxItems: 3 },
    subtitle: { type: 'text', label: { zh: '副标题', en: 'Subtitle' } }
  };

  it('中文：文案取 zh-CN，选项逐项本地化，边界值透传', () => {
    const fields = resolveContentFields(SCHEMA, 'zh-CN');

    assert.deepEqual(fields[0], {
      key: 'featuredImage',
      type: 'image',
      label: '特色图片',
      description: '列表页展示的封面',
      placeholder: 'https://…'
    });
    assert.deepEqual(fields[1]?.options, [
      { value: 'wide', label: '宽屏' },
      { value: 'narrow', label: '窄屏' }
    ]);
    assert.deepEqual(fields[2], { key: 'count', type: 'number', label: '数量', min: 1, max: 5 });
    assert.deepEqual(fields[3], { key: 'tags', type: 'stringList', label: '标签', maxItems: 3 });
    // 未声明的可选维度不下发（前端不该收到一串 undefined 键）
    assert.equal('description' in (fields[1] ?? {}), false);
    assert.equal('placeholder' in (fields[1] ?? {}), false);
    assert.equal('options' in (fields[0] ?? {}), false);
    // 基础语言回退：键只有 zh，站点语言 zh-CN 也要命中
    assert.equal(fields[4]?.label, '副标题');
  });

  it('英文：文案与选项都取 en', () => {
    const fields = resolveContentFields(SCHEMA, 'en');

    assert.equal(fields[0]?.label, 'Featured image');
    assert.equal(fields[0]?.description, 'Cover shown in lists');
    assert.deepEqual(fields[1]?.options, [
      { value: 'wide', label: 'Wide' },
      { value: 'narrow', label: 'Narrow' }
    ]);
  });

  it('未知语言回退到 en；没有 label 时退化为字段名；无声明返回空数组', () => {
    const fields = resolveContentFields(SCHEMA, 'fr-FR');
    assert.equal(fields[0]?.label, 'Featured image');

    const bare = { plain: { type: 'text' } } as unknown as ContentFieldsSchema;
    assert.equal(resolveContentFields(bare, 'zh-CN')[0]?.label, 'plain');
    assert.deepEqual(resolveContentFields(undefined, 'zh-CN'), []);
  });
});

/* --------------------- defineAdminContribution 的 props 契约 --------------------- */

describe('defineAdminContribution：props 必须出现在组件定义里', () => {
  /*
   * 用 URL 动态导入而不写相对说明符：admin-sdk 按源码（.ts + vue）发布，
   * 且不是本测试包的依赖，这样才能既跑真实实现、又不把它纳入本包的类型检查。
   */
  async function loadSdk(): Promise<{
    defineAdminContribution: (options: Record<string, unknown>) => Record<string, unknown>;
  }> {
    return (await import(
      new URL('../../packages/admin-sdk/src/extension/contribution.ts', import.meta.url).href
    )) as { defineAdminContribution: (options: Record<string, unknown>) => Record<string, unknown> };
  }

  it('声明 props 时组件选项带上 props（否则字段只落 attrs，setup(props) 读不到值）', async () => {
    const { defineAdminContribution } = await loadSdk();
    const component = defineAdminContribution({ name: '字数统计', props: ['value'], setup: () => ({}) });

    assert.deepEqual(component.props, ['value']);
    assert.equal(component.name, 'AdminContribution:字数统计');
  });

  it('未声明 props 时不伪造 props 键', async () => {
    const { defineAdminContribution } = await loadSdk();
    const component = defineAdminContribution({ template: '<span>x</span>' });

    assert.equal('props' in component, false);
    assert.equal(component.name, 'AdminContribution:anonymous');
  });
});
