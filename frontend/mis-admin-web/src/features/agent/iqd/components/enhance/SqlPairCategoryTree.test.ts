import { describe, expect, it } from 'vitest';
import type { IqdSqlPairCategory } from '@/lib/api/iqd';
import {
  sortSqlPairCategoriesByCode,
  toCategoryTreeSelectNodes,
} from './SqlPairCategoryTree';

function cat(
  partial: Partial<IqdSqlPairCategory> & Pick<IqdSqlPairCategory, 'id' | 'code' | 'name'>,
): IqdSqlPairCategory {
  return {
    parent_id: 0,
    sort_order: 0,
    enabled: true,
    ...partial,
  };
}

describe('sortSqlPairCategoriesByCode', () => {
  it('同级按编号自然序；全部/未分类不在树内', () => {
    const tree = sortSqlPairCategoriesByCode([
      cat({ id: 3, code: '10', name: '十' }),
      cat({ id: 1, code: '2', name: '二' }),
      cat({ id: 2, code: '1', name: '一' }),
    ]);
    expect(tree.map((n) => n.code)).toEqual(['1', '2', '10']);
  });

  it('递归排序子节点', () => {
    const tree = sortSqlPairCategoriesByCode([
      cat({
        id: 1,
        code: 'b',
        name: 'B',
        children: [
          cat({ id: 12, code: 'b2', name: 'B2', parent_id: 1 }),
          cat({ id: 11, code: 'b1', name: 'B1', parent_id: 1 }),
        ],
      }),
      cat({ id: 2, code: 'a', name: 'A' }),
    ]);
    expect(tree.map((n) => n.code)).toEqual(['a', 'b']);
    expect(tree[1].children?.map((n) => n.code)).toEqual(['b1', 'b2']);
  });
});

describe('toCategoryTreeSelectNodes', () => {
  it('下拉也按编号排序', () => {
    const nodes = toCategoryTreeSelectNodes([
      cat({ id: 2, code: 'z', name: 'Z' }),
      cat({ id: 1, code: 'a', name: 'A' }),
    ]);
    expect(nodes.map((n) => n.name)).toEqual(['A', 'Z']);
  });
});
