import { useMemo, useState, type ReactNode } from 'react';
import { Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { AdminField, AdminPageDef } from './types';
import { SYSTEM_PAGE_DEFS } from './page-defs';

const COL: Record<number, string> = {
  2: 'col-span-1',
  3: 'col-span-1',
  4: 'col-span-1',
  6: 'col-span-1',
  12: 'col-span-2',
};

type SheetMode = 'create' | 'edit' | 'view';

function statusTone(status: unknown): 'success' | 'warning' | 'destructive' | 'info' {
  if (status === 1) return 'success';
  if (status === 2) return 'warning';
  return 'destructive';
}

function optionLabel(field: AdminField, value: unknown) {
  const hit = field.options?.find((o) => String(o.value) === String(value));
  return hit?.label ?? (value == null || value === '' ? '—' : String(value));
}

function detailValue(field: AdminField, value: unknown): string {
  if (field.type === 'switch') return value === 1 || value === true ? '启用' : '禁用';
  if (field.type === 'select') return optionLabel(field, value);
  if (value == null || value === '') return '—';
  return String(value);
}

/** 对齐门户 sa-app：field-label .875rem/500；input .875rem + padding .55/.7 */
const fieldLabelClass = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const fieldInputClass =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-foreground shadow-none';

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: AdminField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <label className={fieldLabelClass}>
      {field.label}
      {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
    </label>
  );

  if (field.type === 'switch') {
    const on = value === 1 || value === true;
    return (
      <div className="min-w-0 self-start">
        {label}
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <button
            type="button"
            role="switch"
            aria-checked={on}
            className={cn(
              'relative h-5 w-9 shrink-0 rounded-full transition',
              on ? 'bg-primary' : 'bg-muted-foreground/40',
            )}
            onClick={() => onChange(on ? 0 : 1)}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition',
                on && 'translate-x-4',
              )}
            />
          </button>
          <span>{on ? '启用' : '禁用'}</span>
        </label>
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div className="min-w-0 self-start">
        {label}
        <select
          className={fieldInputClass}
          value={value == null ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            const opt = field.options?.find((o) => String(o.value) === raw);
            onChange(opt ? opt.value : raw);
          }}
        >
          <option value="">请选择</option>
          {(field.options ?? []).map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="min-w-0 self-start">
        {label}
        <textarea
          className="min-h-[4.5rem] w-full resize-y rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm leading-normal text-foreground"
          placeholder={field.placeholder}
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 self-start">
      {label}
      <Input
        className={fieldInputClass}
        type={field.type === 'number' ? 'number' : 'text'}
        placeholder={field.placeholder}
        value={value == null ? '' : String(value)}
        onChange={(e) =>
          onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)
        }
      />
    </div>
  );
}

export function AdminListPage({ def }: { def: AdminPageDef }) {
  const [rows, setRows] = useState(() => def.sample.map((r) => ({ ...r })));
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [applied, setApplied] = useState<Record<string, unknown>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>('create');
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [toast, setToast] = useState('');

  const decorate = def.decorate ?? ((r: Record<string, unknown>) => r);

  const filtered = useMemo(() => {
    return rows
      .map((r) => decorate({ ...r }))
      .filter((r) =>
        (def.filters ?? []).every((f) => {
          const v = applied[f.key];
          if (v === '' || v == null) return true;
          const cell = r[f.key];
          if (f.type === 'select') return String(cell) === String(v);
          return String(cell ?? '')
            .toLowerCase()
            .includes(String(v).toLowerCase());
        }),
      );
  }, [rows, applied, def.filters, decorate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 1800);
  };

  const openCreate = () => {
    const seed: Record<string, unknown> = {};
    for (const f of def.form) {
      if (f.type === 'switch') seed[f.key] = 1;
      else seed[f.key] = '';
    }
    setSheetMode('create');
    setEditing(null);
    setFormValues(seed);
    setSheetOpen(true);
  };

  const openView = (row: Record<string, unknown>) => {
    setSheetMode('view');
    setEditing(row);
    setFormValues({ ...row });
    setSheetOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setSheetMode('edit');
    setEditing(row);
    setFormValues({ ...row });
    setSheetOpen(true);
  };

  const saveForm = () => {
    for (const f of def.form) {
      if (!f.required) continue;
      const v = formValues[f.key];
      if (v === '' || v == null) {
        showToast('请填写必填项');
        return;
      }
    }
    if (sheetMode === 'edit' && editing) {
      setRows((prev) =>
        prev.map((r) => (r.id === editing.id ? { ...r, ...formValues, id: editing.id } : r)),
      );
      showToast('已保存');
    } else {
      const nextId = Math.max(0, ...rows.map((r) => Number(r.id) || 0)) + 1;
      setRows((prev) => [{ ...formValues, id: nextId }, ...prev]);
      showToast('已创建');
    }
    setSheetOpen(false);
  };

  const removeRow = (row: Record<string, unknown>) => {
    if (def.id === 'user' && row.is_tenant_admin === 1) {
      showToast('租户管理员不可删除');
      return;
    }
    if (!window.confirm(`确认删除「${String(row.name ?? row.username ?? row.code ?? row.id)}」？`)) return;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    showToast('已删除');
  };

  const pagerNums = useMemo(() => {
    const pages = totalPages;
    const cur = safePage;
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    const range: (number | '…')[] = [1];
    if (cur > 3) range.push('…');
    for (let i = Math.max(2, cur - 1); i <= Math.min(pages - 1, cur + 1); i += 1) range.push(i);
    if (cur < pages - 2) range.push('…');
    range.push(pages);
    return range;
  }, [safePage, totalPages]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <PageHeader
        className="mb-4 shrink-0"
        title={def.title}
        description={def.description}
        breadcrumbs={[
          { label: '门户', to: '/portal' },
          { label: '系统管理' },
          { label: def.group },
          { label: def.title },
        ]}
        actions={
          def.readonly ? null : (
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建
            </Button>
          )
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {(def.filters?.length ?? 0) > 0 ? (
          <div className="mb-4 shrink-0 overflow-hidden rounded-md border bg-card shadow-card">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 p-3.5 md:grid-cols-12">
              {def.filters!.map((f) => (
                <div
                  key={f.key}
                  className={cn(
                    f.col === 2
                      ? 'md:col-span-2'
                      : f.col === 3
                        ? 'md:col-span-3'
                        : f.col === 6
                          ? 'md:col-span-6'
                          : 'md:col-span-4',
                  )}
                >
                  <label className="mb-[0.4rem] block text-sm font-medium text-foreground">{f.label}</label>
                  {f.type === 'select' ? (
                    <select
                      className="h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm"
                      value={draft[f.key] == null ? '' : String(draft[f.key])}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const opt = f.options?.find((o) => String(o.value) === raw);
                        setDraft((prev) => ({ ...prev, [f.key]: opt ? opt.value : raw }));
                      }}
                    >
                      <option value="">全部</option>
                      {(f.options ?? []).map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      className="h-auto min-h-9 px-[0.7rem] py-[0.55rem] text-sm shadow-none"
                      value={draft[f.key] == null ? '' : String(draft[f.key])}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/35 px-4 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 min-h-8 px-[0.6rem] text-[0.8125rem]"
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
                size="sm"
                className="h-8 min-h-8 px-[0.6rem] text-[0.8125rem]"
                onClick={() => {
                  setApplied({ ...draft });
                  setPage(1);
                }}
              >
                <Search className="h-3.5 w-3.5" />
                查询
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-card">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 border-b bg-muted/60 text-left backdrop-blur">
                <tr>
                  {def.columns.map((c) => (
                    <th
                      key={c.key}
                      className="whitespace-nowrap px-4 py-2.5 text-sm font-semibold text-muted-foreground"
                    >
                      {c.label}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-4 py-2.5 text-sm font-semibold text-muted-foreground">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={def.columns.length + 1}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => (
                    <tr key={String(row.id)} className="border-b last:border-0 hover:bg-muted/40">
                      {def.columns.map((c) => (
                        <td key={c.key} className="px-4 py-[0.7rem] align-middle text-sm">
                          {c.status ? (
                            <StatusBadge
                              text={String(row[c.key] ?? '—')}
                              tone={statusTone(row.status)}
                            />
                          ) : (
                            (row[c.key] == null || row[c.key] === '' ? '—' : String(row[c.key]))
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-[0.7rem]">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => openView(row)}
                          >
                            <Eye className="h-3 w-3" />
                            详情
                          </button>
                          {!def.readonly ? (
                            <>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                                onClick={() => openEdit(row)}
                              >
                                <Pencil className="h-3 w-3" />
                                编辑
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                                onClick={() => removeRow(row)}
                              >
                                <Trash2 className="h-3 w-3" />
                                删除
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <div className="text-[0.8125rem] text-muted-foreground">
              共 <b className="font-semibold text-foreground">{filtered.length}</b> 条，当前{' '}
              {filtered.length ? `${start + 1}-${start + pageRows.length}` : '0'}
            </div>
            <div className="flex items-center gap-1">
              <PagerBtn
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </PagerBtn>
              {pagerNums.map((n, i) =>
                n === '…' ? (
                  <span key={`e-${i}`} className="min-w-6 text-center text-[0.8125rem] text-muted-foreground">
                    …
                  </span>
                ) : (
                  <PagerBtn key={n} active={n === safePage} onClick={() => setPage(n)}>
                    {n}
                  </PagerBtn>
                ),
              )}
              <PagerBtn
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </PagerBtn>
            </div>
            <div className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
              <label htmlFor={`ps-${def.id}`}>每页</label>
              <select
                id={`ps-${def.id}`}
                className="h-8 rounded-md border border-input bg-card px-2 text-[0.8125rem] text-foreground"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} 条
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full max-w-[32rem] p-0 sm:max-w-[32rem]">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="text-[1.05rem] font-semibold leading-none">
              {sheetMode === 'create' ? '新建' : sheetMode === 'edit' ? '编辑' : '详情'} · {def.title}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {sheetMode === 'view' ? '查看记录详情' : '填写表单后保存'}
            </SheetDescription>
          </SheetHeader>

          {sheetMode === 'view' ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
              {def.form.map((f) => (
                <div
                  key={f.key}
                  className="grid grid-cols-[9rem_1fr] gap-2 border-b border-dashed border-border py-[0.55rem] last:border-0"
                >
                  <span className="text-[0.8125rem] text-muted-foreground">{f.label}</span>
                  <span className="break-all text-sm">{detailValue(f, formValues[f.key])}</span>
                </div>
              ))}
            </div>
          ) : (
            /* flex-1 只给滚动容器；grid 用 content-start，避免行被撑开留白 */
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="grid grid-cols-2 content-start items-start gap-x-4 gap-y-3.5">
                {def.form.map((f) => (
                  <div
                    key={f.key}
                    className={cn(
                      (f.col ?? 6) >= 12 || f.type === 'textarea' ? 'col-span-2' : COL[f.col ?? 6],
                    )}
                  >
                    <FieldControl
                      field={f}
                      value={formValues[f.key]}
                      onChange={(v) => setFormValues((prev) => ({ ...prev, [f.key]: v }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <SheetFooter className="justify-end gap-2 border-t px-5 py-4">
            {sheetMode === 'view' ? (
              <>
                <Button type="button" variant="outline" className="min-h-9 text-sm font-medium" onClick={() => setSheetOpen(false)}>
                  关闭
                </Button>
                {!def.readonly && editing ? (
                  <Button type="button" className="min-h-9 text-sm font-medium" onClick={() => openEdit(editing)}>
                    编辑
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Button type="button" variant="outline" className="min-h-9 text-sm font-medium" onClick={() => setSheetOpen(false)}>
                  取消
                </Button>
                <Button type="button" className="min-h-9 text-sm font-medium" onClick={saveForm}>
                  {sheetMode === 'edit' ? '保存' : '创建'}
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {toast ? (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-popover px-4 py-2 text-sm shadow-card">
          {toast}
        </div>
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
        'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-[0.8125rem] transition',
        active
          ? 'border-primary bg-primary font-semibold text-primary-foreground'
          : 'border-border bg-card text-foreground hover:bg-muted/60',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

export function SystemAdminPage({ path }: { path: string }) {
  const def = SYSTEM_PAGE_DEFS[path];
  if (!def) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        未配置页面：{path}
      </div>
    );
  }
  return <AdminListPage def={def} />;
}

export function UserPage() {
  return <SystemAdminPage path="/system/user" />;
}
export function OrgPage() {
  return <SystemAdminPage path="/system/org" />;
}
export function DeptPage() {
  return <SystemAdminPage path="/system/dept" />;
}
export function EmployeePage() {
  return <SystemAdminPage path="/system/employee" />;
}
export function PostPage() {
  return <SystemAdminPage path="/system/post" />;
}
export function AppManagePage() {
  return <SystemAdminPage path="/system/app" />;
}
export function ApiManagePage() {
  return <SystemAdminPage path="/system/api" />;
}
export function ModulePage() {
  return <SystemAdminPage path="/system/module" />;
}
export function RolePage() {
  return <SystemAdminPage path="/system/role" />;
}
export function MenuPage() {
  return <SystemAdminPage path="/system/menu" />;
}
export function DictPage() {
  return <SystemAdminPage path="/system/dict" />;
}
export function ConfigPage() {
  return <SystemAdminPage path="/system/config" />;
}
export function LoginLogPage() {
  return <SystemAdminPage path="/monitor/login-log" />;
}
export function OperLogPage() {
  return <SystemAdminPage path="/monitor/oper-log" />;
}
