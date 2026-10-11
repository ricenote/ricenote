import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeRichText, markTrusted, isTrusted, escapeHtml, HtmlCache } from '@ricenote/core';
import { RouterRegistry } from '@ricenote/core';
import { cssColor, isValidCssColor, validateSettings, buildDefaults, excerpt, formatDate } from '@ricenote/theme-sdk';
import type { ThemeManifest } from '@ricenote/shared';

describe('富文本消毒', () => {
  it('剥离脚本与事件属性', () => {
    const result = sanitizeRichText('<p onclick="alert(1)">hi</p><script>alert(2)</script>');
    assert.equal(result.value.includes('<script'), false);
    assert.equal(result.value.includes('onclick'), false);
    assert.equal(result.value.includes('hi'), true);
  });

  it('阻止 javascript: 协议', () => {
    const result = sanitizeRichText('<a href="javascript:alert(1)">x</a>');
    assert.equal(result.value.includes('javascript:'), false);
  });

  it('外链自动补充安全属性', () => {
    const result = sanitizeRichText('<a href="https://example.com">x</a>');
    assert.equal(result.value.includes('rel="noopener noreferrer"'), true);
    assert.equal(result.value.includes('target="_blank"'), true);
  });

  it('markTrusted 标记可被识别，普通字符串不被信任', () => {
    assert.equal(isTrusted(markTrusted('<b>x</b>')), true);
    assert.equal(isTrusted('<b>x</b>'), false);
  });

  it('escapeHtml 处理全部危险字符', () => {
    assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('CSS 颜色白名单（主题设置安全注入）', () => {
  it('接受合法颜色', () => {
    assert.equal(cssColor('#89A9C7'), '#89A9C7');
    assert.equal(cssColor('rgb(1, 2, 3)'), 'rgb(1, 2, 3)');
    assert.equal(cssColor('RED'), 'red');
  });

  it('拒绝注入尝试并回退', () => {
    assert.equal(cssColor('red; background:url(evil)'), 'transparent');
    assert.equal(cssColor('</style><script>alert(1)</script>'), 'transparent');
    assert.equal(isValidCssColor('expression(alert(1))'), false);
  });
});

describe('主题设置校验（服务端白名单）', () => {
  const manifest: Pick<ThemeManifest, 'settings'> = {
    settings: {
      appearance: {
        label: '外观',
        fields: {
          accentColor: { type: 'color', label: '强调色', default: '#000000' },
          layoutWidth: { type: 'number', label: '宽度', default: 960, min: 640, max: 1440 },
          showSidebar: { type: 'boolean', label: '侧栏', default: true },
          fontFamily: {
            type: 'select',
            label: '字体',
            default: 'system',
            options: [
              { label: '系统', value: 'system' },
              { label: '衬线', value: 'serif' }
            ]
          }
        }
      }
    }
  };

  it('默认值来自 Manifest 声明', () => {
    assert.deepEqual(buildDefaults(manifest), {
      accentColor: '#000000',
      layoutWidth: 960,
      showSidebar: true,
      fontFamily: 'system'
    });
  });

  it('丢弃未声明的字段（防越权写入）', () => {
    const result = validateSettings(manifest, { evilField: 'x', accentColor: '#ffffff' });
    assert.equal(result.valid, false);
    assert.equal('evilField' in result.normalized, false);
    assert.equal(result.normalized.accentColor, '#ffffff');
  });

  it('数值越界与非法颜色被拒绝', () => {
    assert.equal(validateSettings(manifest, { layoutWidth: 100 }).valid, false);
    assert.equal(validateSettings(manifest, { accentColor: 'not-a-color' }).valid, false);
    assert.equal(validateSettings(manifest, { fontFamily: 'comic' }).valid, false);
  });
});

describe('模板过滤器', () => {
  it('excerpt 剥离标签并按长度截断', () => {
    assert.equal(excerpt('<p>hello <b>world</b></p>', 5), 'hello…');
  });

  it('formatDate 支持自定义格式且对非法值返回空串', () => {
    assert.equal(formatDate('2026-10-11T00:00:00Z', 'YYYY/MM/DD').startsWith('2026/10/'), true);
    assert.equal(formatDate('not-a-date'), '');
  });
});

describe('路由注册冲突检测', () => {
  it('同名页面路由与相同 HTTP 签名都会报冲突', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.a', {
      name: 'home',
      path: '/',
      kind: 'home',
      handler: () => ({ kind: 'home', title: 'a', data: {} })
    });
    assert.throws(() =>
      router.registerPage('rice.b', {
        name: 'home',
        path: '/other',
        kind: 'home',
        handler: () => ({ kind: 'home', title: 'b', data: {} })
      })
    );

    router.registerRaw('rice.a', { method: 'GET', path: '/feed', handler: () => undefined });
    assert.throws(() =>
      router.registerRaw('rice.b', { method: 'GET', path: '/feed', handler: () => undefined })
    );
  });

  it('注销句柄会释放路由与命名冲突记录', () => {
    const router = new RouterRegistry();
    const dispose = router.registerRaw('rice.a', { method: 'GET', path: '/feed', handler: () => undefined });
    dispose();
    assert.equal(router.rawRoutesList().length, 0);
    // 释放后同名路由可以再次注册
    router.registerRaw('rice.b', { method: 'GET', path: '/feed', handler: () => undefined });
    assert.equal(router.rawRoutesList().length, 1);
  });

  it('命名路由生成 URL 并编码参数', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.posts', {
      name: 'post.show',
      path: '/post/:slug',
      kind: 'post',
      handler: () => ({ kind: 'post', title: 'x', data: {} })
    });
    assert.equal(router.resolveUrl('post.show', { slug: '中文 slug' }), '/post/%E4%B8%AD%E6%96%87%20slug');
    assert.throws(() => router.resolveUrl('post.show', {}));
    assert.throws(() => router.resolveUrl('unknown'));
  });
});

describe('HTML 缓存标签失效', () => {
  it('按标签精确失效并统计命中', () => {
    const cache = new HtmlCache({ enabled: true, ttlSeconds: 60 });
    cache.set('k1', '<html>1</html>', ['post:1', 'home']);
    cache.set('k2', '<html>2</html>', ['home']);

    assert.equal(cache.get('k1'), '<html>1</html>');
    assert.equal(cache.invalidateTag('post:1'), 1);
    assert.equal(cache.get('k1'), undefined);
    assert.equal(cache.get('k2'), '<html>2</html>');

    const stats = cache.stats();
    assert.equal(stats.hits, 2);
    assert.equal(stats.invalidations, 1);
  });

  it('关闭时完全不缓存', () => {
    const cache = new HtmlCache({ enabled: false, ttlSeconds: 60 });
    cache.set('k', 'v', []);
    assert.equal(cache.get('k'), undefined);
  });
});
