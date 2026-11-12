// @vitest-environment jsdom
/**
 * CategoryTreeSelect 通用分类下拉树多选组件单测：
 * 1. 勾选 / 取消勾选节点回传 / 移除该分类 id
 * 2. 展开节点后子分类可见并可勾选
 * 3. 「全选」回传整棵树所有 id（含子节点）
 * 4. 「清空」回传空数组
 * 5. 已选分类以 chip 展示名称、未选时显示 placeholder
 * 6. 空树时面板显示空态文案
 *
 * <p>交互用 pointerDown 触发（组件对动作/节点采用 pointerdown/click 双触发处理，
 * 规避 Dialog 场景 click 被 dismiss 层吞掉）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CategoryTreeSelect, type CategoryTreeNode } from './category-tree-select';

const tree: CategoryTreeNode[] = [
  { id: '1', name: '根分类', children: [{ id: '2', name: '子分类', children: null }] },
  { id: '3', name: '独立分类' },
];

afterEach(() => {
  cleanup();
});

/** 未选任何分类时点击触发器（name = placeholder）打开面板。 */
function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: '全部分类' }));
}

describe('CategoryTreeSelect', () => {
  it('勾选节点回传该分类 id', () => {
    const onChange = vi.fn();
    render(<CategoryTreeSelect tree={tree} value={[]} onChange={onChange} />);
    openPanel();

    fireEvent.pointerDown(screen.getByRole('button', { name: '根分类' }), { button: 0 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['1']);
  });

  it('再次勾选已选中的节点将其移除（多选 toggle）', () => {
    const onChange = vi.fn();
    render(<CategoryTreeSelect tree={tree} value={['1']} onChange={onChange} />);
    // 触发器显示 chip「根分类」，点它打开面板
    fireEvent.click(screen.getByRole('button', { name: '根分类' }));

    // 面板打开后「根分类」出现两处：触发器 chip + 树节点（节点在 DOM 靠后）
    const matches = screen.getAllByRole('button', { name: '根分类' });
    fireEvent.pointerDown(matches[matches.length - 1], { button: 0 });

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('展开节点后子分类可见并可勾选', () => {
    const onChange = vi.fn();
    render(<CategoryTreeSelect tree={tree} value={[]} onChange={onChange} />);
    openPanel();

    // 默认折叠：子分类不可见
    expect(screen.queryByRole('button', { name: '子分类' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    // 展开后可勾选
    fireEvent.pointerDown(screen.getByRole('button', { name: '子分类' }), { button: 0 });

    expect(onChange).toHaveBeenCalledWith(['2']);
  });

  it('「全选」回传整棵树所有 id（含子节点）', () => {
    const onChange = vi.fn();
    render(<CategoryTreeSelect tree={tree} value={[]} onChange={onChange} />);
    openPanel();

    fireEvent.pointerDown(screen.getByRole('button', { name: '全选' }), { button: 0 });

    expect(onChange).toHaveBeenCalledWith(['1', '2', '3']);
  });

  it('键盘激活「全选」（click.detail=0）同样生效', () => {
    const onChange = vi.fn();
    render(<CategoryTreeSelect tree={tree} value={[]} onChange={onChange} />);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: '全选' }), { detail: 0 });

    expect(onChange).toHaveBeenCalledWith(['1', '2', '3']);
  });

  it('「清空」回传空数组', () => {
    const onChange = vi.fn();
    render(<CategoryTreeSelect tree={tree} value={['3']} onChange={onChange} />);
    // 触发器显示 chip「独立分类」→ 打开面板
    fireEvent.click(screen.getByRole('button', { name: '独立分类' }));

    fireEvent.pointerDown(screen.getByRole('button', { name: '清空' }), { button: 0 });

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('已选分类以 chip 展示名称，未选时显示 placeholder', () => {
    render(<CategoryTreeSelect tree={tree} value={['2']} onChange={vi.fn()} />);
    // 已选：触发器展示子分类名称（chip 文案）
    expect(screen.getByRole('button', { name: '子分类' })).toBeTruthy();
    // 未选：显示 placeholder「全部分类」
    cleanup();
    render(<CategoryTreeSelect tree={tree} value={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '全部分类' })).toBeTruthy();
  });

  it('空树时面板显示空态文案', () => {
    render(<CategoryTreeSelect tree={[]} value={[]} onChange={vi.fn()} />);
    openPanel();

    expect(screen.getByText('暂无可选分类')).toBeTruthy();
  });
});
