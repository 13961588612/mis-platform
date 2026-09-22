/**
 * propertyEditUtils.test.ts — 右栏字段编辑纯函数单测（T04b / T04b-补：MR-09 + MR-13 回归守卫）。
 *
 * <p>钉住静默失效点：
 * <ol>
 *   <li>{@link buildNodeEditPayload} / {@link buildMaskNodeEditPayload} 的
 *       `base_revision` + `idempotency_key`：少带 → 乐观并发/幂等静默失效；</li>
 *   <li>{@link buildMaskNodeEditPayload} 的 patch 键与清除语义（`mask_rule=''` → `null`）：写错 → 脱敏无法撤销；</li>
 *   <li>下拉口径（五类内置 + custom）与 {@link describeNodeEditError} 的码分流。</li>
 * </ol>
 */
import { describe, expect, it } from 'vitest';
import {
  MASK_RULE_CLEAR_VALUE,
  MASK_RULE_FIELD_OPTIONS,
  MASK_RULE_OPTIONS,
  MASK_SAVE_PERMISSION,
  NODE_EDIT_PERMISSION,
  SENSITIVE_LEVEL_OPTIONS,
  buildMaskNodeEditPayload,
  buildMaskRuleOptions,
  buildNodeEditPayload,
  describeMaskSaveError,
  describeNodeEditError,
  fieldNameOf,
  initialMaskRule,
  keyTail,
  maskRuleLabel,
} from './propertyEditUtils';

describe('权限码（改动即失败：写错 = 前端放行、后端 40300）', () => {
  it('描述 + 脱敏均走 PUT /catalog/node → iqd:catalog:edit（V81:41/62）', () => {
    expect(NODE_EDIT_PERMISSION).toBe('iqd:catalog:edit');
  });

  it('脱敏附加闸门 → iqd:mask:save（V73:74/106；PRD MR-13）', () => {
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

  it('字段级下拉 = 清除项 + 内置 6 项（清除项在首位）', () => {
    expect(MASK_RULE_FIELD_OPTIONS).toHaveLength(7);
    expect(MASK_RULE_FIELD_OPTIONS[0].value).toBe(MASK_RULE_CLEAR_VALUE);
    expect(MASK_RULE_CLEAR_VALUE).toBe('');
  });

  it('敏感等级 none/low/high', () => {
    expect(SENSITIVE_LEVEL_OPTIONS.map((option) => option.value)).toEqual(['none', 'low', 'high']);
  });

  it('initialMaskRule：原样保留（trim），绝不静默改写未知历史值', () => {
    expect(initialMaskRule('phone')).toBe('phone');
    expect(initialMaskRule('  high ')).toBe('high');
    expect(initialMaskRule('legacy_rule_v0')).toBe('legacy_rule_v0');
    expect(initialMaskRule(null)).toBe('');
    expect(initialMaskRule(undefined)).toBe('');
  });

  it('buildMaskRuleOptions：已知/空 → 标准 7 项；未知值 → 追加「现有」动态项', () => {
    expect(buildMaskRuleOptions('')).toHaveLength(7);
    expect(buildMaskRuleOptions('phone')).toHaveLength(7);
    const withLegacy = buildMaskRuleOptions('legacy_rule_v0');
    expect(withLegacy).toHaveLength(8);
    expect(withLegacy[7]).toEqual({ value: 'legacy_rule_v0', label: 'legacy_rule_v0（现有）' });
  });

  it('maskRuleLabel：清除项给「无」，已知给中文，未知原样', () => {
    expect(maskRuleLabel(MASK_RULE_CLEAR_VALUE)).toBe('无');
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

  it('只带 description（不得顺手夹带 display_name —— 那会误触改名引用校验）', () => {
    const payload = buildNodeEditPayload({ item_key: 'c', kind: 'column' }, 'x', 1, 'k');
    expect(Object.keys(payload.patch)).toEqual(['description']);
  });
});

describe('buildMaskNodeEditPayload（MR-13 / T04b-补：脱敏走同一 PUT /catalog/node）', () => {
  it('★ patch 带 sensitive_level + mask_rule，并恒带 base_revision + idempotency_key', () => {
    const payload = buildMaskNodeEditPayload(
      { item_key: 'pg.public.orders.phone', kind: 'column' },
      'high',
      'phone',
      12,
      'k-mask',
    );
    expect(payload).toEqual({
      item_key: 'pg.public.orders.phone',
      kind: 'column',
      patch: { sensitive_level: 'high', mask_rule: 'phone' },
      base_revision: 12,
      idempotency_key: 'k-mask',
    });
  });

  it('★ 清除项（mask_rule=""）→ patch.mask_rule = null（撤回字段级显式规则）', () => {
    const payload = buildMaskNodeEditPayload({ item_key: 'c', kind: 'column' }, 'low', '', 1, 'k');
    expect(payload.patch.mask_rule).toBeNull();
    expect(payload.patch.sensitive_level).toBe('low');
  });

  it('mask_rule 去空白；sensitive_level trim + 小写归一，空 → none', () => {
    expect(
      buildMaskNodeEditPayload({ item_key: 'c', kind: 'column' }, '  HIGH ', '  phone ', 1, 'k').patch,
    ).toEqual({ sensitive_level: 'high', mask_rule: 'phone' });
    expect(
      buildMaskNodeEditPayload({ item_key: 'c', kind: 'column' }, '', 'full', 1, 'k').patch
        .sensitive_level,
    ).toBe('none');
  });

  it('只带 sensitive_level + mask_rule 两键（不夹带 description，避免描述被误写）', () => {
    const payload = buildMaskNodeEditPayload({ item_key: 'c', kind: 'column' }, 'none', '', 1, 'k');
    expect(Object.keys(payload.patch).sort()).toEqual(['mask_rule', 'sensitive_level']);
  });
});

describe('describeNodeEditError（逐码读 data 明细）', () => {
  it('40900 → 带 current_edit_revision', () => {
    expect(describeNodeEditError(40900, { current_edit_revision: 13 }, 'x')).toContain('13');
  });

  it('40901 → 幂等键重复提示', () => {
    expect(describeNodeEditError(40901, null, 'x')).toContain('幂等键');
  });

  it('42200 → 带 field / model_item_key（含非法 sensitive_level 的 data.field）', () => {
    const message = describeNodeEditError(
      42200,
      { field: 'sensitive_level' },
      'sensitive_level 只接受 none / low / high',
    );
    expect(message).toContain('sensitive_level');
    expect(describeNodeEditError(42200, { model_item_key: 'mdl:model:ghost' }, 'x')).toContain(
      'mdl:model:ghost',
    );
  });

  it('40300 / 50300 / 未知码 / 无码', () => {
    expect(describeNodeEditError(40300, null, 'x')).toContain('mdl_writeback_enabled');
    expect(describeNodeEditError(50300, null, 'x')).toContain('建设中');
    expect(describeNodeEditError(50000, null, '系统错误')).toBe('[50000] 系统错误');
    expect(describeNodeEditError(null, null, '网络错误')).toBe('网络错误');
  });
});

describe('describeMaskSaveError（复用同一码分流，杜绝两份规则漂移）', () => {
  it('与 describeNodeEditError 逐码一致', () => {
    for (const code of [40900, 40901, 42200, 40300, 50300, 50000, null]) {
      expect(describeMaskSaveError(code, { current_edit_revision: 9, field: 'sensitive_level' }, 'm')).toBe(
        describeNodeEditError(code, { current_edit_revision: 9, field: 'sensitive_level' }, 'm'),
      );
    }
  });
});
