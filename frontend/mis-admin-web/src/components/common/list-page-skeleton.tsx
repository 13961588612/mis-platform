import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader, type BreadcrumbItem } from '@/components/common/page-header';
import { FormSheet } from '@/components/common/form-sheet';

export interface FilterField {
  key: string;
  label: string;
  placeholder?: string;
  span?: 2 | 3 | 4 | 6;
  type?: 'text' | 'select';
  options?: { label: string; value: string }[];
}

export interface StatusTabItem {
  key: string;
  label: string;
}

export interface ListColumn<T> {
  key: string;
  title: string;
  className?: string;
  render: (row: T, helpers: { openView: (row: T) => void }) => ReactNode;
}

interface ListPageSkeletonProps<T extends Record<string, unknown>> {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  filterFields?: FilterField[];
  statusTabs?: StatusTabItem[];
  columns: ListColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  actions?: ReactNode;
  emptyHint?: string;
  enableFormSheet?: boolean;
  formTitle?: string;
}

const SPAN_CLASS: Record<number, string> = {
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  6: 'md:col-span-6',
};

export function ListPageSkeleton<T extends Record<string, unknown>>({
  title,
  description,
  breadcrumbs,
  filterFields = [
    {
      key: 'org',
      label: '所属组织',
      span: 2,
      type: 'select',
      options: [
        { label: '全部', value: '' },
        { label: '运营中心', value: '运营中心' },
        { label: '研发中心', value: '研发中心' },
        { label: '数据中心', value: '数据中心' },
        { label: '行政部', value: '行政部' },
        { label: '市场部', value: '市场部' },
      ],
    },
    { key: 'keyword', label: '关键词搜索', placeholder: '输入名称 / 编号', span: 2 },
    { key: 'updatedAt', label: '更新时间', placeholder: '如 2026-07-18', span: 4 },
  ],
  statusTabs = [
    { key: 'all', label: '全部' },
    { key: 'enabled', label: '启用' },
    { key: 'disabled', label: '禁用' },
  ],
  columns,
  rows,
  rowKey,
  actions,
  emptyHint = '暂无数据（骨架演示）；接入 API 后替换为真实列表。',
  enableFormSheet = true,
  formTitle,
}: ListPageSkeletonProps<T>) {
  const [filterOpen, setFilterOpen] = useState(true);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [status, setStatus] = useState(statusTabs[0]?.key ?? 'all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'view'>('create');
  const [sheetValues, setSheetValues] = useState<Record<string, string>>({});

  const setCount = useMemo(
    () => Object.values(applied).filter((v) => v.trim().length > 0).length,
    [applied],
  );

  const filtered = useMemo(() => {
    let list = rows;
    const kw = applied.keyword?.trim();
    const org = applied.org?.trim();
    const updatedAt = applied.updatedAt?.trim();
    if (kw) {
      list = list.filter((row) =>
        Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(kw.toLowerCase())),
      );
    }
    if (org) list = list.filter((row) => String(row.org ?? '') === org);
    if (updatedAt) list = list.filter((row) => String(row.updatedAt ?? '').includes(updatedAt));
    if (status !== 'all') {
      list = list.filter((row) => String(row.statusKey ?? row.status ?? '') === status);
    }
    return list;
  }, [rows, applied, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const pageNumbers = useMemo(() => {
    const nums: number[] = [];
    let start = Math.max(1, safePage - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i += 1) nums.push(i);
    return nums;
  }, [safePage, totalPages]);

  const openCreate = () => {
    setSheetMode('create');
    setSheetValues({});
    setSheetOpen(true);
  };

  const openView = (row: T) => {
    setSheetMode('view');
    setSheetValues({
      name: String(row.name ?? ''),
      org: String(row.org ?? ''),
      status: String(row.statusKey ?? ''),
      remark: String(row.id ?? ''),
    });
    setSheetOpen(true);
  };

  const helpers = { openView };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        className="mb-4 shrink-0"
        title={title}
        description={description}
        breadcrumbs={breadcrumbs}
        actions={
          actions ?? (
            <Button type="button" size="sm" onClick={enableFormSheet ? openCreate : undefined}>
              新建
            </Button>
          )
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-3 shrink-0 overflow-hidden rounded-lg border bg-card shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">筛选条件</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs',
                  setCount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                已设置 {setCount} 项条件
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setApplied({ ...draft });
                  setPage(1);
                }}
              >
                <Search className="h-3.5 w-3.5" />
                搜索
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft({});
                  setApplied({});
                  setPage(1);
                }}
              >
                重置
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label="折叠筛选"
                onClick={() => setFilterOpen((v) => !v)}
              >
                <ChevronDown className={cn('h-4 w-4 transition', filterOpen && 'rotate-180')} />
              </Button>
            </div>
          </div>
          {filterOpen ? (
            <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-12">
              {filterFields.map((field) => (
                <div
                  key={field.key}
                  className={cn('space-y-1.5', SPAN_CLASS[field.span ?? 2] ?? 'md:col-span-2')}
                >
                  <Label htmlFor={`f-${field.key}`} className="text-xs text-muted-foreground">
                    {field.label}
                  </Label>
                  {field.type === 'select' ? (
                    <select
                      id={`f-${field.key}`}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={draft[field.key] ?? ''}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    >
                      {(field.options ?? [{ label: '全部', value: '' }]).map((opt) => (
                        <option key={opt.value || 'all'} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={`f-${field.key}`}
                      placeholder={field.placeholder}
                      value={draft[field.key] ?? ''}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <nav className="mb-3 flex shrink-0 items-center gap-6 overflow-x-auto border-b border-border">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={cn(
                'border-b-2 pb-2 text-sm transition',
                status === tab.key
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => {
                setStatus(tab.key);
                setPage(1);
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-card">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted/80 text-left text-sm font-semibold text-muted-foreground backdrop-blur">
                <tr>
                  {columns.map((col) => (
                    <th key={col.key} className={cn('px-4 py-3 font-semibold', col.className)}>
                      {col.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground">
                      {emptyHint}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => (
                    <tr
                      key={rowKey(row)}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                      onClick={() => enableFormSheet && openView(row)}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={cn('px-4 py-3', col.className)}
                          onClick={(e) => {
                            if (col.key === 'actions') e.stopPropagation();
                          }}
                        >
                          {col.render(row, helpers)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-3 py-2.5 text-sm">
            <div className="text-muted-foreground">
              共 <b className="text-foreground">{filtered.length}</b> 条 · 第 {safePage}/{totalPages} 页
            </div>
            <div className="flex items-center gap-1">
              <PagerBtn disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ‹
              </PagerBtn>
              {pageNumbers.map((n) => (
                <PagerBtn key={n} active={n === safePage} onClick={() => setPage(n)}>
                  {n}
                </PagerBtn>
              ))}
              <PagerBtn
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                ›
              </PagerBtn>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <label htmlFor="page-size">每页</label>
              <select
                id="page-size"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {enableFormSheet ? (
        <FormSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          mode={sheetMode}
          title={sheetMode === 'create' ? `新建${formTitle ?? title}` : `${formTitle ?? title}详情`}
          initialValues={sheetValues}
        />
      ) : null}
    </div>
  );
}

function PagerBtn({
  children,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm transition',
        active
          ? 'border-primary bg-primary font-semibold text-primary-foreground'
          : 'border-transparent hover:bg-muted/60',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

export function buildDemoRows(prefix: string, count = 23) {
  const orgs = ['运营中心', '研发中心', '数据中心', '行政部', '市场部'];
  const statuses = [
    { statusKey: 'enabled', statusText: '启用', tone: 'success' as const },
    { statusKey: 'disabled', statusText: '禁用', tone: 'destructive' as const },
    { statusKey: 'locked', statusText: '锁定', tone: 'warning' as const },
  ];
  return Array.from({ length: count }, (_, i) => {
    const st = statuses[i % statuses.length];
    return {
      id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
      name: `${prefix} 演示记录 ${i + 1}`,
      org: orgs[i % orgs.length],
      statusKey: st.statusKey,
      statusText: st.statusText,
      tone: st.tone,
      updatedAt: `2026-07-${String(18 - (i % 3)).padStart(2, '0')} ${String(9 + (i % 8)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
    };
  });
}

export function StatusBadge({
  text,
  tone,
}: {
  text: string;
  tone: 'success' | 'warning' | 'destructive' | 'info';
}) {
  const toneClass = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
  }[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClass,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}
