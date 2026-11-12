import { useMemo, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * 通用分类下拉树多选组件。
 *
 * <p><b>通用性</b>：不写死任何数据源——树数据全部由 {@code tree} prop 传入，
 * 表单分类（{@code form_category}）与流程分类（{@code wf_category}）共用同一组件。
 *
 * <p><b>语义</b>（与用户确认一致）：勾选 N 个分类 ⇒ 只显示 {@code categoryId ∈ 勾选集合}
 * 的项（精确匹配、<b>不含子分类</b>，即集合 IN 的 OR）；不勾选 = 不过滤（全部分类）。
 *
 * <p><b>交互</b>：Popover 触发器（未选显示 placeholder，已选显示 chip 单行裁切）+ 面板内树
 * （展开/折叠、复选框多选、全选/清空、面板最大高度滚动）。动作按钮与节点采用
 * pointerdown/click 双触发处理，规避 Dialog/Sheet 的 dismiss 层 preventDefault 掉 click
 * 导致点击失效（键盘仍走 click，{@code detail === 0}）。
 */
export interface CategoryTreeNode {
  id: string | number;
  name: string;
  children?: CategoryTreeNode[] | null;
}

export interface CategoryTreeSelectProps {
  /** 分类树（嵌套 children），由调用方提供，组件不感知具体分类表。 */
  tree: CategoryTreeNode[];
  /** 当前选中的分类 id 数组（字符串形态，与分类树 id 归一化后比较）。 */
  value: string[];
  /** 选中集合变化时回传字符串 id 数组。 */
  onChange: (ids: string[]) => void;
  /** 未选任何分类时触发器显示的占位文案。 */
  placeholder?: string;
  /** 覆盖触发器样式（与同排控件对齐）。 */
  triggerClassName?: string;
  disabled?: boolean;
}

/** 与筛选栏下拉触发器对齐（对齐 dept-tree-select / filter-multi-select）。 */
const triggerClass =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-foreground shadow-none';

const actionBtnClass =
  'rounded border border-input px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50';

/** 递归收集整棵森林的所有节点 id（供「全选」使用，含已折叠子树）。 */
function collectIds(nodes: CategoryTreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(String(n.id));
    if (n.children?.length) collectIds(n.children, acc);
  }
  return acc;
}

/** 递归建立 id → name 映射（触发器 chip 文案）。 */
function buildNameMap(nodes: CategoryTreeNode[], map: Map<string, string>): Map<string, string> {
  for (const n of nodes) {
    map.set(String(n.id), n.name);
    if (n.children?.length) buildNameMap(n.children, map);
  }
  return map;
}

export function CategoryTreeSelect({
  tree,
  value,
  onChange,
  placeholder = '全部分类',
  triggerClassName,
  disabled = false,
}: CategoryTreeSelectProps) {
  const [open, setOpen] = useState(false);
  // 默认空集合 = 全收缩；仅当 expanded 含某节点 id 时才渲染其 children。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const selected = Array.isArray(value) ? value : [];
  const selectedIds = useMemo(() => new Set(selected.map(String)), [selected]);
  const idToName = useMemo(() => buildNameMap(tree, new Map<string, string>()), [tree]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleNode = (node: CategoryTreeNode) => {
    if (disabled) return;
    const key = String(node.id);
    if (selectedIds.has(key)) {
      onChange(selected.filter((v) => String(v) !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  const selectAll = () => {
    if (disabled) return;
    onChange(collectIds(tree));
  };

  const clearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  /** Dialog/Sheet 的 dismiss 层可能 preventDefault 掉 click；动作放在 pointerdown。键盘仍走 click（detail === 0）。 */
  const onActionPointerDown =
    (action: () => void) => (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      action();
    };
  const onActionClick = (action: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail !== 0) return;
    action();
  };

  const renderNodes = (nodes: CategoryTreeNode[], depth: number): ReactNode =>
    nodes.map((n) => {
      const hasChildren = !!n.children && n.children.length > 0;
      const isExpanded = expanded.has(String(n.id));
      const checked = selectedIds.has(String(n.id));
      return (
        <div key={String(n.id)}>
          <div className={cn('flex items-center gap-1 rounded px-1 py-0.5', depth > 0 && 'ml-3')}>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => !disabled && toggleExpand(String(n.id))}
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
              onPointerDown={onActionPointerDown(() => toggleNode(n))}
              onClick={onActionClick(() => toggleNode(n))}
              className={cn(
                'flex flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-sm transition hover:bg-muted',
                checked && 'bg-primary/10 font-medium text-primary',
                disabled && 'cursor-not-allowed opacity-60',
              )}
              aria-pressed={checked}
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
          </div>
          {hasChildren && isExpanded ? <div>{renderNodes(n.children as CategoryTreeNode[], depth + 1)}</div> : null}
        </div>
      );
    });

  return (
    <Popover modal open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            triggerClass,
            'flex items-center justify-between gap-2 text-left',
            disabled && 'cursor-not-allowed opacity-60',
            triggerClassName,
          )}
        >
          {/* 已选 chip 单行裁切：不换行、超出直接隐藏（不滚动、不撑高组件） */}
          <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden">
            {selected.length === 0 ? (
              <span className="truncate text-muted-foreground">{placeholder}</span>
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
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onPointerDown={onActionPointerDown(selectAll)}
            onClick={onActionClick(selectAll)}
            disabled={disabled || tree.length === 0}
            className={actionBtnClass}
          >
            全选
          </button>
          <button
            type="button"
            onPointerDown={onActionPointerDown(clearAll)}
            onClick={onActionClick(clearAll)}
            disabled={disabled || selected.length === 0}
            className={actionBtnClass}
          >
            清空
          </button>
        </div>
        {tree.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">暂无可选分类</div>
        ) : (
          <div className="max-h-64 overflow-auto rounded-md border border-border/60 p-1">{renderNodes(tree, 0)}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default CategoryTreeSelect;
