/**
 * 站点信息写入校验的单元测试。
 *
 * 这是"后台可写配置"的安全边界，因此测试重点是**拒绝**：
 * 未知字段、类型错误、非法语言标签、非 http(s) 地址都必须被挡住。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SITE_SETTING_KEYS, validateSiteSettingsUpdate } from '@ricenote/core';

describe('validateSiteSettingsUpdate', () => {
  it('接受白名单内的字段并归一化', () => {
    const result = validateSiteSettingsUpdate({
      title: '  我的站点  ',
      description: '记录与思考',
      language: 'zh-CN',
      url: 'https://example.com/'
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.normalized, {
      title: '我的站点',
      description: '记录与思考',
      language: 'zh-CN',
      // 末尾斜杠被去掉，避免与 absoluteUrl 拼出双斜杠
      url: 'https://example.com'
    });
  });

  it('拒绝未声明的字段', () => {
    const result = validateSiteSettingsUpdate({ theme: 'rice.minimal' } as never);
    assert.equal(result.valid, false);
    assert.equal(result.issues[0]?.keyword, 'unknownField');
  });

  it('拒绝空标题与非法语言标签', () => {
    assert.equal(validateSiteSettingsUpdate({ title: '   ' }).valid, false);
    assert.equal(validateSiteSettingsUpdate({ language: 'zh_CN' }).valid, false);
    assert.equal(validateSiteSettingsUpdate({ language: 'zh-CN' }).valid, true);
  });

  it('URL 必须带 http(s) 前缀', () => {
    assert.equal(validateSiteSettingsUpdate({ url: 'example.com' }).valid, false);
    assert.equal(validateSiteSettingsUpdate({ url: 'ftp://example.com' }).valid, false);
    assert.equal(validateSiteSettingsUpdate({ url: 'http://localhost:3000' }).valid, true);
  });

  it('Logo / 图标允许外部地址或媒体库相对路径', () => {
    assert.equal(validateSiteSettingsUpdate({ logoUrl: 'https://cdn.example.com/logo.png' }).valid, true);
    assert.equal(validateSiteSettingsUpdate({ logoUrl: '/uploads/2026/10/abc.png' }).valid, true);
    assert.equal(validateSiteSettingsUpdate({ logoUrl: '/media/12' }).valid, true);
    assert.equal(validateSiteSettingsUpdate({ logoUrl: '../../etc/passwd' }).valid, false);
  });

  it('空字符串表示"清除覆盖，回落到 .env"', () => {
    const result = validateSiteSettingsUpdate({ logoUrl: '', icpText: '' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.normalized, { logoUrl: '', icpText: '' });
  });

  it('没有需要更新的字段时视为非法（避免无意义写入）', () => {
    const result = validateSiteSettingsUpdate({});
    assert.equal(result.valid, false);
    assert.equal(result.issues[0]?.keyword, 'minProperties');
  });

  it('revision 不参与字段校验', () => {
    const result = validateSiteSettingsUpdate({ title: '新标题', revision: 3 });
    assert.equal(result.valid, true);
    assert.deepEqual(Object.keys(result.normalized), ['title']);
  });

  it('白名单与文档保持一致（新增字段必须同步文档与后台表单）', () => {
    assert.deepEqual([...SITE_SETTING_KEYS], [
      'title',
      'description',
      'language',
      'url',
      'logoUrl',
      'faviconUrl',
      'icpText',
      'icpUrl'
    ]);
  });

  it('各字段长度上限生效', () => {
    assert.equal(validateSiteSettingsUpdate({ title: 'a'.repeat(161) }).valid, false);
    assert.equal(validateSiteSettingsUpdate({ description: 'a'.repeat(501) }).valid, false);
    assert.equal(validateSiteSettingsUpdate({ icpText: 'a'.repeat(121) }).valid, false);
    assert.equal(validateSiteSettingsUpdate({ faviconUrl: '/media/' + 'a'.repeat(500) }).valid, false);
  });
});
