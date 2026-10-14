/**
 * 路径模板引擎的单元测试（`@ricenote/shared` 的纯实现）。
 *
 * 引擎是「固定链接」的地基：它同时决定**路由能不能注册**（编译）、
 * **链接对不对**（生成）与**旧地址会不会串**（抽取）。三件事都只在这里实现一次，
 * 因此边界必须压死：
 * - 非法模板必须在保存前就被拒绝，而不是等启动时才炸；
 * - `.html` 一类字面量后缀必须"存在才算命中"，否则 `/archives/foo` 会变成
 *   `/archives/foo.html` 的第二个可访问地址（同一内容两个 URL，SEO 大忌）；
 * - 缺失取值必须抛错而不是拼出一个坏链接。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compilePathTemplate,
  parsePathTemplate,
  validatePathTemplate
} from '@ricenote/shared';

const POST_TOKENS = ['cid', 'slug', 'category', 'year', 'month', 'day'];

describe('parsePathTemplate：结构解析', () => {
  it('识别段、参数与尾斜杠', () => {
    const parsed = parsePathTemplate('/archives/{cid}/');
    assert.equal(parsed.trailingSlash, true);
    assert.deepEqual(parsed.tokens, ['cid']);
    assert.deepEqual(parsed.segments.map((segment) => segment.raw), ['archives', '{cid}']);
    assert.deepEqual(parsed.issues, []);
  });

  it('参数与字面量可以在同一段内（前缀会进 literals）', () => {
    const parsed = parsePathTemplate('/post/id-{cid}');
    assert.deepEqual(parsed.segments[1]?.literals, ['id-', '']);
    assert.deepEqual(parsed.segments[1]?.tokens, ['cid']);
  });

  it('根路径不是"尾斜杠"', () => {
    const parsed = parsePathTemplate('/');
    assert.equal(parsed.trailingSlash, false);
    assert.deepEqual(parsed.segments, []);
  });
});

describe('validatePathTemplate：保存前的校验', () => {
  const check = (template: string, minTokens = 1) =>
    validatePathTemplate(template, { allowedTokens: POST_TOKENS, minTokens });

  it('接受四种常见风格', () => {
    for (const template of [
      '/post/{slug}',
      '/archives/{cid}/',
      '/archives/{slug}.html',
      '/{year}/{month}/{day}/{slug}.html',
      '/{category}/{slug}.html'
    ]) {
      assert.equal(check(template).valid, true, `应接受：${template}`);
    }
  });

  it('拒绝空路径、缺少前导斜杠、空白与查询串', () => {
    assert.equal(check('').valid, false);
    assert.equal(check('archives/{cid}').valid, false);
    assert.equal(check('/archives/{cid}?x=1').valid, false);
    assert.equal(check('/archives/{cid}/#top').valid, false);
    assert.equal(check('/archives /{cid}').valid, false);
    assert.equal(check('/a//{cid}').valid, false);
  });

  it('拒绝未声明参数、重复参数与同一段多参数', () => {
    assert.equal(check('/archives/{directory}/').valid, false, 'directory 本期不提供');
    assert.equal(check('/{slug}/{slug}').valid, false);
    assert.equal(check('/{year}-{month}/{slug}').valid, false);
    assert.equal(check('/{Slug}').valid, false);
  });

  it('要求至少一个参数', () => {
    assert.equal(check('/archives/').valid, false);
    assert.equal(check('/').valid, false);
    // 明确给出下限时按下限判定（例如以后要求至少两个参数）
    assert.equal(check('/{cid}/', 2).valid, false);
  });

  it('超长模板被拒绝', () => {
    const long = `/${'a'.repeat(210)}/{cid}`;
    assert.equal(check(long).valid, false);
  });

  it('非法写法给出可读原因', () => {
    const result = check('/archives/{slug}/{slug}');
    assert.equal(result.valid, false);
    assert.match(result.issues.map((issue) => issue.message).join('；'), /参数重复/);
  });
});

describe('compilePathTemplate：匹配模式与生成模式', () => {
  it('.html 后缀：匹配模式剥离后缀，生成模式保留后缀', () => {
    const compiled = compilePathTemplate('/archives/{slug}.html', {
      allowedTokens: POST_TOKENS
    });
    assert.equal(compiled.routePattern, '/archives/:slug');
    assert.equal(compiled.urlPattern, '/archives/:slug.html');
    assert.equal(compiled.build({ slug: 'hello' }), '/archives/hello.html');
  });

  it('尾斜杠保留在生成模式里，但匹配模式去掉它', () => {
    const compiled = compilePathTemplate('/archives/{cid}/', { allowedTokens: POST_TOKENS });
    assert.equal(compiled.routePattern, '/archives/:cid');
    assert.equal(compiled.urlPattern, '/archives/:cid/');
    assert.equal(compiled.build({ cid: 12 }), '/archives/12/');
  });

  it('多段参数逐一转成 :param', () => {
    const compiled = compilePathTemplate('/{year}/{month}/{day}/{slug}', {
      allowedTokens: POST_TOKENS
    });
    assert.equal(compiled.routePattern, '/:year/:month/:day/:slug');
    assert.equal(compiled.urlPattern, '/:year/:month/:day/:slug');
  });

  it('生成结果做 URL 编码（中文别名）', () => {
    const compiled = compilePathTemplate('/post/{slug}', { allowedTokens: POST_TOKENS });
    assert.equal(compiled.build({ slug: '中文' }), '/post/%E4%B8%AD%E6%96%87');
  });

  it('缺失取值直接抛错，不产出坏链接', () => {
    const compiled = compilePathTemplate('/archives/{slug}.html', { allowedTokens: POST_TOKENS });
    assert.throws(() => compiled.build({}), /缺少参数/);
  });

  it('出现未声明参数或重复参数时拒绝编译', () => {
    assert.throws(
      () => compilePathTemplate('/{directory}/', { allowedTokens: POST_TOKENS }),
      /不支持的参数/
    );
    assert.throws(() => compilePathTemplate('/{slug}/{slug}', { allowedTokens: POST_TOKENS }), /参数重复/);
  });
});

describe('extract：从路由参数还原取值', () => {
  it('剥离 .html 后缀', () => {
    const compiled = compilePathTemplate('/archives/{slug}.html', { allowedTokens: POST_TOKENS });
    assert.deepEqual(compiled.extract({ slug: 'hello.html' }), { slug: 'hello' });
  });

  it('缺少后缀时判为不命中（避免同一内容出现两个地址）', () => {
    const compiled = compilePathTemplate('/archives/{slug}.html', { allowedTokens: POST_TOKENS });
    assert.equal(compiled.extract({ slug: 'hello' }), undefined);
  });

  it('剥离段内前缀与后缀', () => {
    const compiled = compilePathTemplate('/post/id-{cid}.html', { allowedTokens: POST_TOKENS });
    assert.deepEqual(compiled.extract({ cid: 'id-7.html' }), { cid: '7' });
    assert.equal(compiled.extract({ cid: '7.html' }), undefined);
    assert.equal(compiled.extract({ cid: 'id-7' }), undefined);
  });

  it('多段参数各自剥离后返回', () => {
    const compiled = compilePathTemplate('/{year}/{month}/{day}/{slug}.html', {
      allowedTokens: POST_TOKENS
    });
    assert.deepEqual(compiled.extract({ year: '2026', month: '03', day: '05', slug: 'a.html' }), {
      year: '2026',
      month: '03',
      day: '05',
      slug: 'a'
    });
  });

  it('取值被后缀吃空时判为不命中', () => {
    const compiled = compilePathTemplate('/archives/{slug}.html', { allowedTokens: POST_TOKENS });
    assert.equal(compiled.extract({ slug: '.html' }), undefined);
  });
});
