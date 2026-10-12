/**
 * 文章编辑页「标签输入」的纯逻辑（`plugins/official/posts/admin/tag-utils.js`）。
 *
 * 为什么值得锁：
 * - 归一化与查重口径决定"输入即创建"会不会**白撞服务端的 409**，也决定分类与标签
 *   同名时会不会选错对象（分类与标签共用一个 `termIds` 数组，选错类型用户看不出来）；
 * - `decideTagAction` 是权限门控的唯一判官：无 `taxonomy.manage` 时必须返回
 *   `forbidden` 而**绝不能**返回 `create` —— 否则前端会替无权限用户发写请求；
 * - 这些都是纯函数，可以在没有浏览器、没有 Vue 的情况下断言。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

interface TermSummary {
  id: number;
  name: string;
  type: 'category' | 'tag';
}

interface TagUtils {
  normalizeTagName(name: unknown): string;
  findExistingTag(tags: TermSummary[] | undefined, name: unknown): TermSummary | null;
  decideTagAction(input: { text: string; tags: TermSummary[]; canCreate: boolean }):
    | 'empty'
    | 'select'
    | 'create'
    | 'forbidden';
  isDuplicateTermError(error: unknown): boolean;
}

let cached: Promise<TagUtils> | undefined;
function load(): Promise<TagUtils> {
  /*
   * 用 URL 动态导入而不写相对说明符：这是插件目录下的**纯 ESM .js**（零构建、无类型），
   * 不在本测试包的 `include` 里；动态导入才能既跑真实实现、又不把它纳入本包类型检查。
   */
  cached ??= import(
    new URL('../../plugins/official/posts/admin/tag-utils.js', import.meta.url).href
  ) as Promise<TagUtils>;
  return cached;
}

/** 一个分类与两个标签；分类的名字故意与"命中已有"用例里的标签区分开。 */
const TERMS: TermSummary[] = [
  { id: 1, name: '架构', type: 'category' },
  { id: 2, name: 'Vue.js', type: 'tag' },
  { id: 3, name: '部署', type: 'tag' }
];

describe('normalizeTagName：去首尾空白 + 大小写折叠', () => {
  it('裁剪首尾空白并折叠大小写（只用于比较，不改变展示/落库的原始大小写）', async () => {
    const { normalizeTagName } = await load();
    assert.equal(normalizeTagName('  Vue.JS  '), 'vue.js');
    assert.equal(normalizeTagName('Vue.JS'), 'vue.js');
  });

  it('空白输入归一化为空串，供调用方判定"空输入"', async () => {
    const { normalizeTagName } = await load();
    assert.equal(normalizeTagName('   '), '');
    assert.equal(normalizeTagName(''), '');
    assert.equal(normalizeTagName(undefined), '');
    assert.equal(normalizeTagName(null), '');
  });
});

describe('findExistingTag：只认标签，忽略空白与大小写', () => {
  it('按名称命中已有标签（忽略首尾空白与大小写）', async () => {
    const { findExistingTag } = await load();
    assert.equal(findExistingTag(TERMS, '  vue.JS  ')?.id, 2);
  });

  /*
   * 这条是"忽略分类"的核心：同名分类必须**不**命中，否则会选中错误类型的词条，
   * 而表单提交的是分类/标签共用的 termIds，用户在界面上很难发现。
   */
  it('分类同名也不命中；只有真正的标签才命中', async () => {
    const { findExistingTag } = await load();
    assert.equal(findExistingTag(TERMS, '架构'), null);

    const withTag = [...TERMS, { id: 9, name: ' 架构 ', type: 'tag' } as TermSummary];
    assert.equal(findExistingTag(withTag, '架构')?.id, 9);
  });

  it('空输入或列表缺省时返回 null（调用方据此走"创建/无权限"分支）', async () => {
    const { findExistingTag } = await load();
    assert.equal(findExistingTag(TERMS, '   '), null);
    assert.equal(findExistingTag(undefined, 'Vue.js'), null);
    assert.equal(findExistingTag(TERMS, '不存在'), null);
  });
});

describe('decideTagAction：回车该执行的动作（四态）', () => {
  it('有权限：空输入 empty、命中已有 select、未命中 create', async () => {
    const { decideTagAction } = await load();
    assert.equal(decideTagAction({ text: '   ', tags: TERMS, canCreate: true }), 'empty');
    assert.equal(decideTagAction({ text: '部署', tags: TERMS, canCreate: true }), 'select');
    assert.equal(decideTagAction({ text: '全新标签', tags: TERMS, canCreate: true }), 'create');
  });

  it('命中已有不受权限影响：无权限也照样 select', async () => {
    const { decideTagAction } = await load();
    assert.equal(decideTagAction({ text: '  Vue.js ', tags: TERMS, canCreate: false }), 'select');
  });
});

describe('两条边界：空输入不创建、无权限不创建', () => {
  it('空输入（含全空白）永远不触发创建，即使有权限', async () => {
    const { decideTagAction } = await load();
    assert.equal(decideTagAction({ text: '', tags: [], canCreate: true }), 'empty');
    assert.equal(decideTagAction({ text: '    ', tags: TERMS, canCreate: true }), 'empty');
  });

  it('无 taxonomy.manage 时未命中只能 forbidden，绝不会是 create', async () => {
    const { decideTagAction } = await load();
    const action = decideTagAction({ text: '全新标签', tags: TERMS, canCreate: false });
    assert.equal(action, 'forbidden');
    assert.notEqual(action, 'create');
  });
});

describe('isDuplicateTermError：只认 409（重名回退的判据）', () => {
  it('409 视为"重名"：前端据此重拉列表并选中已有一条，而不是当作失败', async () => {
    const { isDuplicateTermError } = await load();
    assert.equal(isDuplicateTermError({ status: 409 }), true);
  });

  it('其它错误与空值不算重名：必须走 toast 报错，不能被静默吞掉', async () => {
    const { isDuplicateTermError } = await load();
    assert.equal(isDuplicateTermError({ status: 500 }), false);
    assert.equal(isDuplicateTermError(new Error('网络错误')), false);
    assert.equal(isDuplicateTermError(null), false);
    assert.equal(isDuplicateTermError(undefined), false);
  });
});
