/**
 * DataTable — A2UI `data-table` 组件（shadcn + TanStack Table，T06'）。
 *
 * <p>P1 采纳 `@tanstack/react-table`（04-open-source-reuse.md §2 建议 1：免自研分页/排序/列模型，
 * shadcn 官方 data-table 模式）。渲染权限：默认可见（只读展示）。
 *
 * <p>UI 规范：外层横滚、列 min-width + nowrap，避免窄气泡内多列挤成一团；
 * 单行且列数 ≥ {@link PROFILE_COLUMN_THRESHOLD} 时改渲染为键值详情卡（CRM 会员档案等）。
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
import { cn } from '@/lib/utils';
import type { A2uiComponentProps } from '@/lib/a2ui/types';

interface ColumnSpec {
  key: string;
  label?: string;
}

interface Row {
  [key: string]: unknown;
}

/** 单行且达到该列数时，改为键值详情卡（避免宽表在对话气泡里挤扁）。 */
const PROFILE_COLUMN_THRESHOLD = 8;

/** 表头/单元格最小列宽（按内容撑开 + 外层横滚）。 */
const COL_MIN_WIDTH_CLASS = 'min-w-[5.5rem]';

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

  const labelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columns) {
      map.set(col.key, col.label ?? col.key);
    }
    return map;
  }, [columns]);

  const columnDefs = useMemo<ColumnDef<Row>[]>(
    () =>
      keys.map((key) => ({
        accessorKey: key,
        header: labelByKey.get(key) ?? key,
        cell: ({ getValue }) => <CellDisplay value={getValue()} />,
      })),
    [keys, labelByKey],
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

  // LLM 常为「确认清单」误插空 data-table（仅有 columns、无 rows），
  // 会在对话里留下大块「暂无数据」空白；无行时不渲染。
  if (rows.length === 0) {
    return null;
  }

  // 单对象宽字段（如 CRM 会员档案）：键值详情卡比横向宽表更易读。
  if (rows.length === 1 && keys.length >= PROFILE_COLUMN_THRESHOLD) {
    return (
      <ProfileDetailCard
        title={title}
        fields={keys.map((key) => ({
          key,
          label: labelByKey.get(key) ?? key,
          value: formatCellValue(rows[0][key]),
        }))}
      />
    );
  }

  return (
    <div className="my-2 w-full max-w-full rounded-lg border bg-card shadow-none">
      {title ? (
        <div className="border-b px-3 py-2 text-[13px] font-medium text-foreground">{title}</div>
      ) : null}
      <div className="max-w-full overflow-x-auto">
        <Table className="w-max min-w-full table-auto">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(COL_MIN_WIDTH_CLASS, 'whitespace-nowrap')}
                    >
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
                    <TableCell
                      key={cell.id}
                      className={cn(COL_MIN_WIDTH_CLASS, 'whitespace-nowrap align-top')}
                    >
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

/** 单行宽字段 → 字段名 / 值两列详情卡。 */
function ProfileDetailCard({
  title,
  fields,
}: {
  title: string;
  fields: Array<{ key: string; label: string; value: string }>;
}) {
  return (
    <div className="my-2 w-full max-w-full overflow-hidden rounded-lg border bg-card shadow-none">
      {title ? (
        <div className="border-b px-3 py-2 text-[13px] font-medium text-foreground">{title}</div>
      ) : null}
      <dl className="divide-y divide-border/60">
        {fields.map((field) => (
          <div
            key={field.key}
            className="grid grid-cols-[minmax(5.5rem,8.5rem)_minmax(0,1fr)] gap-x-3 px-3 py-2"
          >
            <dt className="text-[13px] leading-relaxed text-muted-foreground">{field.label}</dt>
            <dd
              className="break-words text-[13px] leading-relaxed text-foreground"
              title={field.value.length > 80 ? field.value : undefined}
            >
              {field.value || '—'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 单元格展示：长文本截断 + title 悬停全文。 */
function CellDisplay({ value }: { value: unknown }) {
  const text = formatCellValue(value);
  if (!text) return null;
  return (
    <span
      className="block max-w-[14rem] truncate"
      title={text.length > 24 ? text : undefined}
    >
      {text}
    </span>
  );
}

/** 单元格值格式化（对象/数组 → 紧凑 JSON，其它 → String）。 */
function formatCellValue(value: unknown): string {
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
