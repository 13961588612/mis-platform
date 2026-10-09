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
});