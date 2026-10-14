/**
 * 页面路由「路径替换」能力的单元测试。
 *
 * 这是「固定链接」插件接管前台地址所依赖的最小内核能力，性质有三条不能破：
 * - **顺序无关**：替换按路由名登记，在读取时叠加。若要求"被接管的路由先注册"，
 *   固定链接插件就不得不硬依赖 posts / pages（无法自由启停）；
 * - **显式许可**：只有所有者声明 `overridable: true` 的路由才允许被改路径，
 *   否则任何插件都能劫持别人的地址；
 * - **可撤销 + 不冲突**：停用即恢复原路径；替换后的路径与其它路由撞车必须当场报错，
 *   而不是等 Fastify 抛出一条难以定位的重复路由错误。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RouterRegistry } from '@ricenote/core';
import type { PageRouteSpec } from '@ricenote/plugin-sdk';

function spec(name: string, path: string, overridable = false): PageRouteSpec {
  return {
    name,
    path,
    kind: 'post',
    ...(overridable ? { overridable: true } : {}),
    handler: () => ({ kind: 'post', title: name, data: {} })
  };
}

describe('RouterRegistry.overridePath：路径接管', () => {
  it('接管已注册且声明可接管的路由，并同时提供生成模式', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.posts', spec('post.show', '/post/:slug', true));

    router.overridePath('rice.permalink', 'post.show', {
      path: '/archives/:cid',
      urlPath: '/archives/:cid/'
    });

    const route = router.findPageByName('post.show');
    assert.equal(route?.path, '/archives/:cid');
    assert.equal(route?.urlPath, '/archives/:cid/');
    // 生成路径用 urlPath（保留尾斜杠），而不是匹配用的 path
    assert.equal(router.resolveUrl('post.show', { cid: 12 }), '/archives/12/');
    // handler 不被替换（接管方只改地址形式）
    assert.equal(route?.pluginId, 'rice.posts');
  });

  it('目标路由尚未注册时明确报错，不静默登记一个永远不会生效的意图', () => {
    const router = new RouterRegistry();
    assert.throws(
      () => router.overridePath('rice.permalink', 'post.show', { path: '/archives/:cid' }),
      /不存在/
    );
  });

  it('替换是按路由名登记的：读取时叠加，因此与读取时刻无关', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.posts', spec('post.show', '/post/:slug', true));
    router.overridePath('rice.permalink', 'post.show', { path: '/archives/:cid' });
    // 同一份登记被 pages() / findPageByName() / resolveUrl() 三处一致地观察到
    assert.equal(router.pages()[0]?.path, '/archives/:cid');
    assert.equal(router.findPageByName('post.show')?.path, '/archives/:cid');
    assert.equal(router.resolveUrl('post.show', { cid: 1 }), '/archives/1');
  });

  it('未声明可接管的路由被拒绝', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.search', spec('search', '/search'));
    assert.throws(
      () => router.overridePath('rice.permalink', 'search', { path: '/find' }),
      /未声明可被接管/
    );
    assert.equal(router.findPageByName('search')?.path, '/search');
  });

  it('同一路由不允许被两家插件同时接管', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.posts', spec('post.show', '/post/:slug', true));
    router.overridePath('rice.permalink', 'post.show', { path: '/archives/:cid' });
    assert.throws(
      () => router.overridePath('rice.other', 'post.show', { path: '/a/:cid' }),
      /已被 rice.permalink 接管/
    );
  });

  it('句柄注销后恢复原路径（停用插件即回退）', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.posts', spec('post.show', '/post/:slug', true));
    const dispose = router.overridePath('rice.permalink', 'post.show', {
      path: '/archives/:cid'
    });

    assert.equal(router.findPageByName('post.show')?.path, '/archives/:cid');
    dispose();
    assert.equal(router.findPageByName('post.show')?.path, '/post/:slug');
    // 未追加 urlPath 时退化为与 path 相同
    assert.equal(router.resolveUrl('post.show', { slug: 'hello' }), '/post/hello');
  });

  it('替换后的路径与其它页面路由撞车时当场报错', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.posts', spec('post.show', '/post/:slug', true));
    router.registerPage('rice.pages', spec('page.show', '/page/:slug', true));

    assert.throws(
      () => router.overridePath('rice.permalink', 'post.show', { path: '/page/:cid' }),
      /路径冲突/
    );
  });

  it('注册新路由时也会与已生效的替换路径比对', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.posts', spec('post.show', '/post/:slug', true));
    router.overridePath('rice.permalink', 'post.show', { path: '/archives/:cid' });

    assert.throws(() => router.registerPage('rice.other', spec('other.show', '/archives/:id')), /路径冲突/);
  });

  it('参数名不同但结构相同的两条路由同样算冲突', () => {
    const router = new RouterRegistry();
    router.registerPage('rice.posts', spec('post.show', '/post/:slug', true));
    assert.throws(() => router.registerPage('rice.other', spec('other.show', '/post/:name')), /路径冲突/);
  });
});
