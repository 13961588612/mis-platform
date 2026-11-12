import type { ReactNode } from 'react';
import { Folder, FolderOpen, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CategoryTreeNode } from '@/components/common/category-tree-select';
import type { IqdSqlPairCategory } from '@/lib/api/iqd';

/** 左侧树选中：全部 | 未分类 | 具体分类 id（字符串）。 */
export type SqlPairCategorySelection = 'all' | 'uncategorized' | string;

export interface SqlPairCategoryTreeProps {
  tree: IqdSqlPairCategory[];
  selected: SqlPairCategorySelection;
  onSelect: (sel: SqlPairCategorySelection) => void;
  loading?: boolean;
}

/**
 * 同级按分类编号 {@code code} 排序（自然序：1 &lt; 2 &lt; 10）；递归处理子节点。
 * 「全部样本 / 未分类」为虚拟节点，不参与本排序。
 */
export function sortSqlPairCategoriesByCode(
  nodes: IqdSqlPairCategory[] | undefined | null,
): IqdSqlPairCategory[] {
  if (!nodes?.length) return [];
  return [...nodes]
    .map((n) => ({
      ...n,
      children: n.children?.length ? sortSqlPairCategoriesByCode(n.children) : n.children,
    }))
    .sort((a, b) =>
      String(a.code ?? '').localeCompare(String(b.code ?? ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );
}

/**
 * 样本对分类树（enhance 页 sqlpair Tab 左侧）。
 *
 * <p>虚拟节点：「全部样本」清空筛选；「未分类」对应 {@code category_id IS NULL}。
 * 真实分类同级按编号排序。
 */
export function SqlPairCategoryTree({
  tree,
  selected,
  onSelect,
  loading,
}: SqlPairCategoryTreeProps) {
  const sorted = sortSqlPairCategoriesByCode(tree);
  return (
    <div className="space-y-0.5">
      <TreeButton
        active={selected === 'all'}
        onClick={() => onSelect('all')}
        icon={<Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
        label="全部样本"
      />
      <TreeButton
        active={selected === 'uncategorized'}
        onClick={() => onSelect('uncategorized')}
        icon={<Inbox className="h-4 w-4 shrink-0 text-muted-foreground" />}
        label="未分类"
        pad={0}
      />

      {loading && sorted.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted-foreground">加载中…</p>
      ) : sorted.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted-foreground">暂无分类</p>
      ) : (
        <TreeLevel nodes={sorted} depth={0} selected={selected} onSelect={onSelect} />
      )}
    </div>
  );
}

interface TreeLevelProps {
  nodes: IqdSqlPairCategory[];
  depth: number;
  selected: SqlPairCategorySelection;
  onSelect: (sel: SqlPairCategorySelection) => void;
}

function TreeLevel({ nodes, depth, selected, onSelect }: TreeLevelProps) {
  return (
    <>
      {nodes.map((node) => {
        const id = String(node.id);
        const active = selected === id;
        return (
          <div key={node.id}>
            <TreeButton
              active={active}
              onClick={() => onSelect(id)}
              pad={depth}
              icon={
                active ? (
                  <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                )
              }
              label={node.name}
              code={node.code}
            />
            {node.children?.length ? (
              <TreeLevel
                nodes={node.children}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function TreeButton({
  active,
  onClick,
  icon,
  label,
  code,
  pad = 0,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  code?: string;
  pad?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ paddingLeft: 8 + pad * 14 }}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition-colors',
        active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-accent',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {code ? (
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{code}</span>
      ) : null}
    </button>
  );
}

/** 将嵌套分类树转为 CategorySingleTreeSelect 节点（同级按编号）。 */
export function toCategoryTreeSelectNodes(tree: IqdSqlPairCategory[]): CategoryTreeNode[] {
  return sortSqlPairCategoriesByCode(tree).map((n) => ({
    id: String(n.id),
    name: n.name,
    children: n.children?.length ? toCategoryTreeSelectNodes(n.children) : undefined,
  }));
}

/** 选中态 → API categoryId（undefined=全部；0=未分类）。 */
export function selectionToCategoryId(sel: SqlPairCategorySelection): number | undefined {
  if (sel === 'all') return undefined;
  if (sel === 'uncategorized') return 0;
  const n = Number(sel);
  return Number.isFinite(n) ? n : undefined;
}
