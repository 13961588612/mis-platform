import { describe, expect, it } from 'vitest';
import {
  flattenSkillCategories,
  skillCatDescendantIds,
  type SkillCatNode,
} from './skill-category-tree';

const tree: SkillCatNode[] = [
  {
    id: 1,
    parent_id: 0,
    name: '超市',
    sort_order: 0,
    children: [
      {
        id: 2,
        parent_id: 1,
        name: '成文',
        sort_order: 0,
        children: [],
      },
    ],
  },
  { id: 3, parent_id: 0, name: 'CRM', sort_order: 1, children: [] },
];

describe('skill-category-tree', () => {
  it('flatten 带路径与缩进深度', () => {
    const flat = flattenSkillCategories(tree);
    expect(flat.map((r) => r.path).sort()).toEqual(['CRM', '超市', '超市/成文'].sort());
    expect(flat.find((r) => r.id === 2)?.depth).toBe(1);
  });

  it('descendantIds 含自身与子节点', () => {
    expect([...skillCatDescendantIds(tree, 1)].sort()).toEqual([1, 2]);
    expect([...skillCatDescendantIds(tree, 3)]).toEqual([3]);
  });
});
