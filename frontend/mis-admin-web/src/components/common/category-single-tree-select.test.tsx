// @vitest-environment jsdom
/**
 * CategorySingleTreeSelect 通用分类下拉树**单选**组件单测：
 * 1. 选任意节点（含非叶子）→ 回传该 id 并关闭面板（单选语义，不 toggle）
 * 2. 展开节点后子分类可见并可选中
 * 3. 「清除」回传 null（未分类）
 * 4. 触发器文案：未选显示 placeholder（未分类）/ 已选显示分类名 / 值不在树中回退 fallbackLabel
 * 5. 空树时面板显示空态文案
 *
 * <p>交互用 pointerDown 触发（组件对动作/节点采用 pointerdown/click 双触发处理，
 * 规避 Dialog 场景 click 被 dismiss 层吞掉）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CategorySingleTreeSelect } from './category-single-tree-select';
import type { CategoryTreeNode } from './category-tree-select';

const tree: CategoryTreeNode[] = [
  { id: '1', name: '根分类', children: [{ id: '2', name: '子分类', children: null }] },
  { id: '3', name: '独立分类' },
];

afterEach(() => {
  cleanup();
});

/** 未选任何分类时点击触发器（name = placeholder）打开面板。 */
function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: '未分类' }));
}

describe('CategorySingleTreeSelect', () => {
  it('选中顶层节点 → 回传该分类 id', () => {
    const onChange = vi.fn();
    render(<CategorySingleTreeSelect tree={tree} value={null} onChange={onChange} />);
    openPanel();

    fireEvent.pointerDown(screen.getByRole('button', { name: '根分类' }), { button: 0 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('允许选任意节点（非叶子 → 也能选中并回传 id）', () => {
    const onChange = vi.fn();
    render(<CategorySingleTreeSelect tree={tree} value={null} onChange={onChange} />);
    openPanel();

    // 根分类有子节点（非叶子），仍应允许选中并回传其 id。
    fireEvent.pointerDown(screen.getByRole('button', { name: '根分类' }), { button: 0 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('展开节点后子分类可见并可选中', () => {
    const onChange = vi.fn();
    render(<CategorySingleTreeSelect tree={tree} value={null} onChange={onChange} />);
    openPanel();

    // 默认折叠：子分类不可见
    expect(screen.queryByRole('button', { name: '子分类' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    // 展开后可选中
    fireEvent.pointerDown(screen.getByRole('button', { name: '子分类' }), { button: 0 });

    expect(onChange).toHaveBeenCalledWith('2');
  });

  it('选中后触发 onChange；键盘激活（click.detail=0）同样生效', () => {
    const onChange = vi.fn();
    render(<CategorySingleTreeSelect tree={tree} value={null} onChange={onChange} />);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: '独立分类' }), { detail: 0 });

    expect(onChange).toHaveBeenCalledWith('3');
  });

  it('「清除」回传 null（未分类）', () => {
    const onChange = vi.fn();
    render(<CategorySingleTreeSelect tree={tree} value="3" onChange={onChange} />);
    // 触发器显示已选名称「独立分类」→ 打开面板
    fireEvent.click(screen.getByRole('button', { name: '独立分类' }));

    fireEvent.pointerDown(screen.getByRole('button', { name: '清除' }), { button: 0 });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('触发器文案：未选显示 placeholder、已选显示分类名', () => {
    render(<CategorySingleTreeSelect tree={tree} value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '未分类' })).toBeTruthy();
    cleanup();
    render(<CategorySingleTreeSelect tree={tree} value="2" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '子分类' })).toBeTruthy();
  });

  it('值不在树中时触发器回退展示 fallbackLabel（不丢失已选值）', () => {
    render(
      <CategorySingleTreeSelect tree={tree} value="999" onChange={vi.fn()} fallbackLabel="分类#999" />,
    );
    expect(screen.getByRole('button', { name: '分类#999' })).toBeTruthy();
  });

  it('空树时面板显示空态文案', () => {
    render(<CategorySingleTreeSelect tree={[]} value={null} onChange={vi.fn()} />);
    openPanel();

    expect(screen.getByText('暂无可选分类')).toBeTruthy();
  });
});
