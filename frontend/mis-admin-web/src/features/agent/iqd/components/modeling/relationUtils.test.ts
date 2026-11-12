/**
 * relationUtils.test.ts — 关系纯函数单测（T03b：基数视觉编码 / 命名 / 条件分析）。
 *
 * <p>为什么值得单测：这四条规则的失效都是**静默**的 ——
 * 基数画错只是「看起来不一样」（建模者会以为配错），
 * 关系名生成规则一变 `item_key` 就换锚点（幂等去重与引用扫描全部失配），
 * 条件分析写错则误报/漏报「字段不存在」。
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeCondition,
  buildRelationshipName,
  encodeCardinality,
  normalizeCardinalityValue,
  normalizeJoinType,
  normalizeJoinTypeValue,
} from './relationUtils';

describe('encodeCardinality（基数 → 箭头 + 线型）', () => {
  it('1:N → 仅目标端箭头、实线', () => {
    expect(encodeCardinality('1:N')).toEqual({
      arrowAtSource: false,
      arrowAtTarget: true,
      label: '1:N',
    });
  });

  it('N:1 → 仅源端箭头', () => {
    expect(encodeCardinality('N:1')).toEqual({
      arrowAtSource: true,
      arrowAtTarget: false,
      label: 'N:1',
    });
  });

  it('1:1 → 双箭头且实线', () => {
    const encoding = encodeCardinality('1:1');
    expect(encoding.arrowAtSource).toBe(true);
    expect(encoding.arrowAtTarget).toBe(true);
    expect(encoding.strokeDasharray).toBeUndefined();
  });

  it('N:N → 双箭头 + 虚线（必须与 1:1 在视觉上可区分）', () => {
    const encoding = encodeCardinality('N:N');
    expect(encoding.arrowAtSource).toBe(true);
    expect(encoding.arrowAtTarget).toBe(true);
    expect(encoding.strokeDasharray).toBe('6 3');
  });

  it('空 / null / 未知 → 回退 1:N（历史 MDL 同步来的关系没有 cardinality）', () => {
    expect(encodeCardinality(null).label).toBe('1:N');
    expect(encodeCardinality(undefined).label).toBe('1:N');
    expect(encodeCardinality('').label).toBe('1:N');
    expect(encodeCardinality('many-to-many').label).toBe('1:N');
  });

  it('大小写/空白容错（后端信封里可能写成 metric 形态）', () => {
    expect(encodeCardinality(' n:n ').strokeDasharray).toBe('6 3');
    expect(encodeCardinality('1:n').arrowAtTarget).toBe(true);
  });
});

describe('normalizeJoinType / normalizers', () => {
  it('展示文案：大写 + 空值回退 INNER（与后端默认一致）', () => {
    expect(normalizeJoinType('left')).toBe('LEFT');
    expect(normalizeJoinType('')).toBe('INNER');
    expect(normalizeJoinType(null)).toBe('INNER');
  });

  it('回读归一：大小写容错，未知回退默认值', () => {
    expect(normalizeJoinTypeValue('LEFT')).toBe('left');
    expect(normalizeJoinTypeValue('FULL')).toBe('full');
    expect(normalizeJoinTypeValue('cross')).toBe('inner');
    expect(normalizeCardinalityValue('1:1')).toBe('1:1');
    expect(normalizeCardinalityValue(' n:1 ')).toBe('N:1');
    expect(normalizeCardinalityValue('whatever')).toBe('1:N');
  });
});

describe('buildRelationshipName（mdl:relationship:<name> 的 name 段）', () => {
  it('小写 + 下划线连接', () => {
    expect(buildRelationshipName('Orders', 'Customers')).toBe('orders_customers');
  });

  it('非 [a-z0-9_] 一律压成下划线（item_key 是跨端契约，不能带空格/中文）', () => {
    expect(buildRelationshipName('a-b.c', 'd/e')).toBe('a_b_c_d_e');
  });

  it('纯中文/纯符号名 → 该段无可用字符时回退占位词（不产出 "order_items_" 这种半截键）', () => {
    expect(buildRelationshipName('order items', '客户 主表')).toBe('order_items_target');
  });

  it('缺失一侧 → 占位词（不产出非法 key）', () => {
    expect(buildRelationshipName(null, 'customers')).toBe('source_customers');
    expect(buildRelationshipName('orders', undefined)).toBe('orders_target');
    expect(buildRelationshipName('', '')).toBe('source_target');
  });
});

describe('analyzeCondition（本地提示：等值对 + 疑似不存在字段）', () => {
  const source = { displayName: 'orders', fields: ['customer_id', 'amount'] };
  const target = { displayName: 'customers', fields: ['id', 'name'] };

  it('标准条件 → 一对等值对、无风险 token', () => {
    const analysis = analyzeCondition('orders.customer_id = customers.id', source, target);
    expect(analysis.pairs).toEqual([{ left: 'orders.customer_id', right: 'customers.id' }]);
    expect(analysis.unknownTokens).toEqual([]);
  });

  it('AND 复合条件 → 多对', () => {
    const analysis = analyzeCondition(
      'orders.customer_id = customers.id AND orders.amount = customers.id',
      source,
      target,
    );
    expect(analysis.pairs).toHaveLength(2);
  });

  it('引用不存在的字段 → 列入 unknownTokens（仅提示，调用方不得据此阻断保存）', () => {
    const analysis = analyzeCondition('orders.ghost_col = customers.id', source, target);
    expect(analysis.unknownTokens).toContain('orders.ghost_col');
  });

  it('字符串字面量里的内容不算字段', () => {
    const analysis = analyzeCondition("orders.amount = 'ghost'", source, target);
    expect(analysis.unknownTokens).not.toContain('ghost');
  });

  it('空条件 / 缺端点 → 空结果（不抛）', () => {
    expect(analyzeCondition('', source, target)).toEqual({ pairs: [], unknownTokens: [] });
    expect(analyzeCondition(null, source, target)).toEqual({ pairs: [], unknownTokens: [] });
    expect(analyzeCondition('orders.customer_id = customers.id', null, target)).toEqual({
      pairs: [],
      unknownTokens: [],
    });
  });
});
