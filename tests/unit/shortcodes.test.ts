/**
 * 短代码：语法内核与分词器的单元测试。
 *
 * 这些纯函数是整个特性最容易出错的地方 —— 跨段落、代码块误伤、空壳段落清理，
 * 任何一条错都会表现成"页面上多出空行"或"文章里的示例代码被吃掉"，
 * 因此逐条钉住。DOM 层（把片段挂到容器上）由集成测试与浏览器实测覆盖。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isShortcodeName,
  parseShortcodeAttributes,
  shortcodeRuntimeUrl,
  stripShortcodeMarks,
  stripShortcodeMarksFromHtml
} from '@ricenote/shared';
import {
  escapeHtml,
  htmlToSourceText,
  tokenizeShortcodes,
  type ShortcodeToken
} from '@ricenote/theme-sdk/shortcodes/tokenizer';

const KNOWN = new Set(['warn', 'note']);

type ShortcodeTokenOf = Extract<ShortcodeToken, { kind: 'shortcode' }>;

/** 取出唯一的短代码产物（顺带断言"恰好一个"）。 */
function onlyShortcode(tokens: ShortcodeToken[]): ShortcodeTokenOf {
  const found = tokens.filter((token): token is ShortcodeTokenOf => token.kind === 'shortcode');
  assert.equal(found.length, 1, `应恰好识别出一个短代码，实际 ${found.length}`);
  return found[0]!;
}

describe('stripShortcodeMarks：纯文字场合只留文字', () => {
  it('剥掉配对标记，保留内部文字', () => {
    assert.equal(stripShortcodeMarks('[warn]这里是内容[/warn]'), '这里是内容');
  });

  it('相邻的多个短代码互不影响', () => {
    assert.equal(stripShortcodeMarks('[warn]a[/warn] [note]b[/note]'), 'a b');
  });

  it('带参数与跨段落的写法也只剩文字', () => {
    assert.equal(stripShortcodeMarks('[warn title="注意"]多段\n\n正文[/warn]'), '多段\n\n正文');
  });

  it('自闭合标记整体消失', () => {
    assert.equal(stripShortcodeMarks('前[warn/]后'), '前后');
  });

  it('大写的方括号文字不是短代码（避免误伤 Markdown 链接文本）', () => {
    assert.equal(stripShortcodeMarks('[Text]不是短代码[/Text]'), '[Text]不是短代码[/Text]');
  });

  it('不动 Markdown 链接与图片', () => {
    assert.equal(
      stripShortcodeMarks('看这里 [文档](https://a.com) 和 [warn]提示[/warn]'),
      '看这里 [文档](https://a.com) 和 提示'
    );
    assert.equal(stripShortcodeMarks('![warn](x.png)'), '![warn](x.png)');
  });

  it('被反斜杠转义的标记不动', () => {
    assert.equal(stripShortcodeMarks('a\\[warn]b'), 'a\\[warn]b');
  });

  it('空输入与无方括号的输入原样返回', () => {
    assert.equal(stripShortcodeMarks(''), '');
    assert.equal(stripShortcodeMarks('普通正文'), '普通正文');
  });
});

describe('stripShortcodeMarksFromHtml：顺带清掉变空的块', () => {
  it('剥掉标记后只剩空段落时，把空段落一并清掉', () => {
    assert.equal(
      stripShortcodeMarksFromHtml('<p>[warn]</p><p>正文</p><p>[/warn]</p>'),
      '<p>正文</p>'
    );
  });

  it('嵌套的空块需要多轮才能清干净', () => {
    assert.equal(stripShortcodeMarksFromHtml('<blockquote><p>[warn]</p></blockquote>'), '');
  });

  it('有内容的块不受影响', () => {
    const html = '<p>[warn]第一段</p><p>第二段[/warn]</p>';
    assert.equal(stripShortcodeMarksFromHtml(html), '<p>第一段</p><p>第二段</p>');
  });
});

describe('parseShortcodeAttributes：参数与布尔键', () => {
  it('支持双引号、单引号、裸值与只写键名', () => {
    assert.deepEqual(parseShortcodeAttributes(' title="注意" type=\'info\' level=2 flag'), {
      title: '注意',
      type: 'info',
      level: '2',
      flag: 'flag'
    });
  });

  it('空参数得到空对象', () => {
    assert.deepEqual(parseShortcodeAttributes(''), {});
  });
});

describe('isShortcodeName 与引擎地址', () => {
  it('只接受小写字母开头、可含数字与连字符', () => {
    assert.equal(isShortcodeName('warn'), true);
    assert.equal(isShortcodeName('my-box2'), true);
    assert.equal(isShortcodeName('Warn'), false);
    assert.equal(isShortcodeName('2warn'), false);
    assert.equal(isShortcodeName('my box'), false);
  });

  it('引擎地址带版本查询串，避免升级后浏览器沿用旧产物', () => {
    assert.equal(shortcodeRuntimeUrl('1.2.3'), '/theme-sdk/v1/ricenote-shortcodes.js?v=1.2.3');
  });
});

describe('tokenizeShortcodes：整段写法', () => {
  it('标记独成一段时整段被替换，不留空 <p>', () => {
    const tokens = tokenizeShortcodes('<p>[warn]这里是内容[/warn]</p>', { known: KNOWN });
    const shortcode = onlyShortcode(tokens);
    assert.equal(shortcode.name, 'warn');
    assert.equal(shortcode.bodyHtml, '这里是内容');
    assert.equal(shortcode.bodyText, '这里是内容');
    assert.equal(shortcode.selfClosing, false);
    // raw 保留整段原文：定义选择"不处理"时能原样放回
    assert.equal(shortcode.raw, '<p>[warn]这里是内容[/warn]</p>');
    assert.equal(tokens.filter((token) => token.kind === 'html').length, 0);
  });

  it('跨段落：多段文字、列表整体归入内容', () => {
    const html = '<p>[warn]</p><p>第一段</p><ul><li>条目</li></ul><p>[/warn]</p>';
    const tokens = tokenizeShortcodes(html, { known: KNOWN });
    const shortcode = onlyShortcode(tokens);
    assert.equal(shortcode.bodyHtml, '<p>第一段</p><ul><li>条目</li></ul>');
    assert.equal(shortcode.bodyText, '第一段 条目');
    assert.equal(shortcode.raw, html);
  });

  it('前后有正文时，正文片段与短代码按顺序产出', () => {
    const tokens = tokenizeShortcodes('<p>前文</p><p>[warn]x[/warn]</p><p>后文</p>', {
      known: KNOWN
    });
    assert.deepEqual(
      tokens.map((token) => (token.kind === 'html' ? `html:${token.value}` : `sc:${token.name}`)),
      ['html:<p>前文</p>', 'sc:warn', 'html:<p>后文</p>']
    );
  });

  it('带参数与自闭合形态', () => {
    const withAttributes = onlyShortcode(
      tokenizeShortcodes('<p>[warn title="注意" flag]正文[/warn]</p>', { known: KNOWN })
    );
    assert.deepEqual(withAttributes.attributes, { title: '注意', flag: 'flag' });

    const selfClosing = onlyShortcode(
      tokenizeShortcodes('<p>前[warn/]后</p>', { known: KNOWN })
    );
    assert.equal(selfClosing.selfClosing, true);
    assert.equal(selfClosing.bodyHtml, '');
  });
});

describe('tokenizeShortcodes：不误伤与容错', () => {
  it('代码块与行内代码里的标记不解析', () => {
    const fenced = '<pre><code>[warn]示例[/warn]</code></pre>';
    assert.deepEqual(tokenizeShortcodes(fenced, { known: KNOWN }), [
      { kind: 'html', value: fenced }
    ]);

    const inline = '<p>写法是 <code>[warn]x[/warn]</code> 这样</p>';
    assert.deepEqual(tokenizeShortcodes(inline, { known: KNOWN }), [
      { kind: 'html', value: inline }
    ]);
  });

  it('HTML 注释里的标记不解析', () => {
    const html = '<p>a</p><!-- [warn]x[/warn] --><p>b</p>';
    assert.deepEqual(tokenizeShortcodes(html, { known: KNOWN }), [{ kind: 'html', value: html }]);
  });

  it('未注册的名字与未闭合的标记都原样保留', () => {
    const unknown = '<p>[danger]危险[/danger]</p>';
    assert.deepEqual(tokenizeShortcodes(unknown, { known: KNOWN }), [
      { kind: 'html', value: unknown }
    ]);

    const unclosed = '<p>[warn]没有闭合</p>';
    assert.deepEqual(tokenizeShortcodes(unclosed, { known: KNOWN }), [
      { kind: 'html', value: unclosed }
    ]);
  });

  it('与其它文字同处一行时保留段落，只替换标记本身', () => {
    const tokens = tokenizeShortcodes('<p>提示：[warn]内[/warn] 结束</p>', { known: KNOWN });
    assert.deepEqual(
      tokens.map((token) => (token.kind === 'html' ? token.value : `sc:${token.name}`)),
      ['<p>提示：', 'sc:warn', ' 结束</p>']
    );
  });

  it('同名嵌套按深度配对，内层标记留在内容里（不支持嵌套渲染）', () => {
    const shortcode = onlyShortcode(
      tokenizeShortcodes('<p>[warn]外[warn]内[/warn]尾[/warn]</p>', { known: KNOWN })
    );
    assert.equal(shortcode.bodyHtml, '外[warn]内[/warn]尾');
  });

  it('未注册任何短代码时直接短路，不改变 HTML', () => {
    const html = '<p>[warn]x[/warn]</p>';
    assert.deepEqual(tokenizeShortcodes(html, { known: new Set() }), [{ kind: 'html', value: html }]);
  });

  it('多处混用时片段顺序与原文一致', () => {
    const tokens = tokenizeShortcodes('<p>[warn]a[/warn]</p><p>[note]b[/note]</p>', {
      known: KNOWN
    });
    assert.deepEqual(
      tokens.map((token) => (token.kind === 'html' ? token.value : token.name)),
      ['warn', 'note']
    );
  });
});

describe('纯文本与转义工具', () => {
  it('htmlToSourceText 去标签、解实体并压缩空白', () => {
    assert.equal(
      htmlToSourceText('<p>第一段 &amp; 第二段</p><p><strong>加粗</strong>\n换行</p>'),
      '第一段 & 第二段 加粗 换行'
    );
  });

  it('escapeHtml 转义会让结构被破坏的字符', () => {
    assert.equal(escapeHtml('<img src=x onerror="1">'), '&lt;img src=x onerror=&quot;1&quot;&gt;');
    assert.equal(escapeHtml(undefined), '');
  });
});
