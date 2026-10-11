import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { absoluteUrl, safeJsonForInlineScript, stripQuery } from '@ricenote/shared';

describe('absoluteUrl：站点绝对地址拼接', () => {
  it('拼接相对路径并去掉末尾斜杠', () => {
    assert.equal(absoluteUrl('https://example.com/', '/post/hello'), 'https://example.com/post/hello');
    assert.equal(absoluteUrl('https://example.com', '/a/b'), 'https://example.com/a/b');
  });

  it('根路径不产生多余斜杠', () => {
    assert.equal(absoluteUrl('https://example.com/', '/'), 'https://example.com');
    assert.equal(absoluteUrl('https://example.com', '/'), 'https://example.com');
  });

  it('缺少前导斜杠时自动补齐', () => {
    assert.equal(absoluteUrl('https://example.com', 'post/hello'), 'https://example.com/post/hello');
  });

  it('已是绝对 URL 时原样返回（不重复拼接站点前缀）', () => {
    assert.equal(absoluteUrl('https://example.com', 'https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
    assert.equal(absoluteUrl('https://example.com', 'http://other.test/x'), 'http://other.test/x');
  });

  it('保留查询串与中文路径（调用方负责编码）', () => {
    assert.equal(absoluteUrl('https://example.com', '/search?q=主题'), 'https://example.com/search?q=主题');
  });
});

describe('stripQuery：去掉查询串与片段', () => {
  it('去掉查询串', () => {
    assert.equal(stripQuery('/post/hello?comment=pending'), '/post/hello');
    assert.equal(stripQuery('/search?q=1&page=2'), '/search');
  });

  it('去掉片段', () => {
    assert.equal(stripQuery('/post/hello#comments'), '/post/hello');
    assert.equal(stripQuery('/post/hello?comment=1#comments'), '/post/hello');
  });

  it('无查询串时原样返回', () => {
    assert.equal(stripQuery('/post/hello'), '/post/hello');
  });
});

describe('safeJsonForInlineScript：内联脚本安全序列化', () => {
  it('普通对象序列化结果可被 JSON.parse 还原', () => {
    const payload = { '@type': 'BlogPosting', name: '标题' };
    assert.deepEqual(JSON.parse(safeJsonForInlineScript(payload)), payload);
  });

  it('转义 </script> 等标签边界序列（防止提前闭合 script）', () => {
    const serialized = safeJsonForInlineScript({ html: '</script><img src=x onerror=alert(1)>' });
    assert.equal(serialized.includes('<'), false, '不应残留裸 <');
    assert.equal(serialized.includes('>'), false, '不应残留裸 >');
    assert.equal(serialized.includes('\\u003c/script\\u003e'), true);
    // 转义是等价的：解析回来仍是原始内容
    assert.equal(JSON.parse(serialized).html, '</script><img src=x onerror=alert(1)>');
  });

  it('转义 & 与 U+2028 / U+2029（JS 行分隔符）', () => {
    const serialized = safeJsonForInlineScript({ text: 'a&b\u2028c\u2029d' });
    assert.equal(serialized.includes('&'), false);
    assert.equal(serialized.includes('\\u2028'), true);
    assert.equal(serialized.includes('\\u2029'), true);
    assert.equal(JSON.parse(serialized).text, 'a&b\u2028c\u2029d');
  });
});
