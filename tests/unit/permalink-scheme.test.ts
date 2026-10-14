/**
 * 「固定链接」方案层与文章侧地址逻辑的单元测试。
 *
 * 只测纯逻辑（不连数据库、不起内核），但压着的都是会直接影响线上地址的性质：
 * - **第三方贡献是不可信输入**：非法方案/参数只告警跳过，绝不能拖垮内置三类；
 * - **绝不产出坏链接**：第三方参数取不到值时回退默认模板，缺参则返回 undefined；
 * - **同一内容只有一个地址**：`.html` 后缀、补零的月日、分类必须与内容实际一致；
 * - **未启用插件时零行为变化**：没有 `permalink.routes@1` 时必须退回 `/post/:slug`。
 *
 * 端到端（改设置 → 重启 → 新路径生效）见 integration 目录。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PERMALINK_SCHEME_IDS,
  PERMALINK_UNCATEGORIZED_SEGMENT,
  SERVICE_CONTRACTS,
  type PermalinkRoutesService,
  type PermalinkSchemeDeclaration,
  type PermalinkTokenDeclaration
} from '@ricenote/shared';
import type { PluginLogger } from '@ricenote/plugin-sdk';
import { BUILTIN_SCHEMES } from '@ricenote/plugin-permalink/dist/config.js';
import {
  collectSchemes,
  collectTokens,
  previewScheme,
  reservedTokenNames,
  resolveScheme,
  tokensForScheme,
  validateSchemeTemplate
} from '@ricenote/plugin-permalink/dist/scheme.js';
import { createPermalinkService } from '@ricenote/plugin-permalink/dist/service.js';
import {
  matchesPostLookup,
  postUrl,
  readPostLookup,
  type PostLookup
} from '@ricenote/plugin-posts/dist/permalink.js';
import type { PostsRuntime } from '@ricenote/plugin-posts/dist/runtime.js';
import type { PostRow } from '@ricenote/plugin-posts/dist/repository.js';

/* ------------------------------ 测试替身 ------------------------------ */

function stubLogger(warnings: string[] = []): PluginLogger {
  const logger = {
    warn: (message: string) => {
      warnings.push(message);
    },
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => logger
  };
  return logger as unknown as PluginLogger;
}

function declarationOf(id: string): PermalinkSchemeDeclaration {
  const found = BUILTIN_SCHEMES.find((scheme) => scheme.id === id);
  assert.ok(found, `缺少内置方案：${id}`);
  return found;
}

function buildScheme(
  input: {
    id?: string;
    storedTemplate?: string;
    tokens?: PermalinkTokenDeclaration[];
    declaration?: PermalinkSchemeDeclaration;
  } = {}
) {
  const declaration = input.declaration ?? declarationOf(input.id ?? PERMALINK_SCHEME_IDS.POST);
  const tokens = input.tokens ?? [];
  return resolveScheme({
    declaration,
    tokens,
    ...(input.storedTemplate === undefined ? {} : { storedTemplate: input.storedTemplate }),
    logger: stubLogger()
  });
}

/** 只实现 `services.tryUse` 的最小运行时（其余字段本文件用不到）。 */
function runtimeWith(service?: PermalinkRoutesService): PostsRuntime {
  return {
    services: {
      tryUse: (name: string) => (name === SERVICE_CONTRACTS.PERMALINK ? service : undefined)
    }
  } as unknown as PostsRuntime;
}

function serviceOf(
  scheme: ReturnType<typeof buildScheme>,
  tokens: PermalinkTokenDeclaration[] = []
): PermalinkRoutesService {
  return createPermalinkService({
    schemes: () => [scheme],
    tokens: () => tokens,
    logger: stubLogger()
  });
}

/* --------------------------- 内置方案与默认值 --------------------------- */

describe('内置方案：默认模板与未启用插件时保持一致', () => {
  it('三类方案的默认模板与路由名固定，装了不改设置时站点地址不变', () => {
    const expected = [
      { id: PERMALINK_SCHEME_IDS.POST, route: 'post.show', pattern: '/post/:slug' },
      { id: PERMALINK_SCHEME_IDS.PAGE, route: 'page.show', pattern: '/page/:slug' },
      { id: PERMALINK_SCHEME_IDS.CATEGORY, route: 'term.category', pattern: '/category/:slug' }
    ];

    for (const item of expected) {
      const scheme = buildScheme({ id: item.id });
      assert.equal(scheme.routeName, item.route);
      assert.equal(scheme.template, scheme.defaultTemplate);
      assert.equal(scheme.compiled.routePattern, item.pattern);
    }
  });

  it('文章方案提供预设风格，且每个预设自身都是合法模板', () => {
    const post = declarationOf(PERMALINK_SCHEME_IDS.POST);
    assert.ok((post.presets ?? []).length >= 5, '文章方案应提供预设风格');
    for (const preset of post.presets ?? []) {
      const checked = validateSchemeTemplate(post, [], preset.template);
      assert.equal(checked.valid, true, `预设不合法：${preset.template}`);
    }
  });
});

/* ------------------------------ 模板校验 ------------------------------ */

describe('validateSchemeTemplate：按方案参数校验', () => {
  it('文章方案接受全部已声明参数，拒绝未声明参数', () => {
    const post = declarationOf(PERMALINK_SCHEME_IDS.POST);
    for (const template of [
      '/archives/{cid}/',
      '/archives/{slug}.html',
      '/{year}/{month}/{day}/{slug}.html',
      '/{category}/{slug}.html',
      '/{year}/{month}/{day}/{slug}'
    ]) {
      assert.equal(validateSchemeTemplate(post, [], template).valid, true, template);
    }
    // {directory} 本期不提供；{mid} 属于分类方案
    assert.equal(validateSchemeTemplate(post, [], '/{directory}/{slug}').valid, false);
    assert.equal(validateSchemeTemplate(post, [], '/{mid}/{slug}').valid, false);
  });

  it('分类方案接受 {mid}，页面方案不接受 {category}', () => {
    assert.equal(
      validateSchemeTemplate(declarationOf(PERMALINK_SCHEME_IDS.CATEGORY), [], '/c/{mid}/').valid,
      true
    );
    assert.equal(
      validateSchemeTemplate(declarationOf(PERMALINK_SCHEME_IDS.PAGE), [], '/{category}').valid,
      false
    );
  });
});

/* --------------------------- 第三方贡献的收敛 --------------------------- */

describe('collectSchemes：第三方方案是不可信输入', () => {
  it('合法方案被接受，非法方案只告警', () => {
    const warnings: string[] = [];
    const accepted = collectSchemes(
      [
        ...BUILTIN_SCHEMES,
        {
          id: 'product',
          label: '商品路径',
          routeName: 'shop.product',
          tokens: [{ name: 'sku', label: '商品编码' }],
          defaultTemplate: '/product/{sku}',
          sample: { sku: 'rn-0001' }
        },
        // 方案标识不合法
        { ...declarationOf(PERMALINK_SCHEME_IDS.POST), id: 'Bad-ID' },
        // 缺少要接管的路由名
        { ...declarationOf(PERMALINK_SCHEME_IDS.POST), id: 'noroute', routeName: '' },
        // 参数名不合法
        {
          ...declarationOf(PERMALINK_SCHEME_IDS.POST),
          id: 'badtoken',
          tokens: [{ name: 'Bad', label: 'x' }]
        },
        // 与内置方案标识重复
        { ...declarationOf(PERMALINK_SCHEME_IDS.POST) }
      ],
      stubLogger(warnings)
    );

    const ids = accepted.map((scheme) => scheme.id);
    assert.deepEqual(ids, ['post', 'page', 'category', 'product']);
    assert.equal(warnings.length, 4);
  });
});

describe('collectTokens：第三方参数', () => {
  const reserved = reservedTokenNames(BUILTIN_SCHEMES);

  it('接受合法参数，拒绝重名与缺少取值来源的', () => {
    const warnings: string[] = [];
    const accepted = collectTokens(
      [
        { token: 'lang', label: '语言', resolve: () => 'zh' },
        { token: 'slug', label: '撞名', resolve: () => 'x' },
        { token: 'NotLower', label: '非法名', resolve: () => 'x' },
        { token: 'nofn', label: '缺取值' } as unknown as PermalinkTokenDeclaration,
        { token: 'badtmatch', label: '坏校验', resolve: () => 'x', match: 1 as never }
      ],
      reserved,
      stubLogger(warnings)
    );

    assert.deepEqual(accepted.map((token) => token.token), ['lang']);
    assert.equal(warnings.length, 4);
  });

  it('第三方参数出现在方案可用参数里，并标注来源', () => {
    const tokens: PermalinkTokenDeclaration[] = [
      { token: 'lang', label: '语言', source: 'rice.multilang', resolve: () => 'zh' }
    ];
    const list = tokensForScheme(declarationOf(PERMALINK_SCHEME_IDS.PAGE), tokens);
    const names = list.map((token) => token.name);
    assert.deepEqual(names, ['cid', 'slug', 'lang']);
    assert.equal(list.find((token) => token.name === 'lang')?.source, 'rice.multilang');
  });
});

/* ------------------------------ 编译与回退 ------------------------------ */

describe('resolveScheme：失效模板回退默认', () => {
  it('库里的模板用了已不存在的参数时回退默认模板并告警', () => {
    const warnings: string[] = [];
    const scheme = resolveScheme({
      declaration: declarationOf(PERMALINK_SCHEME_IDS.PAGE),
      tokens: [],
      storedTemplate: '/{lang}/{slug}', // 提供 {lang} 的插件已被停用
      logger: stubLogger(warnings)
    });

    assert.equal(scheme.template, '/page/{slug}');
    assert.equal(scheme.compiled.routePattern, '/page/:slug');
    assert.equal(warnings.length, 1);
  });
});

/* ------------------------------ 服务行为 ------------------------------ */

describe('PermalinkRoutesService：生成与命中', () => {
  it('按配置模板生成（含尾斜杠与 .html 后缀）', () => {
    const service = serviceOf(
      buildScheme({ storedTemplate: '/archives/{cid}/', declaration: declarationOf('post') })
    );
    assert.equal(service.build(PERMALINK_SCHEME_IDS.POST, { cid: 12 }), '/archives/12/');
    assert.equal(service.template(PERMALINK_SCHEME_IDS.POST), '/archives/{cid}/');
    assert.equal(service.uses(PERMALINK_SCHEME_IDS.POST, 'cid'), true);
    assert.equal(service.uses(PERMALINK_SCHEME_IDS.POST, 'slug'), false);
  });

  it('未知方案返回 undefined（调用方据此回退内建默认）', () => {
    const service = serviceOf(buildScheme());
    assert.equal(service.build('nope', { slug: 'a' }), undefined);
    assert.equal(service.template('nope'), undefined);
    assert.deepEqual(service.tokens('nope'), []);
  });

  it('第三方参数由贡献方取值，命中时执行其校验', () => {
    const token: PermalinkTokenDeclaration = {
      token: 'lang',
      label: '语言',
      resolve: () => 'zh',
      match: ({ value }) => value === 'zh'
    };
    const scheme = buildScheme({ storedTemplate: '/{lang}/post/{slug}', tokens: [token] });
    const service = serviceOf(scheme, [token]);

    assert.equal(service.build(PERMALINK_SCHEME_IDS.POST, { slug: 'a' }), '/zh/post/a');
    assert.deepEqual(service.extract(PERMALINK_SCHEME_IDS.POST, { lang: 'zh', slug: 'a' }), {
      lang: 'zh',
      slug: 'a'
    });
    // 语言不在白名单 → 判 404，避免同一文章出现多个语言地址
    assert.equal(service.extract(PERMALINK_SCHEME_IDS.POST, { lang: 'fr', slug: 'a' }), undefined);
  });

  it('第三方参数取不到值时回退方案默认模板，不产出坏链接', () => {
    const token: PermalinkTokenDeclaration = { token: 'lang', label: '语言', resolve: () => undefined };
    const scheme = buildScheme({ storedTemplate: '/{lang}/post/{slug}', tokens: [token] });
    const service = serviceOf(scheme, [token]);

    assert.equal(service.build(PERMALINK_SCHEME_IDS.POST, { slug: 'a' }), '/post/a');
  });

  it('第三方参数抛错时同样回退，不影响其它调用', () => {
    const token: PermalinkTokenDeclaration = {
      token: 'lang',
      label: '语言',
      resolve: () => {
        throw new Error('boom');
      }
    };
    const scheme = buildScheme({ storedTemplate: '/{lang}/post/{slug}', tokens: [token] });
    const service = serviceOf(scheme, [token]);
    assert.equal(service.build(PERMALINK_SCHEME_IDS.POST, { slug: 'a' }), '/post/a');
  });

  it('返回的方案视图含模板、默认模板、预设与参数', () => {
    const service = serviceOf(buildScheme({ storedTemplate: '/archives/{cid}/' }));
    const [scheme] = service.schemes();
    assert.equal(scheme?.id, PERMALINK_SCHEME_IDS.POST);
    assert.equal(scheme?.template, '/archives/{cid}/');
    assert.equal(scheme?.defaultTemplate, '/post/{slug}');
    assert.ok((scheme?.presets.length ?? 0) > 0);
  });
});

describe('previewScheme：后台实时预览', () => {
  it('合法模板给出示例地址', () => {
    const result = previewScheme({
      declaration: declarationOf(PERMALINK_SCHEME_IDS.POST),
      tokens: [],
      template: '/{year}/{month}/{day}/{slug}'
    });
    assert.equal(result.valid, true);
    assert.equal(result.path, '/2026/10/14/hello-world');
  });

  it('非法模板给出原因而不是半个地址', () => {
    const result = previewScheme({
      declaration: declarationOf(PERMALINK_SCHEME_IDS.POST),
      tokens: [],
      // 一个参数都没有 + 用了本期不提供的 {directory}
      template: '/archives/{directory}/'
    });
    assert.equal(result.valid, false);
    assert.equal(result.path, undefined);
    assert.ok(result.issues.length > 0);
  });

  it('第三方参数取不到值时如实说明"暂不可预览"', () => {
    const token: PermalinkTokenDeclaration = { token: 'lang', label: '语言', resolve: () => undefined };
    const result = previewScheme({
      declaration: declarationOf(PERMALINK_SCHEME_IDS.POST),
      tokens: [token],
      template: '/{lang}/post/{slug}'
    });
    assert.equal(result.valid, false);
    assert.match(result.issues[0]?.message ?? '', /\{lang\}/);
  });
});

/* ---------------------------- 文章侧地址逻辑 ---------------------------- */

describe('posts.postUrl：生成文章地址', () => {
  const published = new Date(2026, 2, 5, 9, 30); // 2026-03-05（本地时区）

  it('未启用固定链接插件时回退内建 /post/:slug', () => {
    assert.equal(postUrl(runtimeWith(), { id: 1, slug: 'hello' }), '/post/hello');
  });

  it('按配置模板生成，月/日补零为两位', () => {
    const scheme = buildScheme({ storedTemplate: '/{year}/{month}/{day}/{slug}' });
    const runtime = runtimeWith(serviceOf(scheme));
    assert.equal(
      postUrl(runtime, { id: 1, slug: 'hello', publishedAt: published }),
      '/2026/03/05/hello'
    );
  });

  it('{category} 取最早的分类；没有分类时用固定兜底段', () => {
    const scheme = buildScheme({
      storedTemplate: '/{category}/{slug}.html',
      declaration: declarationOf(PERMALINK_SCHEME_IDS.POST)
    });
    const runtime = runtimeWith(serviceOf(scheme));

    assert.equal(
      postUrl(runtime, {
        id: 1,
        slug: 'hello',
        categories: [
          { id: 7, slug: 'notes' },
          { id: 3, slug: 'tech' }
        ]
      }),
      '/tech/hello.html'
    );
    assert.equal(
      postUrl(runtime, { id: 1, slug: 'hello', categories: [] }),
      `/${PERMALINK_UNCATEGORIZED_SEGMENT}/hello.html`
    );
  });

  it('模板要求的取值缺失时回退内建路径', () => {
    const scheme = buildScheme({ storedTemplate: '/{year}/{month}/{day}/{slug}' });
    const runtime = runtimeWith(serviceOf(scheme));
    // 没有发布时间 → 无法拼出 {year} 等，回退而不是抛错
    assert.equal(postUrl(runtime, { id: 1, slug: 'hello' }), '/post/hello');
  });
});

describe('posts 命中解析：同一内容只有一个地址', () => {
  function rowWith(publishedAt: Date): PostRow {
    return { published_at: publishedAt } as unknown as PostRow;
  }

  it('未启用插件时按 slug 命中', () => {
    const lookup = readPostLookup(runtimeWith(), { slug: 'hello' });
    assert.deepEqual(lookup, { bySlug: 'hello' });
  });

  it('.html 后缀缺失时判为不命中', () => {
    const scheme = buildScheme({ storedTemplate: '/archives/{slug}.html' });
    const runtime = runtimeWith(serviceOf(scheme));
    assert.equal(readPostLookup(runtime, { slug: 'hello' }), undefined);
    assert.deepEqual(readPostLookup(runtime, { slug: 'hello.html' }), { bySlug: 'hello' });
  });

  it('{cid} 模板按 ID 命中并保留 ID', () => {
    const scheme = buildScheme({ storedTemplate: '/archives/{cid}/' });
    const lookup = readPostLookup(runtimeWith(serviceOf(scheme)), { cid: '12' });
    assert.deepEqual(lookup, { byId: 12 });
  });

  it('年月日必须与发布时间完全一致（含补零形态）', () => {
    const scheme = buildScheme({ storedTemplate: '/{year}/{month}/{day}/{slug}.html' });
    const runtime = runtimeWith(serviceOf(scheme));
    const row = rowWith(new Date(2026, 2, 5, 9, 30)); // 2026-03-05

    const ok = readPostLookup(runtime, { year: '2026', month: '03', day: '05', slug: 'a.html' });
    assert.ok(ok);
    assert.equal(matchesPostLookup(ok, row, []), true);

    // 不补零的写法不构成第二个可访问地址
    const unpadded = readPostLookup(runtime, { year: '2026', month: '3', day: '5', slug: 'a.html' });
    assert.ok(unpadded);
    assert.equal(matchesPostLookup(unpadded, row, []), false);

    const wrongDay = readPostLookup(runtime, { year: '2026', month: '03', day: '06', slug: 'a.html' });
    assert.ok(wrongDay);
    assert.equal(matchesPostLookup(wrongDay, row, []), false);
  });

  it('分类必须与文章实际所属分类一致', () => {
    const scheme = buildScheme({ storedTemplate: '/{category}/{slug}.html' });
    const runtime = runtimeWith(serviceOf(scheme));
    const row = rowWith(new Date(2026, 2, 5));
    const categories = [
      { id: 3, slug: 'tech' },
      { id: 9, slug: 'notes' }
    ];

    const ok = readPostLookup(runtime, { category: 'tech', slug: 'a.html' });
    assert.ok(ok);
    assert.equal(matchesPostLookup(ok, row, categories), true);

    // 非主分类、以及"无分类"的文章都不接受
    const secondary = readPostLookup(runtime, { category: 'notes', slug: 'a.html' });
    assert.ok(secondary);
    assert.equal(matchesPostLookup(secondary, row, categories), false);

    const fallback = readPostLookup(runtime, {
      category: PERMALINK_UNCATEGORIZED_SEGMENT,
      slug: 'a.html'
    });
    assert.ok(fallback);
    assert.equal(matchesPostLookup(fallback, row, categories), false);
    assert.equal(matchesPostLookup(fallback, row, []), true);
  });

  it('既无 ID 也无缩略名的地址判为不合法', () => {
    const scheme = buildScheme({ storedTemplate: '/archives/{year}/' });
    const lookup: PostLookup | undefined = readPostLookup(
      runtimeWith(serviceOf(scheme)),
      { year: '2026' }
    );
    assert.equal(lookup, undefined);
  });
});
