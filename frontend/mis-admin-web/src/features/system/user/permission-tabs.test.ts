import { describe, expect, it } from 'vitest';
import type { DeptNode } from '@/types/api';
import { hasSelectedDescendant } from './permission-dept-tree-utils';

function node(id: string, children?: DeptNode[]): DeptNode {
  return {
    id,
    tenantId: '1',
    orgId: '1',
    parentId: '0',
    code: id,
    name: `部门${id}`,
    categoryId: null,
    ancestors: null,
    sort: 0,
    status: 1,
    isRoot: null,
    leaderEmployeeId: null,
    linkedOrgId: null,
    linkedOrgName: null,
    createdAt: null,
    updatedAt: null,
    children: children?.length ? children : null,
  };
}

const root = node('r', [
  node('a', [node('a1'), node('a2', [node('a21')])]),
  node('b'),
]);

describe('permission-tabs 部门三态', () => {
  it('无任何选中 → 半选为 false', () => {
    expect(hasSelectedDescendant(root, new Set())).toBe(false);
  });

  it('只有直接子节点选中 → true', () => {
    expect(hasSelectedDescendant(root, new Set(['a']))).toBe(true);
  });

  it('只有深层后代选中 → true（跨层传播）', () => {
    expect(hasSelectedDescendant(root, new Set(['a21']))).toBe(true);
  });

  it('兄弟子树选中 → true', () => {
    expect(hasSelectedDescendant(root, new Set(['b']))).toBe(true);
  });

  it('选中本节点但子树未选 → 返回 false（本节点状态由自身 checked 表达）', () => {
    expect(hasSelectedDescendant(root, new Set(['r']))).toBe(false);
  });

  it('叶子节点无子树 → false', () => {
    expect(hasSelectedDescendant(node('leaf'), new Set(['leaf']))).toBe(false);
  });
});
