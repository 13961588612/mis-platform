import { describe, it, expect } from 'vitest';
import {
  isOrgInChain,
  buildOrgChain,
  normalizePierceNode,
  normalizePierceForestSkipTopLevel,
  type DeptTreeRow,
} from './dept-tree-types';
import type { DeptPierceNode } from '@/types/api';

/** 构造一个最小可用穿透节点（其余字段给默认值），便于聚焦部门类型断言。 */
function pierce(overrides: Partial<DeptPierceNode>): DeptPierceNode {
  return {
    id: '901',
    orgId: '10',
    orgName: '组织甲',
    parentId: '0',
    code: '0001',
    name: '研发部',
    sort: 0,
    status: 1,
    isRoot: 0,
    linkedOrgId: null,
    linkedOrgName: null,
    ...overrides,
  };
}

/**
 * 测试部门树 inline 穿透（inline-pierce）的防循环（anti-loop）纯函数。
 *
 * <p>防循环核心逻辑：下钻外部组织前，调用方会构造「根 → 当前行」的祖先组织链
 * {@link buildOrgChain}，并用 {@link isOrgInChain} 校验目标组织是否已进入链中；
 * 若已进入（即 A→B→A 的回环），则拒绝下钻并提示，从而避免无限循环。
 */
describe('dept-tree anti-loop guard (inline pierce)', () => {
  describe('isOrgInChain — 防循环守卫', () => {
    it('已存在于链的祖先组织 A 返回 true（必须阻断，核心防循环场景）', () => {
      expect(isOrgInChain(['A', 'B'], 'A')).toBe(true);
    });

    it('已存在于链的祖先组织 B 返回 true（必须阻断）', () => {
      expect(isOrgInChain(['A', 'B'], 'B')).toBe(true);
    });

    it('不在链中的组织 C 返回 false（允许下钻）', () => {
      expect(isOrgInChain(['A', 'B'], 'C')).toBe(false);
    });

    it('空链对有效组织返回 false（允许下钻）', () => {
      expect(isOrgInChain([], 'A')).toBe(false);
    });

    it('null 组织返回 false（falsy 视为不在链中）', () => {
      expect(isOrgInChain(['A', 'B'], null)).toBe(false);
    });

    it('undefined 组织返回 false（falsy 视为不在链中）', () => {
      expect(isOrgInChain(['A', 'B'], undefined)).toBe(false);
    });

    it('空字符串组织返回 false（falsy 视为不在链中）', () => {
      expect(isOrgInChain(['A', 'B'], '')).toBe(false);
    });
  });

  describe('buildOrgChain — 支持防循环的祖先链幂等追加', () => {
    it('向链追加新组织 B → [\'A\',\'B\']', () => {
      expect(buildOrgChain(['A'], 'B')).toEqual(['A', 'B']);
    });

    it('追加已存在的组织 B 不产生重复 → [\'A\',\'B\']（防止回环时链无限增长）', () => {
      expect(buildOrgChain(['A', 'B'], 'B')).toEqual(['A', 'B']);
    });

    it('对 null 组织原样返回当前链', () => {
      expect(buildOrgChain(['A'], null)).toEqual(['A']);
    });

    it('对空字符串组织原样返回当前链', () => {
      expect(buildOrgChain(['A'], '')).toEqual(['A']);
    });
  });
});

describe('normalizePierceNode — 部门类型透传 (Part 1)', () => {
  it('穿透节点携带 deptTypeId / deptTypeName → DeptTreeRow 同字段透传（只读行展示真实类型，非「—」）', () => {
    const node = pierce({ deptTypeId: '5', deptTypeName: '研发类' });
    const row: DeptTreeRow = normalizePierceNode(node, []);

    expect(row.readOnly).toBe(true);
    expect(row.deptTypeId).toBe('5');
    expect(row.deptTypeName).toBe('研发类');
    // 渲染层约定：仅真为 null 才显示「—」，故非空必须原样透传
    expect(row.deptTypeName).not.toBeNull();
  });

  it('穿透节点 deptTypeName 为 null → DeptTreeRow.deptTypeName 为 null（渲染层显示「—」）', () => {
    const node = pierce({ deptTypeId: null, deptTypeName: null });
    const row: DeptTreeRow = normalizePierceNode(node, []);

    expect(row.deptTypeId).toBeNull();
    expect(row.deptTypeName).toBeNull();
  });

  it('穿透节点仅带 deptTypeId（缺 deptTypeName）→ deptTypeName 回退 null，不得抛错', () => {
    const node = pierce({ deptTypeId: '7', deptTypeName: undefined });
    const row: DeptTreeRow = normalizePierceNode(node, []);

    expect(row.deptTypeId).toBe('7');
    expect(row.deptTypeName).toBeNull();
  });

  it('递归：子穿透节点同样透传部门类型（forest 全深度嵌套）', () => {
    const child = pierce({ id: '902', name: '子研发', deptTypeId: '8', deptTypeName: '子研发类' });
    const node = pierce({ deptTypeId: '5', deptTypeName: '研发类', children: [child] });
    const row: DeptTreeRow = normalizePierceNode(node, []);

    expect(row.deptTypeName).toBe('研发类');
    expect(row.children).toHaveLength(1);
    expect(row.children[0].deptTypeId).toBe('8');
    expect(row.children[0].deptTypeName).toBe('子研发类');
  });

  it('穿透行 id 带 pierce 前缀（跨组织同名 id 不撞键），且 sourceOrgName 回填来源组织名', () => {
    const node = pierce({ orgId: '10', deptTypeId: '5', deptTypeName: '研发类' });
    const row: DeptTreeRow = normalizePierceNode(node, []);

    expect(row.id).toBe('pierce:10:901');
    expect(row.rawId).toBe('901');
    expect(row.sourceOrgName).toBe('组织甲');
  });
});

describe('normalizePierceForestSkipTopLevel — 下钻不显示对端顶级部门 (BugFix)', () => {
  it('顶级部门（无 linkedOrgId）被跳过，其子部门提升为直接子行', () => {
    const child = pierce({ id: '902', name: '子研发', parentId: '901' });
    const root = pierce({ id: '901', name: '研发部', parentId: '0', children: [child] });
    const rows = normalizePierceForestSkipTopLevel([root], []);

    const rawIds = rows.map((r) => r.rawId);
    expect(rawIds).not.toContain('901'); // 顶级部门本身不显示
    expect(rawIds).toContain('902'); // 其子部门提升为顶层
    const childRow = rows.find((r) => r.rawId === '902')!;
    expect(childRow.readOnly).toBe(true);
    expect(childRow.sourceOrgName).toBe('组织甲');
    expect(childRow.id).toBe('pierce:10:902');
  });

  it('多个顶级部门全部压平，结果均为其下级部门', () => {
    const a = pierce({ id: '901', children: [pierce({ id: '902' })] });
    const b = pierce({ id: '903', children: [pierce({ id: '904' })] });
    const rows = normalizePierceForestSkipTopLevel([a, b], []);

    expect(rows.map((r) => r.rawId)).toEqual(['902', '904']);
  });

  it('顶级部门自身 linkedOrgId 非空时保留该行（保留继续下钻入口）', () => {
    const root = pierce({
      id: '905',
      linkedOrgId: '99',
      linkedOrgName: '组织丙',
      children: [pierce({ id: '906' })],
    });
    const rows = normalizePierceForestSkipTopLevel([root], []);

    const rawIds = rows.map((r) => r.rawId);
    expect(rawIds).toContain('905'); // 保留（根部门还链接更深组织）
    expect(rows[0].children.map((c) => c.rawId)).toContain('906'); // 子部门随保留行正常嵌套
  });

  it('顶级部门无子部门（leaf）时该分支不贡献任何行', () => {
    const leaf = pierce({ id: '907', children: undefined });
    const rows = normalizePierceForestSkipTopLevel([leaf], []);

    expect(rows.map((r) => r.rawId)).not.toContain('907');
    expect(rows).toHaveLength(0);
  });
});
