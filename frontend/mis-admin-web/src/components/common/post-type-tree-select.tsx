import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Folder, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { listPostTypeTree } from '@/lib/api/post-types';
import type { PostTypeTreeNode } from '@/types/api';

export interface PostTypeTreeSelectProps {
  /** 当前选中岗位类型 id（单值）；回填时由引擎传入 */
  value?: string | number | null;
  onChange: (value: string | number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * 选择范围：
   * - `leaf`（默认）：仅末级可选（岗位表单）
   * - `non-leaf`：仅非末级（分类）可选（上级类型）
   * - `any`：任意节点可选
   */
  selectMode?: 'leaf' | 'non-leaf' | 'any';
  /**
   * @deprecated 使用 selectMode='any'；保留兼容旧调用。
   */
  allowNonLeaf?: boolean;
  /** 排除的节点 id（自身）：该节点及其后代不可选（用于上级类型选择防环） */
  excludeId?: string | number | null;
}

/**
 * 岗位类型下拉树（BFF GET /post-types/tree）。
 *
 * <p>默认仅末级可选；上级类型选择用 {@code selectMode='non-leaf'}。
 */
export function PostTypeTreeSelect({
  value,
  onChange,
  placeholder,
  disabled,
  selectMode,
  allowNonLeaf = false,
  excludeId = null,
}: PostTypeTreeSelectProps) {
  const mode: 'leaf' | 'non-leaf' | 'any' = selectMode ?? (allowNonLeaf ? 'any' : 'leaf');
  const [tree, setTree] = useState<PostTypeTreeNode[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedName, setSelectedName] = useState('');

  useEffect(() => {
    let alive = true;
    listPostTypeTree()
      .then((t) => {
        if (alive) setTree(t);
      })
      .catch(() => {
        /* 树加载失败：选择器为空 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const idToName = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: PostTypeTreeNode[]) => {
      for (const n of nodes) {
        map.set(n.id, n.name);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  const excludedIds = useMemo(() => {
    const set = new Set<string>();
    if (excludeId == null) return set;
    const selfKey = String(excludeId);
    set.add(selfKey);
    const byId = new Map<string, PostTypeTreeNode>();
    const walkIndex = (nodes: PostTypeTreeNode[]) => {
      for (const n of nodes) {
        byId.set(n.id, n);
        if (n.children?.length) walkIndex(n.children);
      }
    };
    walkIndex(tree);
    const queue: PostTypeTreeNode[] = [byId.get(selfKey)].filter(Boolean) as PostTypeTreeNode[];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const c of cur.children ?? []) {
        set.add(c.id);
        queue.push(c);
      }
    }
    return set;
  }, [excludeId, tree]);

  useEffect(() => {
    if (value == null || value === '' || value === '0') {
      setSelectedName('');
      return;
    }
    setSelectedName(idToName.get(String(value)) ?? '');
  }, [value, idToName]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectNode = (node: PostTypeTreeNode) => {
    onChange(node.id);
    setSelectedName(node.name);
    setOpen(false);
  };

  const isSelectable = (n: PostTypeTreeNode) => {
    if (excludedIds.has(n.id)) return false;
    if (mode === 'any') return true;
    if (mode === 'non-leaf') return n.isLeaf === 0;
    return n.isLeaf === 1;
  };

  const renderNodes = (nodes: PostTypeTreeNode[], depth: number): ReactNode =>
    nodes.map((n) => {
      const isLeaf = n.isLeaf === 1;
      const selectable = isSelectable(n);
      const isOpen = expanded.has(n.id);
      // 非末级始终可展开看树；末级不可展开
      const canExpand = !isLeaf && (n.children?.length ?? 0) > 0;
      return (
        <div key={n.id}>
          <div
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm',
              depth > 0 && 'ml-3',
              String(value) === String(n.id) && 'bg-primary/10 font-medium text-primary',
            )}
          >
            {canExpand ? (
              <button
                type="button"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                aria-label={isOpen ? '收起' : '展开'}
                onClick={() => toggleExpand(n.id)}
              >
                <ChevronRight className={cn('h-3.5 w-3.5 transition', isOpen && 'rotate-90')} />
              </button>
            ) : (
              <span className="inline-block h-5 w-5 shrink-0" />
            )}
            <button
              type="button"
              disabled={!selectable}
              onClick={() => selectable && selectNode(n)}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 rounded text-left',
                selectable ? 'hover:bg-muted' : 'cursor-not-allowed opacity-50',
              )}
            >
              {isLeaf ? (
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{n.name}</span>
              {!isLeaf ? (
                <span className="ml-auto rounded bg-muted px-1 text-[0.65rem] text-muted-foreground">分类</span>
              ) : (
                <span className="ml-auto rounded bg-success/10 px-1 text-[0.65rem] text-success">末级</span>
              )}
            </button>
          </div>
          {!isLeaf && isOpen && n.children?.length ? <>{renderNodes(n.children, depth + 1)}</> : null}
        </div>
      );
    });

  const defaultPlaceholder =
    mode === 'non-leaf'
      ? '顶级（无上级）/ 选择分类'
      : mode === 'any'
        ? '请选择岗位类型'
        : '请选择岗位类型（树形·仅末级）';

  return (
    <Popover modal open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-left shadow-none',
            'flex items-center justify-between',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', selectedName ? 'text-foreground' : 'text-muted-foreground')}>
            {selectedName || placeholder || defaultPlaceholder}
          </span>
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="max-h-72 overflow-auto rounded-md border border-border/60 p-1">
          {mode === 'non-leaf' ? (
            <button
              type="button"
              className="mb-1 w-full rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
              onClick={() => {
                onChange('0');
                setSelectedName('');
                setOpen(false);
              }}
            >
              顶级（无上级）
            </button>
          ) : null}
          {tree.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">暂无岗位类型</div>
          ) : (
            renderNodes(tree, 0)
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
