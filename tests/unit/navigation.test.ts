/**
 * 导航项纯函数的单元测试。
 *
 * 这些函数虽然小，但各自压着一条不能出错的性质：
 * - `normalizeNavHref` 是**安全边界**（后台写入的地址会被直接输出到前台 `<a href>`）；
 * - `isActiveNavHref` 决定"当前项高亮"，错了会让访客以为站点只有首页；
 * - `moveInOrder` 压着"点到边界不丢项"，错了会静默打乱导航顺序。
 *
 * 与集成测试的分工：这里只测函数本身，真实链路由 v030-features 覆盖。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_LABEL_LENGTH,
  currentPathOf,
  isActiveNavHref,
  moveInOrder,
  normalizeNavHref,
  normalizeNavLabel,
  sortOrderAt
} from '@ricenote/plugin-navigation/dist/nav.js';

describe('normalizeNavHref：地址白名单', () => {
  it('接受站内绝对路径与 http(s) 绝对地址', () => {
    assert.equal(normalizeNavHref('/'), '/');
    assert.equal(normalizeNavHref('/about'), '/about');
    assert.equal(normalizeNavHref('/post/a?x=1'), '/post/a?x=1');
    assert.equal(normalizeNavHref('https://example.com/a'), 'https://example.com/a');
    assert.equal(normalizeNavHref('http://example.com'), 'http://example.com');
    assert.equal(normalizeNavHref('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM');
  });

  it('去掉首尾空白', () => {
    assert.equal(normalizeNavHref('  /about  '), '/about');
  });

  it('拒绝一切可能执行脚本或绕过校验的写法', () => {
    for (const value of [
      '',
      '   ',
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'mailto:a@b.com',
      'about', // 相对路径：会随当前页面变化，不可预期
      './about',
      '../about',
      '//evil.com', // 协议相对地址
      '#anchor'
    ]) {
      assert.equal(normalizeNavHref(value), undefined, `应拒绝：${value}`);
    }
  });

  it('拒绝超长与非字符串', () => {
    assert.equal(normalizeNavHref(`/${'a'.repeat(500)}`), undefined);
    assert.equal(normalizeNavHref(`/${'a'.repeat(499)}`), `/${'a'.repeat(499)}`);
    for (const value of [undefined, null, 123, {}, []]) {
      assert.equal(normalizeNavHref(value), undefined);
    }
  });
});

describe('normalizeNavLabel：文案收敛', () => {
  it('去空白并截断到列宽上限', () => {
    assert.equal(normalizeNavLabel('  关于我们  '), '关于我们');
    assert.equal(normalizeNavLabel(undefined), '');
    assert.equal(normalizeNavLabel(42), '');
    assert.equal(normalizeNavLabel('啊'.repeat(200)).length, MAX_LABEL_LENGTH);
  });
});

describe('currentPathOf：请求路径归一化', () => {
  it('去掉查询串、片段与尾部斜杠', () => {
    assert.equal(currentPathOf('/a/b'), '/a/b');
    assert.equal(currentPathOf('/a/b?page=2'), '/a/b');
    assert.equal(currentPathOf('/a/b#top'), '/a/b');
    assert.equal(currentPathOf('/a/b/?x=1#top'), '/a/b');
    assert.equal(currentPathOf('/'), '/');
    assert.equal(currentPathOf(''), '');
    assert.equal(currentPathOf(undefined), '');
  });

  it('解码百分号编码（请求行里的 URL 一定是编码过的）', () => {
    assert.equal(currentPathOf('/page/%E5%85%B3%E4%BA%8E'), '/page/关于');
    assert.equal(currentPathOf('/post/a%2Bb'), '/post/a+b');
    assert.equal(currentPathOf('/%E4%B8%AD%E6%96%87/?q=1'), '/中文');
  });

  it('非法编码序列不会抛错', () => {
    assert.equal(currentPathOf('/page/%E5%ZZ'), '/page/%E5%ZZ');
  });
});

describe('isActiveNavHref：当前项判定', () => {
  const current = currentPathOf('/page/about');

  it('同一路径（含查询串与尾部斜杠差异）视为当前项', () => {
    assert.equal(isActiveNavHref('/page/about', current), true);
    assert.equal(isActiveNavHref('/page/about/?from=nav', current), true);
    assert.equal(isActiveNavHref('/page/about#x', current), true);
  });

  it('中文（编码后的请求路径 vs 数据库里的原始地址）同样算当前项', () => {
    // 真实场景：请求行是 /page/%E5%85%B3%E4%BA%8E，导航地址是 /page/关于
    const encoded = currentPathOf('/page/%E5%85%B3%E4%BA%8E');
    assert.equal(encoded, '/page/关于');
    assert.equal(isActiveNavHref('/page/关于', encoded), true);
    // 直接传原始 URL 也应成立（函数两侧都会归一化）
    assert.equal(isActiveNavHref('/page/关于', '/page/%E5%85%B3%E4%BA%8E'), true);
  });

  it('前缀相似但不同路径不算当前项', () => {
    assert.equal(isActiveNavHref('/page/about-us', current), false);
    assert.equal(isActiveNavHref('/page/', current), false);
  });

  it('外链与空路径永远不算当前项', () => {
    assert.equal(isActiveNavHref('https://example.com/page/about', current), false);
    assert.equal(isActiveNavHref('/page/about', ''), false);
  });
});

describe('moveInOrder：顺序调整', () => {
  it('上移/下移交换相邻项', () => {
    assert.deepEqual(moveInOrder([1, 2, 3], 2, 'up'), [2, 1, 3]);
    assert.deepEqual(moveInOrder([1, 2, 3], 2, 'down'), [1, 3, 2]);
  });

  it('边界处幂等（返回原顺序的副本，不丢项）', () => {
    const ids = [1, 2, 3];
    assert.deepEqual(moveInOrder(ids, 1, 'up'), [1, 2, 3]);
    assert.deepEqual(moveInOrder(ids, 3, 'down'), [1, 2, 3]);
    // 不修改入参
    assert.deepEqual(ids, [1, 2, 3]);
  });

  it('不存在的 ID 不改变顺序', () => {
    assert.deepEqual(moveInOrder([1, 2], 9, 'up'), [1, 2]);
    assert.deepEqual(moveInOrder([], 1, 'down'), []);
  });
});

describe('sortOrderAt：排序间隔', () => {
  it('从 10 开始按 10 递增', () => {
    assert.equal(sortOrderAt(0), 10);
    assert.equal(sortOrderAt(1), 20);
    assert.equal(sortOrderAt(9), 100);
  });
});
