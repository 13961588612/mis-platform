/**
 * instructionUtils.test.ts — 指令下发页纯逻辑单测（T04d / MR-07 回归守卫）。
 *
 * <p>钉住三处**静默失效**：`@` 插入的游标计算、`related_item_keys` 的

 * JSON 序列化/解析、下发条数估算口径。
 */
import { describe, expect, it } from 'vitest';
import type { IqdCatalogItem, IqdKnowledge } from '@/lib/api/iqd';
import {
  INSTRUCTION_PERMISSIONS,
  RELATED_KINDS,
  buildItemKeyOptions,
  describeLastPush,
  detectAtToken,
  estimatePush,
  filterItemKeyOptions,
  insertItemKey,
  parseRelatedItemKeys,
  serializeRelatedItemKeys,
  syncStatusLabel,
} from './instructionUtils';

function cat(partial: Partial<IqdCatalogItem> & { item_key: string; kind: string }): IqdCatalogItem {
  return partial as IqdCatalogItem;
}

function kn(partial: Partial<IqdKnowledge>): IqdKnowledge {
  return partial as IqdKnowledge;
}

describe('权限码（核实自 sys_api ⋈ sys_menu_api seed）', () => {
  it('逐条钉住（V74:92581/92582/92583、V81:92588/92589）', () => {
    expect(INSTRUCTION_PERMISSIONS.view).toBe('iqd:enhance:view');
    expect(INSTRUCTION_PERMISSIONS.save).toBe('iqd:enhance:save');
    expect(INSTRUCTION_PERMISSIONS.sync).toBe('iqd:enhance:sync');
  });

  it('关联对象候选限定 model / cube', () => {
    expect([...RELATED_KINDS]).toEqual(['model', 'cube']);
  });
});

describe('buildItemKeyOptions', () => {
  const catalog = [
    cat({ item_key: 'pg.public.orders.amount', kind: 'column' }),
    cat({ item_key: 'mdl:model:orders', kind: 'model', display_name: '订单' }),
    cat({ item_key: 'mdl:cube:revenue', kind: 'cube', display_name: '营收' }),
    cat({ item_key: 'mdl:relationship:o_c', kind: 'relationship' }),
  ];

  it('按 kind 过滤（关联对象 = model/cube）', () => {
    const options = buildItemKeyOptions(catalog, RELATED_KINDS);
    expect(options.map((o) => o.value)).toEqual(['mdl:cube:revenue', 'mdl:model:orders']);
    expect(options.find((o) => o.value === 'mdl:model:orders')?.label).toBe('订单');
  });

  it('不传 kinds → 全量；按 item_key 升序稳定排序', () => {
    const options = buildItemKeyOptions(catalog);
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.value)).toEqual([
      'mdl:cube:revenue',
      'mdl:model:orders',
      'mdl:relationship:o_c',
      'pg.public.orders.amount',
    ]);
  });

  it('label 缺省回退 item_key', () => {
    const options = buildItemKeyOptions(catalog, ['column']);
    expect(options[0].label).toBe('pg.public.orders.amount');
  });
});

describe('detectAtToken / insertItemKey（@ 插入）', () => {
  it('行首 @ 起始的 token', () => {
    expect(detectAtToken('@ord', 4)).toEqual({ start: 0, query: 'ord' });
  });

  it('空白后的 @', () => {
    // '仅允许 @ord' 共 8 字符，光标在 'ord' 之后（index 8）
    expect(detectAtToken('仅允许 @ord', 8)).toEqual({ start: 4, query: 'ord' });
  });

  it('中间含空白 → 不算 token（已结束）', () => {
    expect(detectAtToken('@ord 说明', 7)).toBeNull();
  });

  it('非空白前缀（a@b）→ 不触发', () => {
    expect(detectAtToken('a@b', 3)).toBeNull();
  });

  it('无 @ / 越界 → null', () => {
    expect(detectAtToken('普通内容', 4)).toBeNull();
    expect(detectAtToken('@x', 5)).toBeNull();
  });

  it('★ insertItemKey 替换 @query 且光标落在插入值之后', () => {
    // 光标在 'ord' 之后（index 8）→ 用 key 替换 [4, 8) 的 '@ord'
    const out = insertItemKey('仅允许 @ord 展示', 8, 'mdl:model:orders');
    expect(out.content).toBe('仅允许 mdl:model:orders 展示');
    expect(out.caret).toBe('仅允许 '.length + 'mdl:model:orders'.length);
  });

  it('无触发词时在光标处插入（不吞内容）', () => {
    const out = insertItemKey('ab', 1, 'X');
    expect(out.content).toBe('aXb');
    expect(out.caret).toBe(2);
  });
});

describe('filterItemKeyOptions', () => {
  const options = [
    { value: 'mdl:model:orders', label: '订单', kind: 'model' },
    { value: 'mdl:cube:revenue', label: '营收', kind: 'cube' },
  ];

  it('空 query → 前 limit 条；命中 value 或 label（大小写不敏感）', () => {
    expect(filterItemKeyOptions(options, '')).toHaveLength(2);
    expect(filterItemKeyOptions(options, 'REVE')).toHaveLength(1);
    expect(filterItemKeyOptions(options, '订单')).toHaveLength(1);
    expect(filterItemKeyOptions(options, 'nope')).toHaveLength(0);
  });
});

describe('parseRelatedItemKeys / serializeRelatedItemKeys', () => {
  it('字符串 JSON 数组 ⇄ 解析（去空白、去空项）', () => {
    expect(parseRelatedItemKeys('["a"," b ",""]')).toEqual(['a', 'b']);
    expect(parseRelatedItemKeys('')).toEqual([]);
    expect(parseRelatedItemKeys(null)).toEqual([]);
    expect(parseRelatedItemKeys(undefined)).toEqual([]);
  });

  it('非法 JSON / 非数组 → []（fail-safe：视作无关联）', () => {
    expect(parseRelatedItemKeys('not-json')).toEqual([]);
    expect(parseRelatedItemKeys('{"a":1}')).toEqual([]);
  });

  it('序列化：空 → null；否则去重后的 JSON 字符串数组', () => {
    expect(serializeRelatedItemKeys([])).toBeNull();
    expect(serializeRelatedItemKeys(['  ', ''])).toBeNull();
    expect(serializeRelatedItemKeys(['b', 'a', 'b'])).toBe('["b","a"]');
  });

  it('往返一致', () => {
    const keys = ['mdl:model:orders', 'mdl:cube:revenue'];
    expect(parseRelatedItemKeys(serializeRelatedItemKeys(keys))).toEqual(keys);
  });
});

describe('estimatePush（下发条数估算）', () => {
  it('仅统计启用中的指令；拆分 通用 / 作用域', () => {
    const estimate = estimatePush([
      kn({ enabled: true, related_item_keys: null }),
      kn({ enabled: true, related_item_keys: '["mdl:model:orders"]' }),
      kn({ enabled: true, related_item_keys: '["mdl:cube:revenue"]' }),
      kn({ enabled: true, related_item_keys: '[]' }), // 空关联 = 通用
      kn({ enabled: false, related_item_keys: null }), // 停用 → 不计
    ]);
    expect(estimate).toEqual({ total: 4, global: 2, scoped: 2 });
  });

  it('全部无关联 → global = total', () => {
    expect(estimatePush([kn({ enabled: true, related_item_keys: null })])).toEqual({
      total: 1,
      global: 1,
      scoped: 0,
    });
  });

  it('空列表 → 全 0', () => {
    expect(estimatePush([])).toEqual({ total: 0, global: 0, scoped: 0 });
  });
});

describe('syncStatusLabel / describeLastPush（下发前展示「上次下发状态」）', () => {
  it('已知状态给中文；空/未知各归其位', () => {
    expect(syncStatusLabel('success')).toBe('成功');
    expect(syncStatusLabel('failed')).toBe('失败');
    expect(syncStatusLabel('weird')).toBe('weird');
    expect(syncStatusLabel(null)).toBe('—');
  });

  it('无作业 → 尚未下发', () => {
    expect(describeLastPush(null)).toBe('尚未下发');
  });

  it('有作业 → 构建/索引/回填知识摘要', () => {
    const text = describeLastPush({
      build_status: 'success',
      index_status: 'failed',
      synced_knowledge_count: 3,
    });
    expect(text).toContain('构建 成功');
    expect(text).toContain('索引 失败');
    expect(text).toContain('回填知识 3 条');
  });
});
