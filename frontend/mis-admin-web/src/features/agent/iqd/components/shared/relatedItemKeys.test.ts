/**
 * relatedItemKeys.test.ts — `related_item_keys` wire 编解码单测（T04e 抽共享后）。
 *
 * <p>（`components/instruction/instructionUtils.test.ts` 仍通过再导出覆盖同一实现；
 * 本文件是共享模块自身的最小回归守卫。）
 */
import { describe, expect, it } from 'vitest';
import {
  parseRelatedItemKeys,
  serializeRelatedItemKeys,
  summarizeRelatedItemKeys,
} from './relatedItemKeys';

describe('parseRelatedItemKeys（容错）', () => {
  it('JSON 字符串数组 → 去空白去空项', () => {
    expect(parseRelatedItemKeys('["a"," b ",""]')).toEqual(['a', 'b']);
  });

  it('空 / null / undefined → []', () => {
    expect(parseRelatedItemKeys('')).toEqual([]);
    expect(parseRelatedItemKeys('   ')).toEqual([]);
    expect(parseRelatedItemKeys(null)).toEqual([]);
    expect(parseRelatedItemKeys(undefined)).toEqual([]);
  });

  it('非法 JSON / 非数组 / 非字符串 → []（fail-safe：视作无关联）', () => {
    expect(parseRelatedItemKeys('not-json')).toEqual([]);
    expect(parseRelatedItemKeys('{"a":1}')).toEqual([]);
    expect(parseRelatedItemKeys(123)).toEqual([]);
    expect(parseRelatedItemKeys('"just-a-string"')).toEqual([]);
  });

  it('已解析的数组（兜底形态）', () => {
    expect(parseRelatedItemKeys(['a', ' b ', ''])).toEqual(['a', 'b']);
  });
});

describe('serializeRelatedItemKeys', () => {
  it('空 → null；否则去重后 JSON 字符串数组', () => {
    expect(serializeRelatedItemKeys([])).toBeNull();
    expect(serializeRelatedItemKeys(['  ', ''])).toBeNull();
    expect(serializeRelatedItemKeys(['b', 'a', 'b'])).toBe('["b","a"]');
  });

  it('往返一致', () => {
    const keys = ['mdl:model:orders', 'mdl:cube:revenue'];
    expect(parseRelatedItemKeys(serializeRelatedItemKeys(keys))).toEqual(keys);
  });
});

describe('summarizeRelatedItemKeys（列表「关联对象」列）', () => {
  it('无关联 → isGlobal', () => {
    expect(summarizeRelatedItemKeys(null)).toEqual({ keys: [], count: 0, isGlobal: true });
    expect(summarizeRelatedItemKeys('[]')).toEqual({ keys: [], count: 0, isGlobal: true });
  });

  it('有关联 → count + keys', () => {
    const summary = summarizeRelatedItemKeys('["mdl:model:orders","mdl:cube:revenue"]');
    expect(summary.count).toBe(2);
    expect(summary.isGlobal).toBe(false);
    expect(summary.keys).toEqual(['mdl:model:orders', 'mdl:cube:revenue']);
  });
});
