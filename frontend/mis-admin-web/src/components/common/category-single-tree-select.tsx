import { useMemo, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CategoryTreeNode } from './category-tree-select';

/**
 * 通用分类下拉树**单选**组件（与 {@link CategoryTreeSelect} 多选版配套）。
 *
 * <p><b>通用性</b>：不写死任何数据源——树数据全部由 {@code tree} prop 传入，
 * 表单分类（{@code form_definition.category_id}）与流程分类（{@code wf_definition.category_id}）
 * 共用同一组件（两者都改为「选一个业务分类」）。
 *
 * <p><b>与多选版的差异</b>：
 * <ul>
 *   <li>值语义：{@code value: string | null}（`null` = 未分类），回调 {@code onChange(string | null)}；</li>
 *   <li>交互：**无复选框**，点击某节点即选中并**关闭**面板；再次点击同一节点保持选中；</li>
 *   <li>面板顶部提供「清除」动作，把选择置回未分类（{@code onChange(null)}）。</li>
 * </ul>
 *
 * <p><b>允许选任意节点</b>（不限制只能选叶子）：业务分类是邻接树，流程 / 表单可挂到任意层级。
 *
 * <p><b>Dialog/Sheet 点击失效坑</b>：Popover 嵌在 Radix Dialog 里时 dismiss 层可能
 * preventDefault 掉 click，故节点与「清除」按钮沿用 {@code pointerdown} + {@code click}
 * （{@code detail === 0}）双触发范式（与 {@code category-tree-select.tsx} 一致）。
 *
 * <p><b>必须用 modal Popover</b>：与 {@code category-tree-select.tsx} 一致——触发按钮依赖
 * Radix PopoverTrigger 内部的 onOpenToggle（onClick）开合。经实测：**非 modal** 的 Popover
 * 嵌进 Radix Dialog 时，Dialog 的非模态 dismiss 层会拦截触发器的 click，导致面板**打不开**；
 * 而 **modal** Popover 在 Dialog 内可正常开合（BareVariant 复现验证）。
 */
export interface CategorySingleTreeSelectProps {
  /** 分类树（嵌套 children），由调用方提供，组件不感知具体分类表。 */
  tree: CategoryTreeNode[];
  /** 当前选中的分类 id（字符串形态，与分类树 id 归一化后比较）；`null` = 未分类。 */
  value: string | null;
  /** 选中项变化时回传字符串 id（清除时回传 `null`）。 */
  onChange: (id: string | null) => void;
  /** 未选任何分类时触发器显示的占位文案。 */
  placeholder?: string;
  /** 覆盖触发器样式（与同排控件对齐）。 */
  triggerClassName?: string;
  disabled?: boolean;
  /**
   * 当前值不在 {@code tree} 中时的兜底展示文案（如「分类#123」）。
   * 用于编辑历史数据：分类被删/跨租户时，至少不丢失已选值显示。
   */
  fallbackLabel?: string | null;
  /** 触发器 id（供 {@code <label htmlFor>} 关联）。 */
  id?: string;
  /** 触发器 aria-label（供测试与无障碍按名查询）。 */
  ariaLabel?: string;
}

/** 与筛选栏下拉触发器对齐（对齐 dept-tree-select / category-tree-select）。 */
const triggerClass =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-foreground shadow-none';

const actionBtnClass =
  'rounded border border-input px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50';

/** 递归建立 id → name 映射（触发器文案）。 */
function buildNameMap(nodes: CategoryTreeNode[], map: Map<string, string>): Map<string, string> {
  for (const n of nodes) {
    map.set(String(n.id), n.name);
    if (n.children?.length) buildNameMap(n.children, map);
  }
  return map;
}

export function CategorySingleTreeSelect({
  tree,
  value,
  onChange,
  placeholder = '未分类',
  triggerClassName,
  disabled = false,
  fallbackLabel = null,
  id,
  ariaLabel,
}: CategorySingleTreeSelectProps) {
  const [open, setOpen] = useState(false);
  // 默认空集合 = 全收缩；仅当 expanded 含某节点 id 时才渲染其 children。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const selectedKey = value == null ? null : String(value);
  const idToName = useMemo(() => buildNameMap(tree, new Map<string, string>()), [tree]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** 选中某节点：回传其 id 并关闭面板（单选语义，不 toggle）。 */
  const selectNode = (node: CategoryTreeNode) => {
    if (disabled) return;
    onChange(String(node.id));
    setOpen(false);
  };

  /** 清除选择：回传 null（未分类）并关闭面板。 */
  const clearSelection = () => {
    if (disabled) return;
    onChange(null);
    setOpen(false);
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
      const key = String(n.id);
      const hasChildren = !!n.children && n.children.length > 0;
      const isExpanded = expanded.has(key);
      const isSelected = selectedKey === key;
      return (
        <div key={key}>
          <div className={cn('flex items-center gap-1 rounded px-1 py-0.5', depth > 0 && 'ml-3')}>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => !disabled && toggleExpand(key)}
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
              onPointerDown={onActionPointerDown(() => selectNode(n))}
              onClick={onActionClick(() => selectNode(n))}
              className={cn(
                'flex flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-sm transition hover:bg-muted',
                isSelected && 'bg-primary/10 font-medium text-primary',
                disabled && 'cursor-not-allowed opacity-60',
              )}
              aria-pressed={isSelected}
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{n.name}</span>
              {isSelected ? <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" /> : null}
            </button>
          </div>
          {hasChildren && isExpanded ? (
            <div>{renderNodes(n.children as CategoryTreeNode[], depth + 1)}</div>
          ) : null}
        </div>
      );
    });

  const triggerText =
    selectedKey == null
      ? placeholder
      : idToName.get(selectedKey) ?? fallbackLabel ?? selectedKey;

  return (
    <Popover modal open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            triggerClass,
            'flex items-center justify-between gap-2 text-left',
            disabled && 'cursor-not-allowed opacity-60',
            triggerClassName,
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              selectedKey == null && 'text-muted-foreground',
            )}
          >
            {triggerText}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onPointerDown={onActionPointerDown(clearSelection)}
            onClick={onActionClick(clearSelection)}
            disabled={disabled || selectedKey == null}
            className={actionBtnClass}
          >
            清除
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

export default CategorySingleTreeSelect;
