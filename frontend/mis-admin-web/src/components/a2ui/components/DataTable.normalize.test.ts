import { describe, expect, it } from 'vitest';
import { normalizeDataTableRows } from './DataTable';

describe('normalizeDataTableRows', () => {
  it('zips array rows to column keys (iqd__ask shape)', () => {
    const rows = normalizeDataTableRows(
      [
        ['701', '叶菜', '1'],
        ['702', '根茎', '2'],
      ],
      ['categoryid', 'categoryname', 'sort'],
    );
    expect(rows).toEqual([
      { categoryid: '701', categoryname: '叶菜', sort: '1' },
      { categoryid: '702', categoryname: '根茎', sort: '2' },
    ]);
  });

  it('keeps object rows unchanged', () => {
    const rows = normalizeDataTableRows(
      [{ categoryid: '701', categoryname: '叶菜' }],
      ['categoryid', 'categoryname'],
    );
    expect(rows).toEqual([{ categoryid: '701', categoryname: '叶菜' }]);
  });

  it('synthesizes col_N when columns missing', () => {
    const rows = normalizeDataTableRows([['a', 'b']], []);
    expect(rows).toEqual([{ col_0: 'a', col_1: 'b' }]);
  });

  it('skips null and non-object scalars', () => {
    const rows = normalizeDataTableRows([null, 'x', 1, { a: 1 }], ['a']);
    expect(rows).toEqual([{ a: 1 }]);
  });
});
