/**
 * 内容模板键校验的单元测试。
 *
 * 覆盖"页面与文章共用同一套可选模板"的三个关键行为：
 * 空值合法、清单外拒绝、清单内通过。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveContentTemplateKey, isRiceNoteError, type PageTemplateDescriptor } from '@ricenote/shared';

const AVAILABLE: PageTemplateDescriptor[] = [
  { key: 'default', template: 'page.njk', label: '标准页面' },
  { key: 'plain', template: 'page-plain.njk', label: '落地页' },
  { key: 'narrow', template: 'page-narrow.njk', label: '窄栏' }
];

describe('resolveContentTemplateKey', () => {
  it('空值（含空白）表示使用主题默认模板', () => {
    assert.equal(resolveContentTemplateKey(undefined, AVAILABLE), null);
    assert.equal(resolveContentTemplateKey(null, AVAILABLE), null);
    assert.equal(resolveContentTemplateKey('', AVAILABLE), null);
    assert.equal(resolveContentTemplateKey('   ', AVAILABLE), null);
  });

  it('命中清单时返回归一化后的键', () => {
    assert.equal(resolveContentTemplateKey('plain', AVAILABLE), 'plain');
    assert.equal(resolveContentTemplateKey('  narrow  ', AVAILABLE), 'narrow');
  });

  it('清单外的键被拒绝，并在 details 中给出可选值', () => {
    try {
      resolveContentTemplateKey('landing', AVAILABLE);
      assert.fail('应当抛出错误');
    } catch (error) {
      assert.ok(isRiceNoteError(error));
      assert.equal(error.code, 'RN_CONTENT_TEMPLATE_INVALID');
      assert.equal(error.status, 400);
      assert.deepEqual(error.details.available, ['default', 'plain', 'narrow']);
    }
  });

  it('主题未声明任何模板时拒绝具体键（避免静默回退）', () => {
    try {
      resolveContentTemplateKey('plain', []);
      assert.fail('应当抛出错误');
    } catch (error) {
      assert.ok(isRiceNoteError(error));
      assert.equal(error.code, 'RN_CONTENT_TEMPLATE_INVALID');
    }
    // 但空值仍然合法：不选模板就是"跟主题默认"
    assert.equal(resolveContentTemplateKey('', []), null);
  });

  it('过长的键被拒绝', () => {
    try {
      resolveContentTemplateKey('x'.repeat(121), AVAILABLE);
      assert.fail('应当抛出错误');
    } catch (error) {
      assert.ok(isRiceNoteError(error));
      assert.match(error.message, /过长/);
    }
  });
});
