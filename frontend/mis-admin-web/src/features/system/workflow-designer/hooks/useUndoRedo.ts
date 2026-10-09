/**
 * 撤销/重做（P7 设计器增强）。
 *
 * <p>快照式：每次结构性变更（增删节点/连线、拖拽结束、属性编辑）后 push 一帧；
 * Undo/Redo 在栈之间搬运快照。用 ref 保存当前值避免闭包过期。
 */
import { useCallback, useRef, useState } from 'react';

export interface Snapshot<T> {
  value: T;
  label: string;
}

const MAX_HISTORY = 50;

export function useUndoRedo<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial);
  const undoStack = useRef<Snapshot<T>[]>([]);
  const redoStack = useRef<Snapshot<T>[]>([]);
  const presentRef = useRef<T>(initial);
  const [version, setVersion] = useState(0);

  const set = useCallback((next: T, label = 'edit', record = true) => {
    if (record) {
      undoStack.current.push({ value: presentRef.current, label });
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
    }
    presentRef.current = next;
    setPresent(next);
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