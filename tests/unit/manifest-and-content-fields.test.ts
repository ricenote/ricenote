/**
 * 插件/主题清单（JSON Schema）里「扩展点 + 贡献 + 内容字段」的形状约束。
 *
 * 为什么值得锁：清单里的非法形状（未知 scope、非法 mode、入口不在白名单、
 * select 缺 options）如果漏到运行期，表现是"贡献悄悄不生效 / 控件填不进值"，
 * 排查要翻日志与源码；ajv 这里是第一道闸，也是插件作者唯一能立刻看到错误的地方。
 *
 * 字段**值**的校验与本地化 DTO 在 `content-fields-values.test.ts`。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createManifestValidator } from '@ricenote/shared';

type Issues = { path: string; message: string; keyword?: string }[];

/** 断言存在一条指定 keyword 的问题（path 可选，用于区分同类问题出现在哪个字段上）。 */
function hasIssue(issues: Issues, keyword: string, path?: string): boolean {
  return issues.some((issue) => issue.keyword === keyword && (path === undefined || issue.path === path));
}

const validator = createManifestValidator();

function pluginManifest(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'rice.demo',
    name: '示例插件',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    entry: './dist/index.js',
    ...patch
  };
}

function themeManifest(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'rice.minimal',
    name: '极简主题',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    engine: 'nunjucks',
    templates: { home: 'index.njk', post: 'post.njk', page: 'page.njk' },
    ...patch
  };
}

describe('插件清单 schema：扩展点与贡献', () => {
  it('合法声明与贡献通过校验', () => {
    const result = validator.validatePlugin(
      pluginManifest({
        capabilities: ['extensions:declare', 'extensions:contribute'],
        extensionPoints: [
          {
            name: 'rice.demo.card',
            scope: 'admin',
            replaceable: false,
            description: '卡片挂载点',
            props: [{ name: 'value', description: '当前值' }]
          }
        ],
        contributions: [
          {
            point: 'rice.demo.card',
            scope: 'admin',
            mode: 'replace',
            order: 1,
            entry: './admin/main.js',
            style: './admin/main.css',
            permission: 'demo.edit',
            label: '卡片'
          }
        ]
      })
    );

    assert.equal(result.valid, true, result.issues.map((issue) => issue.message).join('; '));
  });

  it('未知 scope 被拒绝（声明与贡献两侧）', () => {
    const declared = validator.validatePlugin(
      pluginManifest({ extensionPoints: [{ name: 'rice.demo.card', scope: 'frontend' }] })
    );
    assert.equal(declared.valid, false);
    assert.ok(hasIssue(declared.issues, 'enum', '/extensionPoints/0/scope'));

    const contributed = validator.validatePlugin(
      pluginManifest({ contributions: [{ point: 'rice.demo.card', scope: 'web', entry: './admin/main.js' }] })
    );
    assert.equal(contributed.valid, false);
    assert.ok(hasIssue(contributed.issues, 'enum', '/contributions/0/scope'));
  });

  it('非法 mode 被拒绝（只认 append / replace）', () => {
    const result = validator.validatePlugin(
      pluginManifest({
        contributions: [{ point: 'rice.demo.card', scope: 'admin', entry: './admin/main.js', mode: 'override' }]
      })
    );

    assert.equal(result.valid, false);
    assert.ok(hasIssue(result.issues, 'enum', '/contributions/0/mode'));
  });

  it('贡献入口/style 必须落在白名单目录内（入口限 ./admin|x/dist，样式限 ./admin/*.css）', () => {
    const result = validator.validatePlugin(
      pluginManifest({
        contributions: [
          // 入口正则只允许 ./admin/*.js 与 ./dist/*.js，其余一律拒绝
          { point: 'rice.demo.card', scope: 'admin', entry: './src/legacy.js' },
          { point: 'rice.demo.card', scope: 'admin', entry: './admin/main.js', style: './dist/theme.css' }
        ]
      })
    );

    assert.equal(result.valid, false);
    assert.ok(hasIssue(result.issues, 'pattern', '/contributions/0/entry'));
    assert.ok(hasIssue(result.issues, 'pattern', '/contributions/1/style'));
  });

  it('贡献缺 entry、扩展点名非法、props 项缺说明都被拒绝', () => {
    const missingEntry = validator.validatePlugin(
      pluginManifest({ contributions: [{ point: 'rice.demo.card', scope: 'admin' }] })
    );
    assert.equal(missingEntry.valid, false);
    assert.ok(missingEntry.issues.some((issue) => issue.keyword === 'required' && /entry/.test(issue.message)));

    const badName = validator.validatePlugin(
      pluginManifest({ extensionPoints: [{ name: 'rice demo card', scope: 'admin' }] })
    );
    assert.equal(badName.valid, false);
    assert.ok(hasIssue(badName.issues, 'pattern', '/extensionPoints/0/name'));

    const bareProp = validator.validatePlugin(
      pluginManifest({ extensionPoints: [{ name: 'rice.demo.card', scope: 'admin', props: [{ name: 'value' }] }] })
    );
    assert.equal(bareProp.valid, false);
    assert.ok(bareProp.issues.some((issue) => issue.keyword === 'required'));
  });
});

describe('主题清单 schema：contentFields', () => {
  it('合法的 contentFields 通过校验', () => {
    const result = validator.validateTheme(
      themeManifest({
        contentFields: {
          featuredImage: { type: 'image', label: { 'zh-CN': '特色图片', en: 'Featured image' } },
          summary: { type: 'textarea', label: '摘要', maxLength: 200 },
          layout: { type: 'select', label: '布局', options: [{ label: '宽屏', value: 'wide' }] }
        }
      })
    );

    assert.equal(result.valid, true, result.issues.map((issue) => issue.message).join('; '));
  });

  it('未知字段类型被拒绝', () => {
    const result = validator.validateTheme(
      themeManifest({ contentFields: { summary: { type: 'richtext', label: '摘要' } } })
    );

    assert.equal(result.valid, false);
    assert.ok(hasIssue(result.issues, 'enum', '/contentFields/summary/type'));
  });

  it('缺 label 被拒绝（后台没有可展示的控件标题）', () => {
    const result = validator.validateTheme(
      themeManifest({ contentFields: { featuredImage: { type: 'image' } } })
    );

    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.keyword === 'required' && /label/.test(issue.message)));
  });

  it('select 缺 options 被拒绝（否则是个填不进值的下拉框）', () => {
    const result = validator.validateTheme(
      themeManifest({ contentFields: { layout: { type: 'select', label: '布局' } } })
    );

    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.keyword === 'required' && /options/.test(issue.message)));
  });

  it('字段名不符合命名规则被拒绝', () => {
    const result = validator.validateTheme(
      themeManifest({ contentFields: { 'Featured-Image': { type: 'image', label: '特色图片' } } })
    );

    assert.equal(result.valid, false);
    assert.ok(hasIssue(result.issues, 'propertyNames'));
  });
});
