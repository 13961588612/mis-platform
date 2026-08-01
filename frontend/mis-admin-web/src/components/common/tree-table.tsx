import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 树表行必须携带的字段：稳定 id 与层级深度 */
export interface TreeTableNode {
  id: string | number;
  depth: number;
}

export interface TreeTableColumn<T extends TreeTableNode> {
  key: string;
  header: ReactNode;
  /** 单元格渲染；treeColumnKey 对应的列会额外包裹缩进 + 前导图标 */
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

export interface TreeTableProps<T extends TreeTableNode> {
  rows: T[];
  columns: TreeTableColumn<T>[];
  /** 渲染层级缩进 + 前导图标的列（通常是第一列 / 名称列） */
  treeColumnKey: string;
  /** 每行前导图标，如分支用文件夹、叶子用方法彩色徽章 */
  rowIcon?: (row: T) => ReactNode;
  /** 行内操作（默认 hover 显隐）：编辑 / 删除等 */
  rowActions?: (row: T) => ReactNode;
  /** 行操作是否始终可见；默认 false（hover 显隐）。部门管理等需常显时传 true */
  actionsAlwaysVisible?: boolean;
  rowClassName?: (row: T) => string | undefined;
  /** 行点击（可选，如选中该行） */
  onRowClick?: (row: T) => void;
  /** 空数据文案 */
  emptyText?: string;
  /** 每层级缩进像素，默认 16 */
  indentSize?: number;
  className?: string;
}

/**
 * 树表（TreeTable）
 * ───────────────────────────────────────────────
 * 用途：把「扁平化 + 带 depth 的树节点」渲染成可看出层级的表格，
 * 替代「中间平铺表格」与「右侧独立树」两份重复呈现。
 *
 * 数据约定：调用方先把树 `flatten(nodes)` 成 `{ id, depth, ...node }[]`，
 * 组件按 `depth * indentSize` 给 treeColumn 单元格加左缩进，并渲染 `rowIcon`。
 *
 * 对齐规范：表头与单元格靠左（可逐列覆盖 align）；操作列靠右且 hover 显隐。
 */
export function TreeTable<T extends TreeTableNode>({
  rows,
  columns,
  treeColumnKey,
  rowIcon,
  rowActions,
  actionsAlwaysVisible = false,
  rowClassName,
  onRowClick,
  emptyText = '暂无数据',
  indentSize = 16,
  className,
}: TreeTableProps<T>) {
  return (
    <table className={cn('min-h-full w-full border-collapse bg-table-surface text-sm', className)}>
      <thead className="sticky top-0 z-10 border-b bg-table-stripe text-left text-sm font-bold text-muted-foreground backdrop-blur">
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              className={cn(
                'px-2 py-1.5 font-bold',
                col.align === 'right' && 'text-right',
                col.align === 'center' && 'text-center',
                col.className,
              )}
            >
              {col.header}
            </th>
          ))}
          {rowActions ? <th className="px-2 py-1.5 text-right font-bold">操作</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={columns.length + (rowActions ? 1 : 0)}
              className="px-2 py-6 text-center text-muted-foreground"
            >
              {emptyText}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'group border-b border-border/50 last:border-0 even:bg-table-stripe hover:bg-table-hover',
                onRowClick && 'cursor-pointer',
                rowClassName?.(row),
              )}
            >
              {columns.map((col) => {
                const isTree = col.key === treeColumnKey;
                return (
                  <td
                    key={col.key}
                    className={cn(
                      'px-2 py-1.5',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      col.className,
                    )}
                  >
                    {isTree ? (
                      <span
                        className="inline-flex items-center gap-1.5"
                        style={{ paddingLeft: row.depth * indentSize }}
                      >
                        {rowIcon?.(row)}
                        {col.cell(row)}
                      </span>
                    ) : (
                      col.cell(row)
                    )}
                  </td>
                );
              })}
              {rowActions ? (
                <td className="px-2 py-1.5 text-right">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1',
                      !actionsAlwaysVisible && 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    {rowActions(row)}
                  </span>
                </td>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
