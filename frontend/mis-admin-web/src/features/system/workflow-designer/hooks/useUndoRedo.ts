/**
 * 撤销/重做（P7 设计器增强）。
 *
 * <p>快照式：每次结构性变更（增删节点/连线、拖拽结束、属性编辑）后 push 一帧；
 * Undo/Redo 在栈之间搬运快照。用 ref 保存当前值避免闭包过期。
 *
 * <p>{@link #set} 支持函数式更新 `(prev) => next`，与 React setState 同形，避免调用方
 * 闭包里读到过期的 `present`（曾导致属性面板改审批人规则时把画布节点清空）。
 */
import { useCallback, useRef, useState } from 'react';

export interface Snapshot<T> {
  value: T;
  label: string;
}

const MAX_HISTORY = 50;

export type UndoRedoSetter<T> = T | ((prev: T) => T);

export function useUndoRedo<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial);
  const undoStack = useRef<Snapshot<T>[]>([]);
  const redoStack = useRef<Snapshot<T>[]>([]);
  const presentRef = useRef<T>(initial);
  const [version, setVersion] = useState(0);

  const set = useCallback((next: UndoRedoSetter<T>, label = 'edit', record = true) => {
    const resolved =
      typeof next === 'function' ? (next as (prev: T) => T)(presentRef.current) : next;
    if (record) {
      undoStack.current.push({ value: presentRef.current, label });
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
    }
    presentRef.current = resolved;
    setPresent(resolved);
    setVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push({ value: presentRef.current, label: prev.label });
    presentRef.current = prev.value;
    setPresent(prev.value);
    setVersion((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push({ value: presentRef.current, label: next.label });
    presentRef.current = next.value;
    setPresent(next.value);
    setVersion((v) => v + 1);
  }, []);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  return { present, set, undo, redo, canUndo, canRedo, version };
}
