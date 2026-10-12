/**
 * 命名扩展点注册表：声明 → 贡献 → 生效裁决 → 异常隔离 → 零残留。
 *
 * 为什么这些断言值得存在：
 * - "谁的贡献最终生效"是所有插件协作的公共契约，一旦口径漂移，
 *   表现为"我贡献了但没显示 / 显示了两个面板"这类很难归因的问题；
 * - `replaceable: false` 与提供方自身 replace 的关系是本轮刚修的内核行为
 *   （见下方回归用例），它决定了"声明不可替换"会不会误伤声明者自己；
 * - 停用插件后必须**零残留**，否则"禁用插件 = 界面恢复默认"这条承诺不成立。
 *
 * 日志用假日志器收集：注册表刻意用"只告警不拒绝"表达若干宽容行为，
 * 判断它到底告警没有，只能拿到日志本身（打印到 stdout 的日志抓不住）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCode, isRiceNoteError } from '@ricenote/shared';
import { CORE_PROVIDER, ExtensionRegistry, type Logger } from '@ricenote/core';

interface RecordedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

/** 假日志器：记录每条日志，child() 返回同一份记录（bindings 与本用例无关）。 */
function recordingLogger(): { logger: Logger; records: RecordedLog[] } {
  const records: RecordedLog[] = [];
  const make = (): Logger => ({
    debug: (message, meta) => void records.push({ level: 'debug', message, ...(meta ? { meta } : {}) }),
    info: (message, meta) => void records.push({ level: 'info', message, ...(meta ? { meta } : {}) }),
    warn: (message, meta) => void records.push({ level: 'warn', message, ...(meta ? { meta } : {}) }),
    error: (message, meta) => void records.push({ level: 'error', message, ...(meta ? { meta } : {}) }),
    child: () => make()
  });
  return { logger: make(), records };
}

function withLogs(): { registry: ExtensionRegistry; records: RecordedLog[] } {
  const { logger, records } = recordingLogger();
  return { registry: new ExtensionRegistry(logger), records };
}

/** 只取生效贡献的 payload 清单，便于与预期逐项比对。 */
function payloads(registry: ExtensionRegistry, point: string, scope: 'admin' | 'render' | 'server') {
  return registry.effective(point, scope).map((entry) => entry.payload);
}

describe('ExtensionRegistry：声明与追加贡献的生效口径', () => {
  it('按扩展点取生效贡献，order 大者在前（同序保持注册顺序）', () => {
    const { registry } = withLogs();
    registry.declare('rice.media', { name: 'rice.media.picker', scope: 'admin' });
    registry.contribute('rice.media', 'rice.media.picker', { from: 'low' }, { scope: 'admin', order: 1 });
    registry.contribute('rice.posts', 'rice.media.picker', { from: 'high' }, { scope: 'admin', order: 9 });
    registry.contribute('rice.pages', 'rice.media.picker', { from: 'same' }, { scope: 'admin', order: 1 });

    assert.deepEqual(payloads(registry, 'rice.media.picker', 'admin'), [
      { from: 'high' },
      { from: 'low' },
      { from: 'same' }
    ]);
    // 记录里带上提供方，后台与排错要靠它区分"谁声明了这个点"
    assert.equal(registry.effective('rice.media.picker', 'admin')[0]?.providerId, 'rice.media');
  });

  it('作用域互相隔离：admin 的生效集合不含 render 贡献', () => {
    const { registry } = withLogs();
    registry.declare('rice.media', { name: 'rice.media.picker', scope: 'admin' });
    registry.contribute('rice.media', 'rice.media.picker', 'admin-panel', { scope: 'admin' });
    registry.contribute('rice.theme', 'rice.media.picker', 'render-piece', { scope: 'render' });

    assert.deepEqual(payloads(registry, 'rice.media.picker', 'admin'), ['admin-panel']);
    assert.deepEqual(payloads(registry, 'rice.media.picker', 'render'), ['render-piece']);
  });

  it('Core 预置标准插槽始终存在；插件重复声明只告警、不改归属', () => {
    const { registry, records } = withLogs();
    const preset = registry.list().find((entry) => entry.point === 'post.comments');
    assert.equal(preset?.provider, CORE_PROVIDER);
    assert.equal(preset?.scope, 'render');

    // 驼峰段的标准插槽名必须被接受（theme-api 已对外承诺的命名）
    const dispose = registry.declare('rice.comments', { name: 'post.afterContent', scope: 'render' });
    assert.equal(records.filter((item) => item.level === 'warn').length, 1);
    assert.equal(
      registry.list().find((entry) => entry.point === 'post.afterContent')?.provider,
      CORE_PROVIDER
    );
    dispose();
  });

  it('同一扩展点被别的插件声明时抛 409（全局唯一）', () => {
    const { registry } = withLogs();
    registry.declare('rice.media', { name: 'rice.media.picker', scope: 'admin' });
    assert.throws(
      () => registry.declare('rice.other', { name: 'rice.media.picker', scope: 'admin' }),
      (error: unknown) => isRiceNoteError(error) && error.code === ErrorCode.VALIDATION_FAILED && error.status === 409
    );
  });

  it('非法扩展点名在声明与贡献两侧都被拒绝；标准插槽的驼峰名不误伤', () => {
    const { registry } = withLogs();
    assert.throws(
      () => registry.declare('rice.media', { name: 'rice', scope: 'admin' }),
      (error: unknown) => isRiceNoteError(error) && error.status === 400
    );
    assert.throws(
      () => registry.contribute('rice.media', 'rice media picker', 'x', { scope: 'admin' }),
      (error: unknown) => isRiceNoteError(error) && error.status === 400
    );
    // 未声明也能贡献（只告警），但名字必须合法
    assert.doesNotThrow(() => registry.contribute('rice.media', 'post.beforeContent', 'x'));
  });
});

describe('ExtensionRegistry：replace 裁决', () => {
  it('存在 replace 时追加贡献（哪怕 order 很大）也不生效，order 最大的 replace 胜出', () => {
    const { registry } = withLogs();
    registry.declare('rice.media', { name: 'rice.media.picker', scope: 'render' });
    registry.contribute('rice.media', 'rice.media.picker', { name: 'default' }, { scope: 'render' });
    registry.contribute('rice.decorate', 'rice.media.picker', { name: 'append' }, { scope: 'render', order: 100 });
    registry.contribute('rice.a', 'rice.media.picker', { name: 'replace-a' }, { scope: 'render', mode: 'replace', order: 1 });
    registry.contribute('rice.b', 'rice.media.picker', { name: 'replace-b' }, { scope: 'render', mode: 'replace', order: 2 });

    assert.deepEqual(payloads(registry, 'rice.media.picker', 'render'), [{ name: 'replace-b' }]);
    assert.equal(registry.hasReplace('rice.media.picker', 'render'), true);
  });

  it('同 order 的多个 replace：按 consumerId 取其一并告警（运行期不猜，validate 会判错）', () => {
    const { registry, records } = withLogs();
    registry.declare('rice.media', { name: 'rice.media.picker', scope: 'admin' });
    registry.contribute('rice.zeta', 'rice.media.picker', 'zeta', { scope: 'admin', mode: 'replace', order: 3 });
    registry.contribute('rice.alpha', 'rice.media.picker', 'alpha', { scope: 'admin', mode: 'replace', order: 3 });

    assert.deepEqual(payloads(registry, 'rice.media.picker', 'admin'), ['alpha']);
    const warn = records.find((item) => item.level === 'warn' && /同优先级/.test(item.message));
    assert.equal(warn?.meta?.winner, 'rice.alpha');
  });

  it('回归：replaceable: false 只拦第三方，提供方自己的 replace 必须被接受', () => {
    const { registry } = withLogs();
    registry.declare('rice.media', {
      name: 'rice.media.picker',
      scope: 'admin',
      replaceable: false
    });

    /*
     * 提供方贡献一份 replace 是它最自然的出厂形态：默认面板就是"默认内容"本身。
     * 若这里把提供方也拦下，`replaceable: false` 会被逼成"任何插件都能替换我的面板"，
     * 语义反而失真 —— 这是本轮修正的内核行为，必须锁住。
     */
    assert.doesNotThrow(() =>
      registry.contribute('rice.media', 'rice.media.picker', 'own-default-panel', {
        scope: 'admin',
        mode: 'replace'
      })
    );
    assert.deepEqual(payloads(registry, 'rice.media.picker', 'admin'), ['own-default-panel']);

    /* 第三方 replace 被拒：错误码/状态码/详情都要可辨识，否则调用方只能靠字符串匹配。 */
    assert.throws(
      () =>
        registry.contribute('rice.third', 'rice.media.picker', 'stolen-panel', {
          scope: 'admin',
          mode: 'replace'
        }),
      (error: unknown) => {
        assert.ok(isRiceNoteError(error));
        assert.equal(error.code, ErrorCode.VALIDATION_FAILED);
        assert.equal(error.status, 400);
        assert.deepEqual(error.details.providerId, 'rice.media');
        assert.match(error.message, /不可替换/);
        return true;
      }
    );
    // 被拒的贡献不得留下任何痕迹（否则"报错了但其实生效了"最难排查）
    assert.deepEqual(registry.contributionsOwnedBy('rice.third'), []);

    // replaceable 只针对 replace：第三方追加贡献照旧允许
    assert.doesNotThrow(() =>
      registry.contribute('rice.third', 'rice.media.picker', 'badge', { scope: 'admin', order: 5 })
    );
    assert.deepEqual(payloads(registry, 'rice.media.picker', 'admin'), ['own-default-panel']);
  });
});

describe('ExtensionRegistry：未声明扩展点与清理', () => {
  it('向未声明的扩展点贡献：只告警不拒绝（消费方可能先于提供方启动）', () => {
    const { registry, records } = withLogs();
    assert.doesNotThrow(() =>
      registry.contribute('rice.posts', 'rice.ghost.actions', 'x', { scope: 'admin' })
    );

    const warn = records.find((item) => item.level === 'warn');
    assert.match(warn?.message ?? '', /未声明/);
    assert.equal(warn?.meta?.point, 'rice.ghost.actions');
    // 告警不等于丢弃：贡献仍然登记，待提供方启动后即可生效
    assert.deepEqual(payloads(registry, 'rice.ghost.actions', 'admin'), ['x']);
  });

  it('按插件清理后零残留：声明与贡献都不再出现在 list() 与生效集合里', () => {
    const { registry } = withLogs();
    const disposeDeclare = registry.declare('rice.media', { name: 'rice.media.picker', scope: 'admin' });
    const disposeContribute = registry.contribute('rice.media', 'rice.media.picker', 'panel', { scope: 'admin' });

    assert.equal(registry.list().find((entry) => entry.point === 'rice.media.picker')?.contributions, 1);
    assert.deepEqual(registry.ownedBy('rice.media'), {
      declarations: ['rice.media.picker'],
      contributions: ['rice.media.picker']
    });

    disposeContribute();
    disposeDeclare();

    assert.equal(registry.list().find((entry) => entry.point === 'rice.media.picker'), undefined);
    assert.deepEqual(registry.effective('rice.media.picker', 'admin'), []);
    assert.deepEqual(registry.ownedBy('rice.media'), { declarations: [], contributions: [] });
    // 预置插槽不受清理影响（它们属于 core）
    assert.ok(registry.list().some((entry) => entry.provider === CORE_PROVIDER));
  });
});

describe('ExtensionRegistry：服务端钩子的异常隔离', () => {
  const ok = { name: 'ok', apply: (payload: Record<string, unknown>) => ({ ...payload, tag: true }) };
  const boom = {
    name: 'boom',
    apply: () => {
      throw new Error('boom');
    }
  };

  it('默认 abort：贡献抛错即上抛，不静默放过（数据不能被悄悄改坏）', async () => {
    const { registry, records } = withLogs();
    registry.declare('rice.hooks', { name: 'rice.posts.beforeSave', scope: 'server' });
    registry.contribute('rice.a', 'rice.posts.beforeSave', ok, { scope: 'server', order: 1 });
    registry.contribute('rice.b', 'rice.posts.beforeSave', boom, { scope: 'server', order: 2 });

    await assert.rejects(
      () => registry.apply('rice.posts.beforeSave', { value: 1 }),
      (error: unknown) => {
        assert.ok(isRiceNoteError(error));
        assert.equal(error.code, ErrorCode.VALIDATION_FAILED);
        assert.match(error.message, /执行失败/);
        return true;
      }
    );
    assert.ok(records.some((item) => item.level === 'error' && /abort/.test(item.message)));
  });

  it('显式 skip：跳过失败者并沿用上一版 payload', async () => {
    const { registry, records } = withLogs();
    registry.declare('rice.hooks', { name: 'rice.posts.beforeSave', scope: 'server' });
    registry.contribute('rice.a', 'rice.posts.beforeSave', ok, { scope: 'server', order: 1 });
    registry.contribute('rice.b', 'rice.posts.beforeSave', boom, { scope: 'server', order: 2 });

    const result = await registry.apply('rice.posts.beforeSave', { value: 1 }, { onError: 'skip' });
    assert.deepEqual(result, { value: 1, tag: true });
    assert.ok(records.some((item) => item.level === 'warn' && /跳过/.test(item.message)));
  });
});
