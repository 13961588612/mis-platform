import { useMemo, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KbCategory } from '../types';

/**
 * 分类树（知识库域一期，T04）。
 *
 * <p>分类从「两级」加深为「任意层级」：本组件承载递归树的扁平化、展开/折叠、
 * 层级缩进与父级下拉选项构造。页面表格只消费 {@link flattenCategoryTree} 产出的
 * 扁平行，名称列由 {@link CategoryTreeCell} 渲染展开/折叠按钮 + 缩进 + 管辖标记。
 *
 * <p><b>口径约定</b>（与后端 {@code NodeAdminResolver} 一致）：
 * <ul>
 *   <li>管辖 = 本人能管理的节点（授权节点的子树并集；全局管理员 = 全量）；</li>
 *   <li>「只看管辖」只过滤展示，不改变数据结构——折叠/展开状态与原始树完全一致；</li>
 *   <li>孤儿节点（父 id 指向不存在的节点）一律按根渲染，不丢数据。</li>
 * </ul>
 */

/** 扁平化后的树行。 */
export interface FlatCategoryRow {
  category: KbCategory;
  depth: number;
}

/** 父级下拉选项（完整树，preorder，缩进前缀在渲染侧处理）。 */
export interface CategoryOption {
  id: number;
  name: string;
  depth: number;
}

/**
 * 把分类树递归扁平化为「带深度」的行列表。
 *
 * <p>展开/折叠由 {@code expanded} 控制：未展开的节点只渲染自身、不渲染其后代；
 * 折叠节点的后代一旦展开会重新出现，状态与用户操作一一对应。
 *
 * <p>孤儿保护：父 id 指向不存在节点时按根节点渲染；父节点被折叠时，其后代
 * 自然不渲染（这是折叠语义的一部分，不是数据丢失）。
 *
 * @param list     全量分类（一次拉全，无分页）
 * @param expanded 已展开的节点 id 集合；含子节点的节点未在集合中 = 折叠
 */
export function flattenCategoryTree(
  list: KbCategory[],
  expanded: ReadonlySet<number>,
): FlatCategoryRow[] {
  if (list.length === 0) return [];

  const ids = new Set(list.map((c) => c.id));
  const byParent = new Map<number | null, KbCategory[]>();
  for (const c of list) {
    // 孤儿节点（父不存在）归到根层级
    const key = c.parentId != null && ids.has(c.parentId) ? c.parentId : null;
    const arr = byParent.get(key) ?? [];
    arr.push(c);
    byParent.set(key, arr);
  }
  const sortBySortThenId = (a: KbCategory, b: KbCategory): number =>
    (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id;

  const out: FlatCategoryRow[] = [];
  const walk = (parentKey: number | null, depth: number): void => {
    const children = (byParent.get(parentKey) ?? []).slice().sort(sortBySortThenId);
    for (const c of children) {
      out.push({ category: c, depth });
      if (expanded.has(c.id)) {
        walk(c.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return out;
}

/**
 * 构造「上级分类」下拉选项（完整树，任意层级，preorder）。
 *
 * <p>用于新增/编辑分类表单的父级下拉：任意层级的节点都可作为父节点
 * （后端仅校验管辖，不限制层级）。
 *
 * @param list     全量分类
 * @param disabledNodeId 需要禁用的节点 id（编辑时禁止选自己/自己的后代）；null 不禁用
 */
export function buildCategoryOptions(
  list: KbCategory[],
  disabledNodeId: number | null = null,
): CategoryOption[] {
  if (list.length === 0) return [];

  const ids = new Set(list.map((c) => c.id));
  const byParent = new Map<number | null, KbCategory[]>();
  for (const c of list) {
    const key = c.parentId != null && ids.has(c.parentId) ? c.parentId : null;
    const arr = byParent.get(key) ?? [];
    arr.push(c);
    byParent.set(key, arr);
  }
  const sortBySortThenId = (a: KbCategory, b: KbCategory): number =>
    (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id;

  const excluded = disabledNodeId != null ? descendantIds(list, disabledNodeId) : new Set<number>();
  const out: CategoryOption[] = [];
  const walk = (parentKey: number | null, depth: number): void => {
    const children = (byParent.get(parentKey) ?? []).slice().sort(sortBySortThenId);
    for (const c of children) {
      if (!excluded.has(c.id)) {
        out.push({ id: c.id, name: c.name, depth });
        walk(c.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return out;
}

/**
 * 收集某节点的全部后代 id（不含自身）。
 *
 * <p>移动目标排除、编辑父级排除都用它：目标若在集合内 = 自己后代 = 构成环。
 */
export function descendantIds(list: KbCategory[], nodeId: number): Set<number> {
  const ids = new Set(list.map((c) => c.id));
  const byParent = new Map<number | null, KbCategory[]>();
  for (const c of list) {
    const key = c.parentId != null && ids.has(c.parentId) ? c.parentId : null;
    const arr = byParent.get(key) ?? [];
    arr.push(c);
    byParent.set(key, arr);
  }
  const result = new Set<number>();
  const stack: number[] = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const child of byParent.get(cur) ?? []) {
      if (!result.has(child.id)) {
        result.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return result;
}

/** 初始化展开集合：默认全部展开（含子节点的节点都在集合中）。 */
export function initialExpandedSet(list: KbCategory[]): Set<number> {
  const ids = new Set(list.map((c) => c.id));
  const parents = new Set<number>();
  for (const c of list) {
    if (c.parentId != null && ids.has(c.parentId)) {
      parents.add(c.parentId);
    }
  }
  return parents;
}

interface CategoryTreeCellProps {
  category: KbCategory;
  depth: number;
  /** 是否展开（有子节点时才有意义） */
  expanded: boolean;
  hasChildren: boolean;
  /** 点击展开/折叠 */
  onToggle: () => void;
  /** 是否在本人管辖内（高亮） */
  manageable: boolean;
  /** 名称渲染（默认纯文本；可传自定义内容） */
  renderName?: (category: KbCategory) => ReactNode;
}

/**
 * 树名称单元格：展开/折叠按钮 + 层级缩进 + 管辖标记 + 名称。
 *
 * <p>页面表格的名称列统一用它，保证缩进/展开交互在全站一致。
 */
export function CategoryTreeCell({
  category,
  depth,
  expanded,
  hasChildren,
  onToggle,
  manageable,
  renderName,
}: CategoryTreeCellProps) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ paddingLeft: `${depth * 1.25}rem` }}>
      {hasChildren ? (
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onToggle}
          aria-label={expanded ? '收起' : '展开'}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="w-[1.375rem] shrink-0" />
      )}
      <span
        className={cn(
          'truncate',
          manageable ? 'font-medium text-primary' : 'text-foreground',
        )}
        title={category.name}
      >
        {renderName ? renderName(category) : category.name}
      </span>
      {manageable ? (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.6875rem] leading-none text-primary">
          可管
        </span>
      ) : null}
    </span>
  );
}

/** 从全量分类构造 id→节点 的映射（供行渲染快速取用）。 */
export function useCategoryMap(list: KbCategory[]): Map<number, KbCategory> {
  return useMemo(() => {
    const map = new Map<number, KbCategory>();
    for (const c of list) map.set(c.id, c);
    return map;
  }, [list]);
}
