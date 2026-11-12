/**
 * rowScopeUtils.test.ts — 行级维度可视化纯函数单测（T04c / MR-12 回归守卫）。
 *
 * <p>钉住四处**静默失效**：
 * <ol>
 *   <li>{@link parseRowScope}：单维度对象 / 多维度数组漏解析 → 徽标消失（看着像没配）；</li>
 *   <li>{@link buildPredicatePreview} / {@link combinePredicatesAnd}：谓词形态（PATH_PREFIX/ENUM）
 *       口径错 → 预览与 Worker 实际注入不一致；</li>
 *   <li>{@link alignDimensionToCatalogField}：维度注册表用列名、catalog 用 item_key →
 *       按键对齐恒为空（必须按列名末段对齐）；</li>
 *   <li>{@link describeScopeError}：只读 message 会丢掉 `data.field` 等明细。</li>
 * </ol>
 * 纯函数测试，运行在 vitest node 环境（默认），无需 jsdom。
 */
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_PLACEHOLDER,
  VALUES_PLACEHOLDER,
  SCOPE_PERMISSIONS,
  alignDimensionToCatalogField,
  buildPredicatePreview,
  buildRowScope,
  buildSimulatedWherePreview,
  catalogColumnName,
  combinePredicatesAnd,
  describeScopeError,
  dimensionBadge,
  parseRowScope,
  pathColumnOf,
  readApiError,
  summarizeRowScope,
  type RowScopeInstance,
} from './rowScopeUtils';
import type { IqdCatalogItem, IqdScopeDimension } from '@/lib/api/iqd';

const DEPT_DIM: IqdScopeDimension = {
  dimension_code: 'dept',
  dimension_name: '部门',
  predicate_type: 'PATH_PREFIX',
  column_name: 'dept_id',
  header_name: 'X-Mis-Dept-Scope',
  dict_table: 'mis_dept_scope',
};
const STORE_DIM: IqdScopeDimension = {
  dimension_code: 'store',
  dimension_name: '门店',
  predicate_type: 'ENUM',
  column_name: 'store_id',
  header_name: 'X-Mis-Stores',
  dict_table: 'mis_store_scope',
};

describe('权限码（改动即失败：写错 = 前端放行、后端 40300）', () => {
  it('维度 GET → iqd:dimension:view（V73 api 92571 → menu 92517）', () => {
    expect(SCOPE_PERMISSIONS.dimensionView).toBe('iqd:dimension:view');
  });

  it('维度 POST/DELETE → iqd:dimension:save（92572/92573 → 92518）', () => {
    expect(SCOPE_PERMISSIONS.dimensionSave).toBe('iqd:dimension:save');
  });

  it('字典同步 → iqd:scope:sync（92574 → 92519）', () => {
    expect(SCOPE_PERMISSIONS.scopeSync).toBe('iqd:scope:sync');
  });

  it('范围/字典状态查看 → iqd:scope:view（92563/92575 → 92511）', () => {
    expect(SCOPE_PERMISSIONS.scopeView).toBe('iqd:scope:view');
  });
});

describe('dimensionBadge（码 → 徽标文案/色调）', () => {
  it('dept → 部门 / primary；store → 门店 / accent', () => {
    expect(dimensionBadge('dept')).toEqual({ code: 'dept', label: '部门', tone: 'primary' });
    expect(dimensionBadge('store')).toEqual({ code: 'store', label: '门店', tone: 'accent' });
  });

  it('未知维度回退原码 + muted；空码 → 未知维度', () => {
    expect(dimensionBadge('region')).toEqual({ code: 'region', label: 'region', tone: 'muted' });
    expect(dimensionBadge('').label).toBe('未知维度');
  });
});

describe('parseRowScope（单维度对象 / 多维度数组，任一漏判即徽标消失）', () => {
  it('null / 空串 → empty，无错误', () => {
    for (const value of [null, undefined, '', '   ']) {
      const parsed = parseRowScope(value);
      expect(parsed.empty).toBe(true);
      expect(parsed.instances).toHaveLength(0);
      expect(parsed.error).toBeNull();
    }
  });

  it('单维度对象 → 1 条实例', () => {
    const parsed = parseRowScope('{"dimension":"dept","scope":"dept_subtree"}');
    expect(parsed.error).toBeNull();
    expect(parsed.instances).toEqual([
      { dimension: 'dept', scope: 'dept_subtree', path: null, values: null },
    ]);
  });

  it('多维度数组（dimensions）→ 2 条实例（AND 叠加）', () => {
    const parsed = parseRowScope(
      '{"dimensions":[{"dimension":"dept","scope":"dept_subtree"},{"dimension":"store","scope":"store"}]}',
    );
    expect(parsed.instances.map((i) => i.dimension)).toEqual(['dept', 'store']);
  });

  it('裸数组同样解析', () => {
    const parsed = parseRowScope('[{"dimension":"store","scope":"store"}]');
    expect(parsed.instances).toHaveLength(1);
    expect(parsed.instances[0].dimension).toBe('store');
  });

  it('别名兼容：dimension_code / code 与 path / values 示意实参', () => {
    const parsed = parseRowScope(
      '{"dimension_code":"dept","scope":"dept_subtree","path":"/0/1/A/","values":["S1","S2"]}',
    );
    expect(parsed.instances[0]).toEqual({
      dimension: 'dept',
      scope: 'dept_subtree',
      path: '/0/1/A/',
      values: ['S1', 'S2'],
    });
  });

  it('非法 JSON → error（不静默吞掉）', () => {
    const parsed = parseRowScope('{oops');
    expect(parsed.error).toContain('JSON');
    expect(parsed.instances).toHaveLength(0);
  });

  it('结构无法识别 → error；空对象 / 空数组 → empty', () => {
    expect(parseRowScope('{"foo":1}').error).not.toBeNull();
    expect(parseRowScope('{}').empty).toBe(true);
    expect(parseRowScope('[]').empty).toBe(true);
  });
});

describe('summarizeRowScope（授权矩阵单元格：去重徽标 + 叠加计数）', () => {
  it('未配置 → hasRowScope=false', () => {
    const summary = summarizeRowScope(null);
    expect(summary.hasRowScope).toBe(false);
    expect(summary.badges).toHaveLength(0);
  });

  it('双维度 → 两枚徽标，count=2', () => {
    const summary = summarizeRowScope(
      '{"dimensions":[{"dimension":"dept","scope":"dept_subtree"},{"dimension":"store","scope":"store"}]}',
    );
    expect(summary.badges.map((b) => b.code)).toEqual(['dept', 'store']);
    expect(summary.count).toBe(2);
    expect(summary.hasRowScope).toBe(true);
  });

  it('同码重复 → 去重为单徽标但 count 保留', () => {
    const summary = summarizeRowScope(
      '{"dimensions":[{"dimension":"dept","scope":"dept"},{"dimension":"dept","scope":"dept_subtree"}]}',
    );
    expect(summary.badges).toHaveLength(1);
    expect(summary.count).toBe(2);
  });
});

describe('pathColumnOf（PATH_PREFIX 作用于物化 path 列）', () => {
  it('dept_id → dept_path；store_id → store_path', () => {
    expect(pathColumnOf('dept_id')).toBe('dept_path');
    expect(pathColumnOf('store_id')).toBe('store_path');
  });

  it('非 _id 列 → 追加 _path；空 → 空', () => {
    expect(pathColumnOf('org')).toBe('org_path');
    expect(pathColumnOf('')).toBe('');
  });
});

describe('buildPredicatePreview（PATH_PREFIX / ENUM 两形态）', () => {
  it('PATH_PREFIX：有锚点 path → dept_path = ... OR dept_path LIKE .../%', () => {
    const instance: RowScopeInstance = {
      dimension: 'dept',
      scope: 'dept_subtree',
      path: '/0/1/A/',
      values: null,
    };
    const preview = buildPredicatePreview(instance, DEPT_DIM);
    expect(preview.predicateType).toBe('PATH_PREFIX');
    expect(preview.column).toBe('dept_path');
    expect(preview.text).toBe("dept_path = '/0/1/A/' OR dept_path LIKE '/0/1/A/%'");
    expect(preview.note).toBe('');
  });

  it('PATH_PREFIX：无锚点 → 占位符 + 示意说明', () => {
    const preview = buildPredicatePreview(
      { dimension: 'dept', scope: 'dept_subtree', path: null, values: null },
      DEPT_DIM,
    );
    expect(preview.text).toContain(ANCHOR_PLACEHOLDER);
    expect(preview.text).toContain('LIKE');
    expect(preview.note).toContain('示意');
  });

  it('PATH_PREFIX：锚点 path 无尾斜杠时归一补 `/`', () => {
    const preview = buildPredicatePreview(
      { dimension: 'dept', scope: 'dept_subtree', path: '/0/1/A', values: null },
      DEPT_DIM,
    );
    expect(preview.text).toBe("dept_path = '/0/1/A/' OR dept_path LIKE '/0/1/A/%'");
  });

  it('ENUM：有值集合 → store_id IN (...)', () => {
    const preview = buildPredicatePreview(
      { dimension: 'store', scope: 'store', path: null, values: ['S001', 'S002'] },
      STORE_DIM,
    );
    expect(preview.predicateType).toBe('ENUM');
    expect(preview.column).toBe('store_id');
    expect(preview.text).toBe("store_id IN ('S001', 'S002')");
    expect(preview.note).toBe('');
  });

  it('ENUM：无值集合 → 占位符 + 示意说明', () => {
    const preview = buildPredicatePreview(
      { dimension: 'store', scope: 'store', path: null, values: null },
      STORE_DIM,
    );
    expect(preview.text).toBe(`store_id IN (${VALUES_PLACEHOLDER})`);
    expect(preview.note).toContain('示意');
  });

  it('FAIL_CLOSED → 1 = 0', () => {
    const preview = buildPredicatePreview(
      { dimension: 'dept', scope: 'dept_subtree', path: null, values: null },
      { ...DEPT_DIM, predicate_type: 'FAIL_CLOSED' },
    );
    expect(preview.text).toContain('1 = 0');
  });

  it('缺注册表记录 → text 为空 + note 说明（不臆造形态）', () => {
    const preview = buildPredicatePreview(
      { dimension: 'region', scope: 'region', path: null, values: null },
      null,
    );
    expect(preview.predicateType).toBe('UNKNOWN');
    expect(preview.text).toBe('');
    expect(preview.note).toContain('维度注册表');
  });
});

describe('combinePredicatesAnd（多维度 AND 叠加）', () => {
  const dept = buildPredicatePreview(
    { dimension: 'dept', scope: 'dept_subtree', path: '/0/1/A/', values: null },
    DEPT_DIM,
  );
  const store = buildPredicatePreview(
    { dimension: 'store', scope: 'store', path: null, values: ['S001', 'S002'] },
    STORE_DIM,
  );

  it('0 条 → 空串', () => {
    expect(combinePredicatesAnd([])).toBe('');
  });

  it('1 条 → 原样（不加括号）', () => {
    expect(combinePredicatesAnd([dept])).toBe(dept.text);
  });

  it('2 条 → 各加括号后 AND 拼接（PATH_PREFIX 含 OR，括号不可省）', () => {
    const combined = combinePredicatesAnd([dept, store]);
    expect(combined).toBe(
      `(${dept.text}) AND (${store.text})`,
    );
    expect(combined).toContain(' AND ');
  });

  it('UNKNOWN（text 为空）被过滤', () => {
    const unknown = buildPredicatePreview(
      { dimension: 'region', scope: 'region', path: null, values: null },
      null,
    );
    expect(combinePredicatesAnd([dept, unknown])).toBe(dept.text);
  });
});

describe('buildSimulatedWherePreview（已废弃：改走后端真端点）', () => {
  it('★ 保留形态拼接（后端真端点已取代）', () => {
    const previews = [
      buildPredicatePreview(
        { dimension: 'dept', scope: 'dept_subtree', path: '/0/1/A/', values: null },
        DEPT_DIM,
      ),
      buildPredicatePreview(
        { dimension: 'store', scope: 'store', path: null, values: ['S001', 'S002'] },
        STORE_DIM,
      ),
    ];
    const simulated = buildSimulatedWherePreview(previews);
    expect(simulated.degraded).toBe(true);
    expect(simulated.note).toContain('/iqd/scope/preview');
    expect(simulated.text).toContain(' AND ');
    expect(simulated.text).toContain('dept_path');
    expect(simulated.text).toContain('store_id');
  });
});

describe('alignDimensionToCatalogField（按列名对齐，非按键）', () => {
  const catalog: IqdCatalogItem[] = [
    { kind: 'model', item_key: 'mdl:model:orders' },
    { kind: 'column', item_key: 'pg.public.orders.dept_id' },
    { kind: 'column', item_key: 'pg.public.orders.store_id' },
    { kind: 'measure', item_key: 'mdl:measure:orders.revenue' },
  ];

  it('catalogColumnName：取末段', () => {
    expect(catalogColumnName({ item_key: 'pg.public.orders.dept_id' })).toBe('dept_id');
    expect(catalogColumnName({ item_key: 'dept_id' })).toBe('dept_id');
    expect(catalogColumnName({ item_key: '' })).toBe('');
  });

  it('★ column_name=dept_id 命中 kind=column 的 .dept_id 项', () => {
    const hit = alignDimensionToCatalogField('dept_id', catalog);
    expect(hit?.item_key).toBe('pg.public.orders.dept_id');
  });

  it('大小写不敏感；非 column kind 不命中', () => {
    expect(alignDimensionToCatalogField('STORE_ID', catalog)?.item_key).toBe(
      'pg.public.orders.store_id',
    );
    expect(alignDimensionToCatalogField('orders', catalog)).toBeNull();
  });

  it('空 column_name → null', () => {
    expect(alignDimensionToCatalogField('', catalog)).toBeNull();
  });
});

describe('readApiError（读 response.data，不丢 code/data）', () => {
  it('axios 形态：抽取 code / data / message', () => {
    const err = {
      response: { data: { code: 42200, message: '参数非法', data: { field: 'column_name' } } },
    };
    expect(readApiError(err)).toEqual({
      code: 42200,
      data: { field: 'column_name' },
      message: '参数非法',
    });
  });

  it('普通 Error → code/data 为 null', () => {
    expect(readApiError(new Error('网络错误'))).toEqual({
      code: null,
      data: null,
      message: '网络错误',
    });
  });

  it('未知值 → 兜底消息', () => {
    expect(readApiError('boom').code).toBeNull();
    expect(readApiError('boom').message).toBe('请求失败');
  });
});

describe('describeScopeError（逐码读 data 明细）', () => {
  it('40300 → 权限提示', () => {
    expect(describeScopeError(40300, null, 'x')).toContain('iqd:dimension:view');
  });

  it('40400 → 目标不存在', () => {
    expect(describeScopeError(40400, null, 'x')).toContain('不存在');
  });

  it('42200 → 带 field 明细', () => {
    expect(describeScopeError(42200, { field: 'column_name' }, '参数非法')).toContain('column_name');
  });

  it('45204 → fail-closed 字典不可得', () => {
    expect(describeScopeError(45204, null, 'x')).toContain('fail-closed');
  });

  it('50000 / 未知码 / 无码', () => {
    expect(describeScopeError(50000, null, '系统错误')).toBe('[50000] 系统错误：系统错误');
    expect(describeScopeError(40900, null, '冲突')).toBe('[40900] 冲突');
    expect(describeScopeError(null, null, '网络错误')).toBe('网络错误');
  });
});

describe('buildRowScope（对象级列覆盖构造）', () => {
  it('未写 column → 仅 dimension', () => {
    const out = buildRowScope([{ dimension: 'dept' }]);
    expect(out).toBe('{"dimensions":[{"dimension":"dept"}]}');
  });

  it('写 column → 覆盖列写入 dimensions[].column', () => {
    const out = buildRowScope([{ dimension: 'dept', column: 'org_dept_code' }]);
    expect(out).toBe('{"dimensions":[{"dimension":"dept","column":"org_dept_code"}]}');
  });

  it('空串 column → 不写（回落维度全局列）', () => {
    const out = buildRowScope([{ dimension: 'store', column: '  ' }]);
    expect(out).toBe('{"dimensions":[{"dimension":"store"}]}');
  });

  it('多维度独立覆盖 + 保留 scope', () => {
    const out = buildRowScope([
      { dimension: 'dept', column: 'org_dept_code', scope: 'dept_subtree' },
      { dimension: 'store', column: 'shop_no' },
    ]);
    expect(out).toBe(
      '{"dimensions":[{"dimension":"dept","column":"org_dept_code","scope":"dept_subtree"},{"dimension":"store","column":"shop_no"}]}',
    );
  });

  it('无有效维度 → null（全行可见）', () => {
    expect(buildRowScope([])).toBeNull();
    expect(buildRowScope([{ dimension: '  ' }])).toBeNull();
  });

  it('与 parseRowScope 往返一致（含 column）', () => {
    const json = buildRowScope([{ dimension: 'dept', column: 'department_key' }])!;
    const parsed = parseRowScope(json);
    expect(parsed.error).toBeNull();
    expect(parsed.instances[0].dimension).toBe('dept');
    expect(parsed.instances[0].column).toBe('department_key');
  });
});
