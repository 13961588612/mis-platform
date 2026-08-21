/**
 * DataTable — A2UI `data-table` 组件（shadcn + TanStack Table，T06'）。
 *
 * <p>P1 采纳 `@tanstack/react-table`（04-open-source-reuse.md §2 建议 1：免自研分页/排序/列模型，
 * shadcn 官方 data-table 模式）。渲染权限：默认可见（只读展示）。
 *
 * <p>UI 规范：表格吸顶 min-h-0 flex-1 overflow-auto 单层滚动，禁 sticky th backdrop-blur；
 * 圆角 4px、表头 13px、列间竖线 border-l border-border/60。
 */

import { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { A2uiComponentProps } from '@/lib/a2ui/types';

interface ColumnSpec {
  key: string;
  label?: string;
}

interface Row {
  [key: string]: unknown;
}

export function DataTable({ props }: A2uiComponentProps) {
  const title = typeof props.title === 'string' ? props.title : '';
  const columns = useMemo<ColumnSpec[]>(() => {
    if (!Array.isArray(props.columns)) return [];
    return (props.columns as Array<string | ColumnSpec>).map((c) =>
      typeof c === 'string' ? { key: c, label: c } : { key: c.key, label: c.label ?? c.key },
    );
  }, [props.columns]);

  const rows = useMemo<Row[]>(() => {
    if (!Array.isArray(props.rows)) return [];
    return props.rows.filter((r): r is Row => r != null && typeof r === 'object');
  }, [props.rows]);

  const keys = useMemo<string[]>(() => {
    if (columns.length > 0) return columns.map((c) => c.key);
    if (rows.length > 0) return Object.keys(rows[0]);
    return [];
  }, [columns, rows]);

  const columnDefs = useMemo<ColumnDef<Row>[]>(
    () =>
      keys.map((key) => {
        const spec = columns.find((c) => c.key === key);
        return {
          accessorKey: key,
          header: spec?.label ?? key,
          cell: ({ getValue }) => renderCell(getValue()),
        };
      }),
    [keys, columns],
  );

  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  return (
    <div className="my-2 w-full overflow-hidden rounded-lg border bg-card shadow-none">
      {title ? (
        <div className="border-b px-3 py-2 text-[13px] font-medium text-foreground">{title}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id}>
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-50" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={keys.length} className="h-16 text-center text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {rows.length > 10 ? (
        <div className="flex items-center justify-between border-t px-3 py-1.5">
          <div className="text-xs text-muted-foreground">
            共 {rows.length} 条 · 第 {table.getState().pagination.pageIndex + 1} /{' '}
            {Math.max(1, table.getPageCount())} 页
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 单元格值渲染（对象/数组 → JSON 摘要，其它 → String）。 */
function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export default DataTable;
