import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  capabilityMatches,
  topologicalSort,
  buildCapabilityIndex,
  resolveDependencies,
  findDependents,
  type LoadedPlugin
} from '@ricenote/core';
import { findProvider, isCapability, parseCapability, satisfiesRange } from '@ricenote/shared';

describe('capability 契约解析', () => {
  it('解析 capability 契约的名称与主版本', () => {
    const parsed = parseCapability('content.posts@1');
    assert.equal(parsed.name, 'content.posts');
    assert.equal(parsed.major, 1);
  });

  it('拒绝非法格式', () => {
    assert.throws(() => parseCapability('content.posts'));
    assert.throws(() => parseCapability('content.posts@'));
    assert.equal(isCapability('content.posts'), false);
    assert.equal(isCapability('content.posts@1'), true);
  });

  it('按契约名与主版本查找提供者', () => {
    const provided = [
      { pluginId: 'rice.posts', raw: 'content.posts@1', ref: parseCapability('content.posts@1') },
      { pluginId: 'rice.media', raw: 'media.library@1', ref: parseCapability('media.library@1') }
    ];
    assert.equal(findProvider(provided, 'content.posts@1')?.pluginId, 'rice.posts');
    assert.equal(findProvider(provided, 'content.posts@2'), undefined);
  });

  it('semver 区间匹配', () => {
    assert.equal(satisfiesRange('1.2.3', '^1.0.0'), true);
    assert.equal(satisfiesRange('2.0.0', '^1.0.0'), false);
    assert.throws(() => satisfiesRange('1.0.0', 'not-a-range'));
  });
});

describe('capabilityMatches（主题 has_feature 的短名支持）', () => {
  const capabilities = ['content.posts@1', 'identity.auth@1'];

  it('支持完整契约、全名与短名', () => {
    assert.equal(capabilityMatches(capabilities, 'content.posts@1'), true);
    assert.equal(capabilityMatches(capabilities, 'content.posts'), true);
    assert.equal(capabilityMatches(capabilities, 'posts'), true);
    assert.equal(capabilityMatches(capabilities, 'comments'), false);
  });

  it('短名不会误匹配到前缀相同的其他域', () => {
    assert.equal(capabilityMatches(['content.posts@1'], 'post'), false);
  });
});

/* ---------------------- 依赖解析 ---------------------- */

function plugin(
  id: string,
  options: { version?: string; provides?: string[]; requires?: Record<string, string>; apiVersion?: string } = {}
): LoadedPlugin {
  return {
    manifest: {
      schemaVersion: 1,
      id,
      name: id,
      version: options.version ?? '1.0.0',
      apiVersion: options.apiVersion ?? '^1.0.0',
      entry: './dist/index.js',
      ...(options.provides ? { provides: options.provides } : {}),
      ...(options.requires ? { requires: options.requires } : {})
    },
    dir: `/tmp/${id}`,
    entryPath: `/tmp/${id}/dist/index.js`,
    builtin: true
  };
}

describe('依赖解析与拓扑排序', () => {
  it('按声明依赖排序：提供者先于消费者', () => {
    const candidates = [
      plugin('rice.posts', { requires: { 'identity.users@1': '^1.0.0' } }),
      plugin('rice.identity', { provides: ['identity.users@1'] })
    ];
    const result = resolveDependencies(candidates, new Set(['rice.posts', 'rice.identity']), '1.0.0');

    assert.deepEqual(result.problems, []);
    assert.equal(result.order[0]?.manifest.id, 'rice.identity');
    assert.equal(result.order[1]?.manifest.id, 'rice.posts');
  });

  it('缺少能力提供者时报告 missing', () => {
    const candidates = [plugin('rice.posts', { requires: { 'content.taxonomy@1': '^1.0.0' } })];
    const result = resolveDependencies(candidates, new Set(['rice.posts']), '1.0.0');

    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0]?.kind, 'missing');
  });

  it('版本不满足区间时报告 version', () => {
    const candidates = [
      plugin('rice.posts', { requires: { 'identity.users@1': '^2.0.0' } }),
      plugin('rice.identity', { version: '1.5.0', provides: ['identity.users@1'] })
    ];
    const result = resolveDependencies(candidates, new Set(['rice.posts', 'rice.identity']), '1.0.0');

    assert.equal(result.problems[0]?.kind, 'version');
  });

  it('插件声明了不兼容的 API 版本时报告 apiVersion', () => {
    const candidates = [plugin('rice.legacy', { apiVersion: '^2.0.0' })];
    const result = resolveDependencies(candidates, new Set(['rice.legacy']), '1.0.0');

    assert.equal(result.problems[0]?.kind, 'apiVersion');
  });

  it('检测循环依赖', () => {
    const { cycles } = topologicalSort(
      ['a', 'b'],
      [
        { from: 'a', to: 'b', key: 'b' },
        { from: 'b', to: 'a', key: 'a' }
      ]
    );
    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0], ['a', 'b']);
  });

  it('禁用被依赖插件时报告 missing 并列出依赖者', () => {
    const candidates = [
      plugin('rice.identity', { provides: ['identity.users@1'] }),
      plugin('rice.posts', { requires: { 'identity.users@1': '^1.0.0' } })
    ];
    const result = resolveDependencies(candidates, new Set(['rice.posts']), '1.0.0');

    assert.equal(result.problems[0]?.kind, 'missing');
    assert.deepEqual(findDependents(candidates, 'rice.identity'), ['rice.posts']);
  });

  it('capability 索引按插件聚合', () => {
    const index = buildCapabilityIndex([
      plugin('rice.posts', { provides: ['content.posts@1'] }),
      plugin('rice.taxonomy', { provides: ['content.taxonomy@1'] })
    ]);
    assert.equal(index.length, 2);
    assert.deepEqual(index.map((item) => item.pluginId).sort(), ['rice.posts', 'rice.taxonomy']);
  });
});
