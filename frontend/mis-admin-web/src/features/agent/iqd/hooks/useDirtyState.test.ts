/**
 * useDirtyState.test.ts — 脏标记与幂等键的**纯函数**单测（T03b）。
 *
 * <p>两处失败都是**静默**的：
 * <ul>
 *   <li>{@link buildIdempotencyKey}：模板写错（少一段、多一个空格）不会报错 —— 服务端按
 *       `(connection_id, idempotency_key)` 精确去重，形近的 key 只是「幂等失效」，
 *       表现为「重复提交产生了两次编辑」；</li>
 *   <li>{@link shallowEqualDraft}：判错会导致「没改却提示未保存」或「改了却不提示」，
 *       两种都属 UX 静默缺陷。</li>
 * </ul>
 */
import { describe, expect, it } from 'vitest';
import { buildIdempotencyKey, shallowEqualDraft } from './useDirtyState';

describe('buildIdempotencyKey（§8.4 模板 {connId}:{kind}:{action}:{uuid}）', () => {
  it('按模板拼接（注入 uuid 便于断言）', () => {
    expect(buildIdempotencyKey(7, 'relationship', 'create', 'uuid-1')).toBe(
      '7:relationship:create:uuid-1',
    );
  });

  it('cube / 计算列 两个调用点同模板', () => {
    expect(buildIdempotencyKey(12, 'cube', 'create', 'u')).toBe('12:cube:create:u');
    expect(buildIdempotencyKey(12, 'column', 'create', 'u')).toBe('12:column:create:u');
  });

  it('无连接上下文时用 none 前缀（不留空段，避免 key 形如 ::create:x）', () => {
    expect(buildIdempotencyKey(null, 'relationship', 'create', 'u')).toBe(
      'none:relationship:create:u',
    );
    expect(buildIdempotencyKey(undefined, 'relationship', 'create', 'u')).toBe(
      'none:relationship:create:u',
    );
  });

  it('默认 uuid 非空且每次不同（否则「改完再保存」会命中旧 key 拿到首次结果）', () => {
    const a = buildIdempotencyKey(1, 'relationship', 'create');
    const b = buildIdempotencyKey(1, 'relationship', 'create');
    expect(a).not.toBe(b);
    expect(a.split(':')[3]).toBeTruthy();
  });
});

describe('shallowEqualDraft（草稿 vs 基线）', () => {
  it('同值（顺序无关）→ 不脏', () => {
    expect(shallowEqualDraft({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toBe(true);
  });

  it('值不同 → 脏', () => {
    expect(shallowEqualDraft({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqualDraft({ a: '1' }, { a: 1 })).toBe(false);
  });

  it('undefined 与「缺失」等价（表单清空留 undefined 不算改动）', () => {
    expect(shallowEqualDraft({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it('一边有值另一边缺失 → 脏', () => {
    expect(shallowEqualDraft({ a: 1, b: 'x' }, { a: 1 })).toBe(false);
  });

  it('空对象等价', () => {
    expect(shallowEqualDraft({}, {})).toBe(true);
  });
});
