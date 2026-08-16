import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fetchDeptTree } from '@/lib/api/depts';
import { listOrgs } from '@/lib/api/orgs';
import type { DeptNode } from '@/types/api';

const fieldInputClass =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-foreground shadow-none';

const actionBtnClass =
  'rounded border border-input px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground';

/** 渲染用树节点：顶层为「组织分组」（不可选），其 children 为真实部门树（可选）。 */
interface TreeItem {
  id: string;
  name: string;
  selectable: boolean;
  children?: TreeItem[];
}

export interface DeptTreeMultiProps {
  /** 当前选中部门 id 数组（多选，沿用 deptIds 并集语义） */
  value?: (string | number)[];
  onChange: (value: (string | number)[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * 部门树形多选（E.7）：用于岗位查询「所属部门」过滤。
 *
 * <p>跨组织聚合：挂载时并行拉取【全部有权限组织】的部门树，按组织分组聚合成"森林"
 * （组织节点仅作展开/折叠的分组头、不可选；部门节点可选、可多选）。默认全收缩，
 * 点击节点箭头才展开下一级；选中项以 chip 展示在触发器内部（不溢出组件）；
 * Popover 顶部提供「全选 / 清空」。不依赖单个 orgId，删除原组织选择框。
 * 复用现有 fetchDeptTree / listOrgs，不引入新依赖。
 */
export function DeptTreeMulti({ value = [], onChange, placeholder, disabled }: DeptTreeMultiProps) {
  const [forest, setForest] = useState<TreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  // 默认空集合 = 全收缩；仅当 expanded 含某节点 id 时才渲染其 children
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const selectedIds = useMemo(() => new Set(value.map(String)), [value]);

  // 真实部门树 → 渲染用 TreeItem（可选）
  const toTreeItems = (nodes: DeptNode[]): TreeItem[] =>
    nodes.map((n) => ({
      id: String(n.id),
      name: n.name,
      selectable: true,
      children: n.children && n.children.length > 0 ? toTreeItems(n.children) : undefined,
    }));

  // id → name 映射（用于 chip 展示）
  const idToName = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (items: TreeItem[]) => {
      for (const it of items) {
        map.set(it.id, it.name);
        if (it.children?.length) walk(it.children);
      }
    };
    walk(forest);
    return map;
  }, [forest]);

  // 收集森林中所有可选节点的 id（递归）
  const collectSelectable = (items: TreeItem[], acc: string[] = []): string[] => {
    for (const it of items) {
      if (it.selectable) acc.push(it.id);
      if (it.children?.length) collectSelectable(it.children, acc);
    }
    return acc;
  };

  // 挂载时并行拉取所有有权限组织的部门树，按组织分组合并为森林
  useEffect(() => {
    let alive = true;
    setLoading(true);
    listOrgs()
      .then((list) => {
        if (!alive) return;
        const tasks = list.map((org) =>
          fetchDeptTree(org.id)
            .then((tree) => ({ org, tree }))
            .catch(() => ({ org, tree: [] as DeptNode[] })),
        );
        Promise.all(tasks).then((results) => {
          if (!alive) return;
          const nextForest: TreeItem[] = results.map(({ org, tree }) => ({
            id: `org:${org.id}`,
            name: org.name,
            selectable: false,
            children: toTreeItems(tree),
          }));
          setForest(nextForest);
          setLoading(false);
        });
      })
      .catch(() => {
        if (!alive) return;
        setForest([]);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // toTreeItems 为纯函数，依赖稳定；仅挂载执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleNode = (node: TreeItem) => {
    if (disabled) return;
    const key = node.id;
    if (selectedIds.has(key)) {
      onChange(value.filter((v) => String(v) !== key));
    } else {
      onChange([...value, node.id]);
    }
  };

  const selectAll = () => {
    if (disabled) return;
    onChange(collectSelectable(forest));
  };

  const clearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  const renderNodes = (nodes: TreeItem[], depth: number): ReactNode =>
    nodes.map((n) => {
      const hasChildren = !!n.children && n.children.length > 0;
      const isExpanded = expanded.has(n.id);
      const checked = n.selectable && selectedIds.has(n.id);
      return (
        <div key={n.id}>
          <div className={cn('flex items-center gap-1 rounded px-2 py-1', depth > 0 && 'ml-3')}>
            {/* 展开/折叠箭头：有子节点的组织分组或部门父节点都带 */}
            {hasChildren ? (
              <button
                type="button"
                onClick={() => !disabled && toggleExpand(n.id)}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted"
                aria-label={isExpanded ? '折叠' : '展开'}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <span className="inline-block h-5 w-5 shrink-0" />
            )}
            {n.selectable ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleNode(n)}
                className={cn(
                  'flex flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-sm transition hover:bg-muted',
                  checked && 'bg-primary/10 font-medium text-primary',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <span
                  className={cn(
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {checked ? <Check className="h-3 w-3" /> : null}
                </span>
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{n.name}</span>
              </button>
            ) : (
              <span className="flex flex-1 items-center gap-1.5 px-1.5 py-0.5 text-sm font-medium text-foreground/90">
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{n.name}</span>
              </span>
            )}
          </div>
          {hasChildren && <div>{isExpanded ? renderNodes(n.children as TreeItem[], depth + 1) : null}</div>}
          {/* 组织分组下无部门时标注 */}
          {!hasChildren && !n.selectable ? (
            <div className="ml-9 py-0.5 text-xs text-muted-foreground">无部门</div>
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
            fieldInputClass,
            'flex items-center justify-between gap-2 text-left',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          {/* 选中项 chip 收在触发器内部，max-h 约束不溢出组件 */}
          <span className={cn('flex flex-1 flex-wrap gap-1 overflow-auto', selectedIds.size === 0 ? 'block' : 'max-h-20')}>
            {selectedIds.size === 0 ? (
              <span className="text-muted-foreground">{placeholder || '请选择部门（可多选）'}</span>
            ) : (
              value.map((v) => {
                const key = String(v);
                return (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary/80"
                  >
                    {idToName.get(key) ?? key}
                  </span>
                );
              })
            )}
          </span>
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="mb-2 flex items-center gap-2">
          <button type="button" onClick={selectAll} disabled={disabled} className={cn(actionBtnClass, disabled && 'cursor-not-allowed opacity-60')}>
            全选
          </button>
          <button type="button" onClick={clearAll} disabled={disabled} className={cn(actionBtnClass, disabled && 'cursor-not-allowed opacity-60')}>
            清空
          </button>
        </div>
        {loading ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">加载中…</div>
        ) : forest.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">暂无可选部门</div>
        ) : (
          <div className="max-h-64 overflow-auto rounded-md border border-border/60 p-1">{renderNodes(forest, 0)}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
