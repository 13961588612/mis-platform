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
   * 父级选择模式（E.8 上级类型）：允许选择非末级节点作为父级。
   * 同时以 excludeId 排除自身及其后代（防环）。岗位表单默认不开启（仅末级可选，E.5）。
   */
  allowNonLeaf?: boolean;
  /** 排除的节点 id（自身）：该节点及其后代不可选（用于上级类型选择防环） */
  excludeId?: string | number | null;
}

/**
 * 岗位类型下拉树（BFF GET /post-types/tree）。
 *
 * <p>默认模式（E.5）：<b>仅末级（isLeaf=1）可点选</b>，非末级节点点击仅展开/收起（不可作为岗位类型）。
 * 父级选择模式（allowNonLeaf）：任意非自身节点均可选（含非末级），用于管理页「上级类型」。
 * 复用 Radix Popover，不新增依赖。
 */
export function PostTypeTreeSelect({
  value,
  onChange,
  placeholder,
  disabled,
  allowNonLeaf = false,
  excludeId = null,
}: PostTypeTreeSelectProps) {
  const [tree, setTree] = useState<PostTypeTreeNode[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedName, setSelectedName] = useState('');

  // 拉取树（默认全量含禁用，便于管理页选择父级；岗位表单调用方可自行过滤）
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

  // 计算排除集合：excludeId 自身 + 其所有后代（用于上级类型选择防环）
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
    // BFS 收集后代
    const queue: PostTypeTreeNode[] = [byId.get(selfKey)].filter(Boolean) as PostTypeTreeNode[];
    while (queue.length) {
      const cur = queue.shift()!;
      const children = cur.children ?? [];
      for (const c of children) {
        set.add(c.id);
        queue.push(c);
      }
    }
    return set;
  }, [excludeId, tree]);

  useEffect(() => {
    if (value == null || value === '') {
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

  const renderNodes = (nodes: PostTypeTreeNode[], depth: number): ReactNode =>
    nodes.map((n) => {
      const isLeaf = n.isLeaf === 1;
      const selectable = (isLeaf || allowNonLeaf) && !excludedIds.has(n.id);
      const isOpen = expanded.has(n.id) || (!isLeaf && allowNonLeaf && expanded.has(n.id));
      const expandable = !isLeaf && !allowNonLeaf; // 默认模式：非末级仅展开；父级模式：非末级也可选，无需展开
      return (
        <div key={n.id}>
          <button
            type="button"
            disabled={!selectable}
            onClick={() => {
              if (!selectable) return;
              if (expandable) {
                toggleExpand(n.id);
              } else {
                selectNode(n);
              }
            }}
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition',
              selectable ? 'hover:bg-muted' : 'cursor-not-allowed opacity-50',
              String(value) === String(n.id) && 'bg-primary/10 font-medium text-primary',
              depth > 0 && 'ml-3',
            )}
          >
            {!isLeaf ? (
              <ChevronRight
                className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition', isOpen && 'rotate-90')}
              />
            ) : (
              <span className="inline-block w-3.5 shrink-0" />
            )}
            {isLeaf ? (
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{n.name}</span>
            {!isLeaf ? (
              <span className="ml-auto rounded bg-muted px-1 text-[0.65rem] text-muted-foreground">分类</span>
            ) : null}
          </button>
          {!isLeaf && (isOpen || (allowNonLeaf && !isLeaf)) && n.children?.length ? (
            <>{renderNodes(n.children, depth + 1)}</>
          ) : null}
        </div>
      );
    });

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
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
          <span className={cn(selectedName ? 'text-foreground' : 'text-muted-foreground')}>
            {selectedName || placeholder || '请选择岗位类型（树形·仅末级）'}
          </span>
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="max-h-72 overflow-auto rounded-md border border-border/60 p-1">
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
