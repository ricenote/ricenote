/**
 * 命名扩展点的**静态校验**（`pnpm validate` 的口径）。
 *
 * 为什么单独一份：运行期注册表刻意对"未声明的扩展点"只告警不拒绝
 * （插件启停顺序不确定），因此拼写错误、跨插件冲突、能力漏声明只能靠
 * "部署前的那道闸"发现 —— 它是这些规则唯一的存在处，必须被测试覆盖。
 *
 * 覆盖：能力声明、作用域入口白名单、入口文件存在、style/permission 仅 admin、
 * 以及"同一扩展点上多个 replace 且 order 相同"这种无法裁决的冲突。
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

interface ValidateIssue {
  path: string;
  message: string;
  keyword?: string;
}

interface ValidateReport {
  ok: boolean;
  plugin: { invalid: { dir: string; issues: ValidateIssue[] }[] };
}

interface ValidateModule {
  validateProject(options: {
    rootDir: string;
    pluginsDirs: string[];
    themesDir: string;
  }): ValidateReport;
}

/**
 * 直接按源码路径加载：`pnpm validate` 的实现位于 apps/server，
 * 而该包的 dist 可能落后于源码（本轮新增的扩展点校验就只在源码里）。
 * 静态校验要锁的是**当前规则**，因此这里不走 dist。
 */
let validateModule: Promise<ValidateModule> | undefined;
function loadValidate(): Promise<ValidateModule> {
  validateModule ??= import(
    new URL('../../apps/server/src/cli/validate.ts', import.meta.url).href
  ) as Promise<ValidateModule>;
  return validateModule;
}

describe('静态校验：入口白名单、入口缺失、能力未声明、replace 冲突', () => {
  it('跨插件的这些错误必须在部署前被拦下', async () => {
    const { validateProject } = await loadValidate();
    const root = mkdtempSync(path.join(tmpdir(), 'rn-ext-validate-'));
    const pluginsDir = path.join(root, 'plugins');

    const writePlugin = (id: string, manifest: Record<string, unknown>, files: string[]): string => {
      const dir = path.join(pluginsDir, id);
      mkdirSync(path.join(dir, 'dist'), { recursive: true });
      mkdirSync(path.join(dir, 'admin'), { recursive: true });
      writeFileSync(path.join(dir, 'dist', 'index.js'), 'export default {};');
      for (const file of files) writeFileSync(path.join(dir, file), '');
      writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          id,
          name: id,
          version: '1.0.0',
          apiVersion: '^1.0.0',
          entry: './dist/index.js',
          ...manifest
        })
      );
      return dir;
    };

    try {
      // 干净样本：用来证明"没有这些问题时不会误报"
      const cleanDir = writePlugin(
        'rice.clean',
        {
          capabilities: ['extensions:declare', 'extensions:contribute'],
          extensionPoints: [{ name: 'rice.clean.card', scope: 'admin' }],
          contributions: [{ point: 'rice.clean.card', scope: 'admin', entry: './admin/main.js' }]
        },
        ['admin/main.js']
      );

      writePlugin(
        'rice.alpha',
        {
          capabilities: ['extensions:declare', 'extensions:contribute'],
          extensionPoints: [{ name: 'rice.alpha.card', scope: 'admin' }],
          contributions: [
            { point: 'rice.alpha.card', scope: 'admin', entry: './admin/main.js', mode: 'replace', order: 5 },
            /*
             * 作用域白名单：清单 Schema 只认 `./admin|x/dist/*.js` 两种前缀，
             * "哪个作用域必须配哪个前缀"由 validate 按作用域判定（admin 限 ./admin/）。
             * 这一条能过 Schema，因此只有静态校验拦得住它。
             */
            { point: 'rice.alpha.card', scope: 'admin', entry: './dist/legacy.js' },
            // 产物不存在（忘了 build 或路径写错）；style 只允许出现在 admin 作用域
            { point: 'rice.alpha.card', scope: 'render', entry: './dist/missing.js', style: './admin/x.css' }
          ]
        },
        ['admin/main.js']
      );

      writePlugin(
        'rice.beta',
        {
          capabilities: ['extensions:contribute'],
          contributions: [
            // 与 rice.alpha 同在 rice.alpha.card 的 order=5 上 replace：无法裁决
            { point: 'rice.alpha.card', scope: 'admin', entry: './admin/main.js', mode: 'replace', order: 5 }
          ]
        },
        ['admin/main.js']
      );

      writePlugin(
        'rice.gamma',
        {
          // 声明了扩展点/贡献却没有任何能力：运行期会被 FORBIDDEN，必须在 CI 拦住
          extensionPoints: [{ name: 'rice.gamma.card', scope: 'admin' }],
          contributions: [{ point: 'rice.gamma.card', scope: 'admin', entry: './admin/main.js' }]
        },
        ['admin/main.js']
      );

      const report = validateProject({
        rootDir: root,
        pluginsDirs: [pluginsDir],
        themesDir: path.join(root, 'themes')
      });
      const issues = report.plugin.invalid
        .filter((item) => item.dir !== cleanDir)
        .flatMap((item) => item.issues.map((issue) => `${issue.path} ${issue.message}`));
      const text = issues.join('\n');

      assert.equal(report.ok, false);
      assert.equal(report.plugin.invalid.some((item) => item.dir === cleanDir), false);
      assert.match(text, /未声明能力 extensions:declare/);
      assert.match(text, /未声明能力 extensions:contribute/);
      assert.match(text, /入口必须位于 \.\/admin\//);
      assert.match(text, /贡献入口不存在/);
      assert.match(text, /style 仅 admin 作用域可用/);
      assert.match(text, /无法确定胜出者/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
