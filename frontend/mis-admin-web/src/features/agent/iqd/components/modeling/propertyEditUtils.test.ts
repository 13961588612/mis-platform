/**
 * propertyEditUtils.test.ts — 右栏字段编辑纯函数单测（T04b / MR-09 + MR-13 回归守卫）。
 *
 * <p>钉住三处**静默失效**：
 * <ol>
 *   <li>{@link buildNodeEditPayload} 的 `base_revision` + `idempotency_key`：少带 → 乐观并发/幂等静默失效；</li>
 *   <li>{@link buildMaskRulePayload} 的 `match_type`/`pattern`/规则名口径：与增强页不一致 → 「同源同优先级」静默偏离；</li>
 *   <li>{@link describeNodeEditError} 的码分流：只读 message 会丢掉 `data.current_edit_revision` / `data.field`。</li>
 * </ol>
 */
import { describe, expect, it } from 'vitest';
import {
  FIELD_MATCH_TYPE,
  MASK_RULE_OPTIONS,
  MASK_SAVE_PERMISSION,
  NODE_EDIT_PERMISSION,
  SENSITIVE_LEVEL_OPTIONS,
  buildMaskRulePayload,
  buildNodeEditPayload,
  describeMaskSaveError,
  describeNodeEditError,
  fieldNameOf,
  initialMaskRule,
  keyTail,
  maskRuleLabel,
} from './propertyEditUtils';

describe('权限码（改动即失败：写错 = 前端放行、后端 40300）', () => {
  it('描述走 PUT /catalog/node → iqd:catalog:edit（V81:41/62）', () => {
    expect(NODE_EDIT_PERMISSION).toBe('iqd:catalog:edit');
  });

  it('脱敏走 mask-rule API → iqd:mask:save（V73:74/106）', () => {
    expect(MASK_SAVE_PERMISSION).toBe('iqd:mask:save');
  });
});

describe('下拉口径（与增强页脱敏 Tab / 后端内置规则同源）', () => {
  it('五类内置 + custom（共 6 项，顺序固定）', () => {
    expect(MASK_RULE_OPTIONS.map((option) => option.value)).toEqual([
      'phone',
      'idcard',
      'email',
      'amount',
      'full',
      'custom',
    ]);
  });

  it('敏感等级 none/low/high', () => {
    expect(SENSITIVE_LEVEL_OPTIONS.map((option) => option.value)).toEqual(['none', 'low', 'high']);
  });

  it('initialMaskRule：命中内置则回填，未知值回退 full（绝不把未知串塞进下拉）', () => {
    expect(initialMaskRule('phone')).toBe('phone');
    expect(initialMaskRule('custom')).toBe('custom');
    expect(initialMaskRule('legacy_rule_v0')).toBe('full');
    expect(initialMaskRule(null)).toBe('full');
    expect(initialMaskRule(undefined)).toBe('full');
  });

  it('maskRuleLabel：已知值给中文，未知值原样', () => {
    expect(maskRuleLabel('phone')).toBe('手机号');
    expect(maskRuleLabel('weird')).toBe('weird');
  });
});

describe('keyTail / fieldNameOf', () => {
  it('点号在冒号之后取点号，否则取冒号', () => {
    expect(keyTail('pg.public.orders.amount')).toBe('amount');
    expect(keyTail('mdl:model:orders')).toBe('orders');
    expect(keyTail('mdl:measure:rev.total')).toBe('total');
    expect(keyTail('a')).toBe('a');
    expect(keyTail('')).toBe('');
    expect(keyTail(null)).toBe('');
  });

  it('fieldNameOf：display_name 优先，回退 item_key 末段', () => {
    expect(fieldNameOf({ item_key: 'pg.public.orders.amount', display_name: '金额' })).toBe('金额');
    expect(fieldNameOf({ item_key: 'pg.public.orders.amount', display_name: '  ' })).toBe('amount');
    expect(fieldNameOf({ item_key: 'pg.public.orders.amount', display_name: null })).toBe('amount');
  });
});

describe('buildNodeEditPayload（MR-09：严格对齐 PUT /catalog/node）', () => {
  it('★ 恒带 base_revision + idempotency_key（乐观并发 + 幂等不可丢）', () => {
    const payload = buildNodeEditPayload(
      { item_key: 'pg.public.orders.amount', kind: 'column' },
      '订单金额',
      7,
      'k-1',
    );
    expect(payload).toEqual({
      item_key: 'pg.public.orders.amount',
      kind: 'column',
      patch: { description: '订单金额' },
      base_revision: 7,
      idempotency_key: 'k-1',
    });
  });

  it('空 / 纯空白描述 → patch.description = null（清空语义）', () => {
    expect(
      buildNodeEditPayload({ item_key: 'c', kind: 'column' }, '   ', 0, 'k').patch.description,
    ).toBeNull();
    expect(
      buildNodeEditPayload({ item_key: 'c', kind: 'column' }, '', 0, 'k').patch.description,
    ).toBeNull();
  });

  it('只带 description（不得顺手夹带 display_name/expression —— 那会误触改名引用校验）', () => {
    const payload = buildNodeEditPayload({ item_key: 'c', kind: 'column' }, 'x', 1, 'k');
    expect(Object.keys(payload.patch)).toEqual(['description']);
  });
});

describe('buildMaskRulePayload（MR-13 / A-01：复用 mask-rule API）', () => {
  it('★ 规则名 = pattern = 列名（同列反复保存落到同一条规则，后端按 name 幂等 upsert）', () => {
    const payload = buildMaskRulePayload('phone', 'phone', '');
    expect(payload).toEqual({
      name: 'phone',
      match_type: FIELD_MATCH_TYPE,
      pattern: 'phone',
      rule: 'phone',
      replacement: null,
      priority: 0,
      enabled: true,
    });
    expect(FIELD_MATCH_TYPE).toBe('column_name');
  });

  it('仅 custom 带替换值；内建规则即便填了替换值也置 null', () => {
    expect(buildMaskRulePayload('c', 'custom', '****').replacement).toBe('****');
    expect(buildMaskRulePayload('c', 'custom', '   ').replacement).toBeNull();
    expect(buildMaskRulePayload('c', 'full', 'ignored').replacement).toBeNull();
  });
});

describe('describeNodeEditError（逐码读 data 明细）', () => {
  it('40900 → 带 current_edit_revision', () => {
    expect(describeNodeEditError(40900, { current_edit_revision: 13 }, 'x')).toContain('13');
  });

  it('40901 → 幂等键重复提示', () => {
    expect(describeNodeEditError(40901, null, 'x')).toContain('幂等键');
  });

  it('42200 → 带 field / model_item_key', () => {
    const message = describeNodeEditError(
      42200,
      { field: 'item_key', model_item_key: 'mdl:model:ghost' },
      '参数非法',
    );
    expect(message).toContain('item_key');
    expect(message).toContain('mdl:model:ghost');
  });

  it('40300 / 50300 / 未知码 / 无码', () => {
    expect(describeNodeEditError(40300, null, 'x')).toContain('mdl_writeback_enabled');
    expect(describeNodeEditError(50300, null, 'x')).toContain('建设中');
    expect(describeNodeEditError(50000, null, '系统错误')).toBe('[50000] 系统错误');
    expect(describeNodeEditError(null, null, '网络错误')).toBe('网络错误');
  });
});

describe('describeMaskSaveError', () => {
  it('各码给出可操作提示', () => {
    expect(describeMaskSaveError(40900, { current_edit_revision: 9 }, 'x')).toContain('9');
    expect(describeMaskSaveError(40901, null, 'x')).toContain('幂等键');
    expect(describeMaskSaveError(42200, { field: 'name' }, 'x')).toContain('name');
    expect(describeMaskSaveError(40300, null, 'x')).toContain('权限');
    expect(describeMaskSaveError(50300, null, 'x')).toContain('建设中');
    // mask-rule API 失败多为 plain Error（无 code）→ 原样 message
    expect(describeMaskSaveError(null, null, '保存脱敏规则失败')).toBe('保存脱敏规则失败');
  });
});
