// @vitest-environment jsdom
/**
 * BizCategoryTree 单测：缩进树、根节点清空过滤、选中高亮、点击回调。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BizCategoryTree } from './biz-category-tree';
import type { BizCategoryItem } from '@/lib/api/biz-category';

const tree: BizCategoryItem[] = [
  {
    id: '1',
    tenantId: '1',
    parentId: 0,
    code: 'A',
    name: '分类A',
    description: null,
    sortOrder: 0,
    config: null,
    children: [
      {
        id: '2',
        tenantId: '1',
        parentId: 1,
        code: 'B',
        name: '分类B',
        description: null,
        sortOrder: 0,
        config: null,
        children: null,
        createdAt: '',
        updatedAt: '',
      },
    ],
    createdAt: '',
    updatedAt: '',
  },
];

afterEach(cleanup);

describe('BizCategoryTree 单测', () => {
  it('渲染根节点 + 子节点，点击节点/onSelect 拿到 id，点击根清空', () => {
    const onSelect = vi.fn();
    render(<BizCategoryTree tree={tree} selectedId={null} onSelect={onSelect} />);
    expect(screen.getByText('全部分类')).toBeTruthy();
    expect(screen.getByText('分类A')).toBeTruthy();
    expect(screen.getByText('分类B')).toBeTruthy();

    fireEvent.click(screen.getByText('分类A'));
    expect(onSelect).toHaveBeenCalledWith('1');
    fireEvent.click(screen.getByText('全部分类'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('子节点按层级缩进（paddingLeft 更大）', () => {
    const onSelect = vi.fn();
    render(<BizCategoryTree tree={tree} selectedId={null} onSelect={onSelect} />);
    const aBtn = screen.getByText('分类A').closest('button') as HTMLButtonElement;
    const bBtn = screen.getByText('分类B').closest('button') as HTMLButtonElement;
    const aPad = Number((aBtn.style.paddingLeft || '0').replace('px', ''));
    const bPad = Number((bBtn.style.paddingLeft || '0').replace('px', ''));
    expect(bPad).toBeGreaterThan(aPad);
  });

  it('空树显示「暂无分类」', () => {
    const onSelect = vi.fn();
    render(<BizCategoryTree tree={[]} selectedId={null} onSelect={onSelect} />);
    expect(screen.getByText('暂无分类')).toBeTruthy();
  });

  it('加载中显示「加载中…」', () => {
    const onSelect = vi.fn();
    render(<BizCategoryTree tree={[]} selectedId={null} onSelect={onSelect} loading />);
    expect(screen.getByText('加载中…')).toBeTruthy();
  });

  it('选中项高亮（选中节点 class 含 text-primary）', () => {
    const onSelect = vi.fn();
    render(<BizCategoryTree tree={tree} selectedId="1" onSelect={onSelect} />);
    const aBtn = screen.getByText('分类A').closest('button') as HTMLButtonElement;
    expect(aBtn.className).toContain('text-primary');
  });
});
