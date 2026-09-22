/**
 * cubeUtils.test.ts — Cube 纯函数单测（T03c 回归守卫）。
 *
 * <p>四处**静默失效**的规则被钉在这里：
 * <ol>
 *   <li>{@link buildCubeItemKey} 的键段压缩：改名即换 item_key，幂等去重/引用扫描/model_ref 挂靠全换锚点；</li>
 *   <li>{@link parseCubeChildren} 的子节点回读：读错只是「打开编辑器看到空的度量」，不报错；</li>
 *   <li>{@link toMeasures}/{@link toDimensions} 的 wire 映射：`rowId`（UI 态）若漏剥会作为额外字段发给后端；</li>
 *   <li>{@link describeCubeError} 的码分流：只读 message 会把 `data.errors` 里的
 *       「哪个字段不存在」整条丢掉 —— 而这正是 42201 唯一有价值的信息。</li>
 * </ol>
 */
import { describe, expect, it } from 'vitest';
import type { IqdCatalogItem } from '@/lib/api/iqd';
import {
  buildCubeItemKey,
  buildCubePatch,
  cubeNameOf,
  describeCubeError,
  dimensionItemKey,
  emptyDimensionRow,
  emptyMeasureRow,
  inferModelRef,
  keyTail,
  measureItemKey,
  normalizeModelRef,
  parseCubeChildren,
  toDimensionRows,
  toDimensions,
  toMeasureRows,
  toMeasures,
  validateCubeDraft,
  type CubeDraftValues,
} from './cubeUtils';

/** 造一条 catalog 项（只需被测字段）。 */
function item(partial: Partial<IqdCatalogItem> & { item_key: string; kind: string }): IqdCatalogItem {
  return partial as IqdCatalogItem;
}

describe('item_key 构造与解析', () => {
  it('buildCubeItemKey：压成 [a-z0-9_] 并加前缀（与 §8.6 一致）', () => {
    expect(buildCubeItemKey('销售额 Revenue')).toBe('mdl:cube:revenue');
    expect(buildCubeItemKey('order-items')).toBe('mdl:cube:order_items');
  });

  it('buildCubeItemKey：纯中文/空名回退 cube（不产出 mdl:cube: 这种半截键）', () => {
    expect(buildCubeItemKey('销售额')).toBe('mdl:cube:cube');
    expect(buildCubeItemKey('   ')).toBe('mdl:cube:cube');
  });

  it('cubeNameOf / keyTail：**点号在冒号之后就取点号**（三种键形态都要对）', () => {
    expect(cubeNameOf('mdl:cube:revenue')).toBe('revenue');
    expect(keyTail('mdl:model:orders')).toBe('orders');
    expect(keyTail('pg_main.public.orders.amount')).toBe('amount');
    // ★ 子节点键：`mdl:measure:<cube>.<name>` 的名字在**点号之后**（只用冒号会得到 revenue.total）
    expect(keyTail('mdl:measure:revenue.total')).toBe('total');
    expect(keyTail('mdl:dimension:revenue.store_id')).toBe('store_id');
    expect(keyTail('calc:orders.margin')).toBe('margin');
    expect(keyTail('')).toBe('');
  });

  it('子节点键形态与 T03a 逐字一致（mdl:measure:<cube>.<name>）', () => {
    expect(measureItemKey('revenue', 'total')).toBe('mdl:measure:revenue.total');
    expect(dimensionItemKey('revenue', 'store_id')).toBe('mdl:dimension:revenue.store_id');
  });

  it('normalizeModelRef：纯名补前缀、全键原样、空 → 空', () => {
    expect(normalizeModelRef('orders')).toBe('mdl:model:orders');
    expect(normalizeModelRef('mdl:model:orders')).toBe('mdl:model:orders');
    expect(normalizeModelRef('  ')).toBe('');
    expect(normalizeModelRef(null)).toBe('');
  });
});

describe('inferModelRef（历史数据挂靠推断）', () => {
  const modelKeys = ['mdl:model:orders', 'mdl:model:customers'];

  it('有 model_ref → 直接用它（T03a 新建的 cube）', () => {
    expect(inferModelRef({ model_ref: 'mdl:model:orders', expression: null }, modelKeys)).toBe(
      'mdl:model:orders',
    );
  });

  it('无 model_ref 但 expression 恰为模型名（历史 MDL 同步来源）→ 采用', () => {
    expect(inferModelRef({ model_ref: null, expression: 'orders' }, modelKeys)).toBe(
      'mdl:model:orders',
    );
  });

  it('expression 是别的定义文本 → **不猜**（返回空，让用户显式选）', () => {
    expect(
      inferModelRef({ model_ref: null, expression: 'sum(orders.amount)' }, modelKeys),
    ).toBe('');
  });

  it('cube 为 null → 空', () => {
    expect(inferModelRef(null, modelKeys)).toBe('');
  });
});

describe('parseCubeChildren（子节点 → measures/dimensions）', () => {
  const catalog: IqdCatalogItem[] = [
    item({ item_key: 'mdl:cube:revenue', kind: 'cube', display_name: '销售额' }),
    item({
      item_key: 'mdl:measure:revenue.total',
      kind: 'measure',
      parent_key: 'mdl:cube:revenue',
      display_name: '总销售额',
      expression: 'SUM(orders.amount)',
      data_type: '#,##0.00',
    }),
    item({
      item_key: 'mdl:dimension:revenue.store',
      kind: 'dimension',
      parent_key: 'mdl:cube:revenue',
      display_name: '门店',
      expression: 'orders.store_id',
    }),
    // 无关节点：不同 parent_key / 不同 kind 都不该被收进来
    item({ item_key: 'mdl:measure:other.x', kind: 'measure', parent_key: 'mdl:cube:other' }),
    item({ item_key: 'mdl:column:x', kind: 'column', parent_key: 'mdl:cube:revenue' }),
  ];

  it('按 parent_key 收子节点，度量取 expression + data_type(format)，维度取 expression', () => {
    const parsed = parseCubeChildren(catalog, 'mdl:cube:revenue');
    expect(parsed.measures).toEqual([
      { name: '总销售额', expression: 'SUM(orders.amount)', format: '#,##0.00' },
    ]);
    expect(parsed.dimensions).toEqual([{ name: '门店', ref_model_field: 'orders.store_id' }]);
  });

  it('按名称排序（保证两次打开顺序一致）；缺 display_name 时用 item_key 末段', () => {
    const withSort = parseCubeChildren(
      [
        item({ item_key: 'mdl:measure:r.b', kind: 'measure', parent_key: 'mdl:cube:r', expression: 'b' }),
        item({ item_key: 'mdl:measure:r.a', kind: 'measure', parent_key: 'mdl:cube:r', expression: 'a' }),
      ],
      'mdl:cube:r',
    );
    expect(withSort.measures.map((m) => m.name)).toEqual(['a', 'b']);
  });

  it('无子节点 → 两个空数组（不抛）', () => {
    expect(parseCubeChildren([], 'mdl:cube:revenue')).toEqual({ measures: [], dimensions: [] });
  });
});

describe('行 ↔ wire 映射（必须剥掉 UI 态 rowId）', () => {
  it('toMeasureRows/toMeasures 往返：rowId 不进 wire，空 format 不落字段', () => {
    const wires = [
      { name: '总销售额', expression: 'SUM(orders.amount)', format: '#,##0' },
      { name: '订单数', expression: 'COUNT(orders.id)' },
    ];
    const rows = toMeasureRows(wires);
    expect(rows.every((row) => row.rowId !== '')).toBe(true);

    const back = toMeasures(rows);
    expect(back).toEqual([
      { name: '总销售额', expression: 'SUM(orders.amount)', format: '#,##0' },
      { name: '订单数', expression: 'COUNT(orders.id)' },
    ]);
    // rowId 绝不能出现在 wire 里（后端 patch 不认识它）
    expect(back.some((measure) => 'rowId' in measure)).toBe(false);
  });

  it('toDimensionRows/toDimensions 往返', () => {
    const rows = toDimensionRows([{ name: '门店', ref_model_field: 'orders.store_id' }]);
    expect(toDimensions(rows)).toEqual([{ name: '门店', ref_model_field: 'orders.store_id' }]);
  });

  it('行值会 trim（用户常带尾空格），format 全空白 → 不落字段', () => {
    expect(
      toMeasures([{ rowId: 'r1', name: ' 总销售额 ', expression: ' SUM(x) ', format: '   ' }]),
    ).toEqual([{ name: '总销售额', expression: 'SUM(x)' }]);
  });

  it('空行工厂返回带 rowId 的空白行（供「添加度量/维度」）', () => {
    expect(emptyMeasureRow().rowId).not.toBe('');
    expect(emptyMeasureRow().name).toBe('');
    expect(emptyDimensionRow().refModelField).toBe('');
  });
});

describe('validateCubeDraft（提交前本地预检）', () => {
  const fieldOptions = ['orders.amount', 'orders.store_id'];
  const valid: CubeDraftValues = {
    displayName: '销售额',
    modelRef: 'mdl:model:orders',
    measures: [{ rowId: 'm1', name: '总销售额', expression: 'SUM(orders.amount)', format: '' }],
    dimensions: [{ rowId: 'd1', name: '门店', refModelField: 'orders.store_id' }],
  };

  it('合法草稿 → 无错误', () => {
    expect(validateCubeDraft(valid, fieldOptions)).toEqual([]);
  });

  it('名称为空 / 未选模型 / 无度量 → 各自报错', () => {
    expect(validateCubeDraft({ ...valid, displayName: ' ' }, fieldOptions)).toContain(
      'Cube 名称不能为空',
    );
    expect(validateCubeDraft({ ...valid, modelRef: '' }, fieldOptions)).toContain(
      '必须选择挂靠模型（model_ref）',
    );
    expect(validateCubeDraft({ ...valid, measures: [] }, fieldOptions)).toEqual([
      '至少需要一个度量（measure），否则 Cube 无法聚合',
    ]);
  });

  it('度量：名称/表达式为空、重名 → 报错（大小写不敏感）', () => {
    const errors = validateCubeDraft(
      {
        ...valid,
        measures: [
          { rowId: 'a', name: 'Total', expression: '' , format: '' },
          { rowId: 'b', name: 'total', expression: 'SUM(x)', format: '' },
        ],
      },
      fieldOptions,
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        '第 1 个度量：聚合表达式不能为空',
        '第 2 个度量：度量名重复（total）',
      ]),
    );
  });

  it('维度：引用模型里不存在的字段 → 报错（末段命中即可）', () => {
    const errors = validateCubeDraft(
      { ...valid, dimensions: [{ rowId: 'd', name: '幽灵', refModelField: 'orders.ghost' }] },
      fieldOptions,
    );
    expect(errors).toEqual(['第 1 个维度：引用了模型里不存在的字段（orders.ghost）']);

    // 末段命中（裸列名）应通过 —— 与后端 matchesAny 同口径
    expect(
      validateCubeDraft(
        { ...valid, dimensions: [{ rowId: 'd', name: '门店', refModelField: 'store_id' }] },
        fieldOptions,
      ),
    ).toEqual([]);
  });

  it('模型字段未加载（fieldOptions 空）→ **跳过**字段存在性检查（不误伤）', () => {
    expect(
      validateCubeDraft(
        { ...valid, dimensions: [{ rowId: 'd', name: '任意', refModelField: 'whatever' }] },
        [],
      ),
    ).toEqual([]);
  });
});

describe('describeCubeError（业务码 → 人话，必须读 data）', () => {
  it('42201 → 逐条列出 data.errors 并带上 model_ref', () => {
    const message = describeCubeError(42201, { errors: ['measure a 引用不存在字段: ghost'], model_ref: 'mdl:model:orders' }, 'fallback');
    expect(message).toContain('42201');
    expect(message).toContain('ghost');
    expect(message).toContain('mdl:model:orders');
  });

  it('42200 → 指出 field / model_item_key（挂靠模型不存在）', () => {
    const message = describeCubeError(
      42200,
      { field: 'model_ref', model_item_key: 'mdl:model:ghost' },
      'fallback',
    );
    expect(message).toContain('model_ref');
    expect(message).toContain('mdl:model:ghost');
  });

  it('42200 → 带 dependents 时说明被谁引用（引用阻断）', () => {
    const message = describeCubeError(42200, { dependents: ['mdl:cube:other'] }, 'fallback');
    expect(message).toContain('mdl:cube:other');
  });

  it('40900 / 40901 / 40300 / 50300 → 各自的可操作提示', () => {
    expect(describeCubeError(40900, { current_edit_revision: 13 }, 'x')).toContain('13');
    expect(describeCubeError(40901, null, 'x')).toContain('可直接重试');
    expect(describeCubeError(40300, null, 'x')).toContain('mdl_writeback_enabled');
    expect(describeCubeError(50300, null, 'x')).toContain('尚未就绪');
  });

  it('无业务码（网络/未知）→ 原样 message；有码但无明细 → 带码 + message', () => {
    expect(describeCubeError(null, null, '网络错误')).toBe('网络错误');
    expect(describeCubeError(50000, null, '系统错误')).toBe('[50000] 系统错误');
  });
});

describe('buildCubePatch（T04b：PUT 全量替换语义的防误清空守卫）', () => {
  const draft = (): CubeDraftValues => ({
    displayName: '  销售额 ',
    modelRef: 'mdl:model:orders',
    measures: [{ rowId: 'r1', name: ' total ', expression: ' sum(orders.amount) ', format: '' }],
    dimensions: [{ rowId: 'r2', name: 'store', refModelField: ' orders.store_id ' }],
  });

  it('★ 恒带完整 measures/dimensions（含空列表）—— 否则 PUT 会误清空既有子节点', () => {
    const patch = buildCubePatch(draft());
    expect(Array.isArray(patch.measures)).toBe(true);
    expect(Array.isArray(patch.dimensions)).toBe(true);
    expect(patch.measures).toHaveLength(1);
    expect(patch.dimensions).toHaveLength(1);

    // 目标态为空也必须显式传出（= 清空该类子节点，符合 PUT 语义；省略字段更难排查）
    const empty = buildCubePatch({ ...draft(), measures: [], dimensions: [] });
    expect(empty.measures).toEqual([]);
    expect(empty.dimensions).toEqual([]);
  });

  it('剥掉 UI 态 rowId；display_name / model_ref 归一（trim）', () => {
    const patch = buildCubePatch(draft());
    expect(patch.display_name).toBe('销售额');
    expect(patch.model_ref).toBe('mdl:model:orders');
    expect(patch.measures[0]).toEqual({ name: 'total', expression: 'sum(orders.amount)' });
    expect(patch.dimensions[0]).toEqual({ name: 'store', ref_model_field: 'orders.store_id' });
    // rowId 绝不能泄漏到 wire
    expect('rowId' in (patch.measures[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('format 空串不落 wire（与 toMeasures 同口径）；有值时保留', () => {
    const withFormat = buildCubePatch({
      ...draft(),
      measures: [{ rowId: 'r', name: 'm', expression: 'x', format: ' currency ' }],
    });
    expect(withFormat.measures[0].format).toBe('currency');
  });
});
