// @vitest-environment jsdom
/**
 * useUndoRedo 单测（P7 设计器增强）。
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useUndoRedo } from './useUndoRedo';

describe('useUndoRedo', () => {
  it('set 后可 undo 回退，redo 前进', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));
    expect(result.current.present).toBe(0);

    act(() => result.current.set(1));
    act(() => result.current.set(2));
    expect(result.current.present).toBe(2);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.present).toBe(1);
    act(() => result.current.undo());
    expect(result.current.present).toBe(0);
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.redo());
    expect(result.current.present).toBe(1);
    act(() => result.current.redo());
    expect(result.current.present).toBe(2);
  });

  it('新变更清空 redo 栈', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));
    act(() => result.current.set(1));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.set(9));
    expect(result.current.canRedo).toBe(false);
  });

  it('record=false 不入历史', () => {
    const { result } = renderHook(() => useUndoRedo<number>(0));
    act(() => result.current.set(5, 'silent', false));
    expect(result.current.present).toBe(5);
    expect(result.current.canUndo).toBe(false);
  });

  it('函数式 set 始终基于最新 present（避免闭包清空画布）', () => {
    const { result } = renderHook(() =>
      useUndoRedo<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] }),
    );
    // 捕获首轮 set（模拟 handleNodeChange 空依赖闭包）
    const staleSet = result.current.set;
    act(() => result.current.set({ nodes: ['a', 'b'], edges: ['e1'] }));
    expect(result.current.present.nodes).toEqual(['a', 'b']);

    // 即使用「旧」的 set 引用，函数式更新也应读到最新节点，而不是初始 []
    act(() =>
      staleSet((prev) => ({
        nodes: prev.nodes.map((n) => (n === 'a' ? 'a2' : n)),
        edges: prev.edges,
      })),
    );
    expect(result.current.present.nodes).toEqual(['a2', 'b']);
    expect(result.current.present.edges).toEqual(['e1']);
  });
});