import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveLocalizedText } from '@ricenote/theme-sdk';

describe('resolveLocalizedText：主题设置多语言文案', () => {
  it('字符串原样返回（未声明多语言时行为不变）', () => {
    assert.equal(resolveLocalizedText('主色', 'zh-CN'), '主色');
    assert.equal(resolveLocalizedText('Accent', 'en'), 'Accent');
  });

  it('未提供文案时返回 fallback', () => {
    assert.equal(resolveLocalizedText(undefined, 'zh-CN', '未命名'), '未命名');
    assert.equal(resolveLocalizedText('', 'zh-CN', '未命名'), '未命名');
    assert.equal(resolveLocalizedText({}, 'zh-CN', '未命名'), '未命名');
  });

  it('精确语言标签优先', () => {
    const label = { 'zh-CN': '简体', 'zh-TW': '繁體', en: 'English' };
    assert.equal(resolveLocalizedText(label, 'zh-CN'), '简体');
    assert.equal(resolveLocalizedText(label, 'zh-TW'), '繁體');
    assert.equal(resolveLocalizedText(label, 'en'), 'English');
  });

  it('区域标签缺失时回退到基础语言', () => {
    const label = { zh: '简体', en: 'English' };
    assert.equal(resolveLocalizedText(label, 'zh-CN'), '简体');
    assert.equal(resolveLocalizedText(label, 'zh-Hans-CN'), '简体');
  });

  it('语言不匹配时回退到 en，再回退到首个非空值', () => {
    assert.equal(resolveLocalizedText({ ja: '日本語', en: 'English' }, 'fr'), 'English');
    assert.equal(resolveLocalizedText({ ja: '日本語', de: 'Deutsch' }, 'fr'), '日本語');
  });

  it('忽略空值条目并做大小写归一', () => {
    const label = { EN: 'English', '': '无效' };
    assert.equal(resolveLocalizedText(label, 'en-US'), 'English');
  });

  it('语言标签大小写不敏感', () => {
    assert.equal(resolveLocalizedText({ 'ZH-cn': '中文' }, 'zh-CN'), '中文');
  });
});
