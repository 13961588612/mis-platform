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

/** 渲染用树节点（均为真实部门，可选）。 */
interface TreeItem {
  id: string;
  name: string;
  selectable: boolean;
  children?: TreeItem[];
}

/**
 * 去掉「链接到组织」的部门：{@code linkedOrgId} 非空则整棵子树丢弃（子部门不上提、不可选）。
 */
function omitLinkedOrgSubtrees(nodes: DeptNode[]): DeptNode[] {
  const out: DeptNode[] = [];
  for (const n of nodes) {
    if (n.linkedOrgId) continue;
    const children = n.children?.length ? omitLinkedOrgSubtrees(n.children) : [];
    out.push({
      ...n,
      children: children.length > 0 ? children : null,
    });
  }
  return out;
}

/** 真实部门树 → 渲染用 TreeItem（部门节点均可选）。 */
function toTreeItems(nodes: DeptNode[]): TreeItem[] {
  return nodes.map((n) => ({
    id: String(n.id),
    name: n.name,
    selectable: true,
    children: n.children && n.children.length > 0 ? toTreeItems(n.children) : undefined,
  }));
}

/** 递归收集森林中所有可选节点 id（供多选「全选」使用）。 */
function collectSelectable(items: TreeItem[], acc: string[] = []): string[] {
  for (const it of items) {
    if (it.selectable) acc.push(it.id);
    if (it.children?.length) collectSelectable(it.children, acc);
  }
  return acc;
}

/** 单选形态（默认）：value 为标量，onChange 回传单值；用于表单 deptId（sys_post.dept_id）。 */
export interface DeptTreeSelectSingleProps {
  multiple?: false;
  /** 当前选中部门 id（单值）；表单回填时由引擎传入 */
  value?: string | number | null;
  /** 选中部门时回传单值 deptId（清空时回传 null） */
  onChange: (value: string | number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** 多选形态：value 为数组，onChange 回传数组；用于筛选栏 deptIds（并集语义）。 */
export interface DeptTreeSelectMultipleProps {
  multiple: true;
  /** 当前选中部门 id 数组 */
  value?: (string | number)[];
  onChange: (value: (string | number)[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export type DeptTreeSelectProps = DeptTreeSelectSingleProps | DeptTreeSelectMultipleProps;

/**
 * 部门树形选择器（统一组件，单选 / 多选由 {@code multiple} 控制）。
 *
 * <p><b>跨组织聚合</b>：并行拉取各组织部门树，合并为「顶级部门」森林（不再以组织作第一层）。
 * 过滤 {@code linkedOrgId} 非空的穿透锚点部门及其整棵子树（子部门不上提）。默认全收缩。
 *
 * <p><b>单选</b>（表单 deptId）：点部门即选中并关闭。
 * <p><b>多选</b>（筛选 deptIds）：复选 + 全选/清空；触发器 chip 单行裁切。
 */
export function DeptTreeSelect(props: DeptTreeSelectProps) {
  const { placeholder, disabled = false, className } = props;
  const multiple = props.multiple === true;

  const [forest, setForest] = useState<TreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  // 默认空集合 = 全收缩；仅当 expanded 含某节点 id 时才渲染其 children
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /** 归一化当前选中值：单选视为「0/1 元数组」，多选直接用数组，后续逻辑两模式共用。 */
  const selected = useMemo<(string | number)[]>(() => {
    if (multiple) return Array.isArray(props.value) ? (props.value as (string | number)[]) : [];
    const v = props.value as string | number | null | undefined;
    return v == null || v === '' ? [] : [v];
  }, [multiple, props.value]);

  const selectedIds = useMemo(() => new Set(selected.map(String)), [selected]);

  /** 统一出口：单选回传标量（空 → null），多选回传数组。 */
  const emit = (next: (string | number)[]) => {
    if (props.multiple === true) {
      props.onChange(next);
    } else {
      props.onChange(next.length > 0 ? next[0] : null);
    }
  };

  // id → name 映射（触发器展示选中部门名 / chip 文案）
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

  // 并行拉各组织部门树 → 去掉穿透锚点整树 → 合并为顶级部门森林（无组织分组层）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    listOrgs()
      .then((list) => {
        if (!alive) return;
        const tasks = list.map((org) =>
          fetchDeptTree(org.id)
            .then((tree) => omitLinkedOrgSubtrees(tree))
            .catch(() => [] as DeptNode[]),
        );
        Promise.all(tasks).then((trees) => {
          if (!alive) return;
          setForest(trees.flatMap((tree) => toTreeItems(tree)));
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
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 点部门节点：单选 → 选中并关弹窗；多选 → 复选框语义增删。 */
  const handleNodeClick = (node: TreeItem) => {
    if (disabled) return;
    if (!multiple) {
      emit([node.id]);
      setOpen(false);
      return;
    }
    if (selectedIds.has(node.id)) {
      emit(selected.filter((v) => String(v) !== node.id));
    } else {
      emit([...selected, node.id]);
    }
  };

  const selectAll = () => {
    if (disabled) return;
    emit(collectSelectable(forest));
  };

  const clearAll = () => {
    if (disabled) return;
    emit([]);
  };

  const renderNodes = (nodes: TreeItem[], depth: number): ReactNode =>
    nodes.map((n) => {
      const hasChildren = !!n.children && n.children.length > 0;
      const isExpanded = expanded.has(n.id);
      const checked = selectedIds.has(n.id);
      return (
        <div key={n.id}>
          <div className={cn('flex items-center gap-1 rounded px-2 py-1', depth > 0 && 'ml-3')}>
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
            <button
              type="button"
              disabled={disabled}
              onClick={() => handleNodeClick(n)}
              className={cn(
                'flex flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-sm transition hover:bg-muted',
                checked && 'bg-primary/10 font-medium text-primary',
                disabled && 'cursor-not-allowed opacity-60',
              )}
              aria-pressed={checked}
            >
              {multiple ? (
                <span
                  className={cn(
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {checked ? <Check className="h-3 w-3" /> : null}
                </span>
              ) : null}
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{n.name}</span>
            </button>
          </div>
          {hasChildren && isExpanded ? <div>{renderNodes(n.children as TreeItem[], depth + 1)}</div> : null}
        </div>
      );
    });

  const singleName = multiple ? '' : idToName.get(String(selected[0] ?? '')) ?? '';
  const emptyText = placeholder || (multiple ? '请选择部门（可多选）' : '请选择部门（树形·单选）');

  return (
    <Popover modal open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            fieldInputClass,
            'flex items-center justify-between gap-2 text-left',
            disabled && 'cursor-not-allowed opacity-60',
            className,
          )}
        >
          {multiple ? (
            /* 已选 chip 单行裁切：不换行、超出直接隐藏（不滚动、不撑高组件） */
            <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden">
              {selected.length === 0 ? (
                <span className="truncate text-muted-foreground">{emptyText}</span>
              ) : (
                selected.map((v) => {
                  const key = String(v);
                  return (
                    <span
                      key={key}
                      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary/80"
                    >
                      {idToName.get(key) ?? key}
                    </span>
                  );
                })
              )}
            </span>
          ) : (
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                singleName ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {singleName || emptyText}
            </span>
          )}
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        {multiple ? (
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              disabled={disabled}
              className={cn(actionBtnClass, disabled && 'cursor-not-allowed opacity-60')}
            >
              全选
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={disabled}
              className={cn(actionBtnClass, disabled && 'cursor-not-allowed opacity-60')}
            >
              清空
            </button>
          </div>
        ) : (
          <div className="mb-2 text-xs font-medium text-muted-foreground">选择部门（单选）</div>
        )}
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
