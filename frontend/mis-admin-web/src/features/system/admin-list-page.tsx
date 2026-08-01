import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Assignment } from './types';
import {
  Activity,
  AppWindow,
  Boxes,
  Check,
  ChevronDown,
  Cog,
  Eye,
  Inbox,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  type LucideIcon,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  SearchX,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { ModuleManagePage } from '@/features/system/module/module-manage-page';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { DetailDefList } from '@/components/common/detail-def-list';
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
import { AiFeature } from '@/features/ai/components/ai-feature';
import { AiTextExtract } from '@/features/ai/components/ai-text-extract';
import { AiSummary } from '@/features/ai/components/ai-summary';
import { AiRag } from '@/features/ai/components/ai-rag';
import {
  FormFillBridgeProvider,
  toFormFieldSchema,
  type FormFillBridge,
} from '@/features/ai/context/form-fill-bridge';

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
  if (field.type === 'multiselect' && Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value
      .map((v) => optionLabel(field, v))
      .join('、');
  }
  if (value == null || value === '') return '—';
  return String(value);
}

/** 从行中取任职记录数组（容错：无则空数组） */
function getAssignments(row: Record<string, unknown>): Assignment[] {
  const v = row.assignments;
  if (Array.isArray(v)) return v as Assignment[];
  return [];
}

/** 标签簇：首项填充色（主岗），其余描边色（兼职）；flat 时全部描边 */
function TagCluster({ values, flat = false }: { values: unknown[]; flat?: boolean }) {
  if (!values.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {values.map((v, i) => (
        <span
          key={i}
          className={
            !flat && i === 0
              ? 'inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[0.75rem] font-medium text-primary'
              : 'inline-flex items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[0.75rem] text-muted-foreground'
          }
        >
          {String(v)}
        </span>
      ))}
    </div>
  );
}

/** 任职记录编辑器：可增删行，每行 = 任职部门 + 任职岗位 + 任职开始时间 */
function AssignmentEditor({
  value,
  onChange,
  deptOptions = [],
  postOptions = [],
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  deptOptions?: { label: string; value: string | number }[];
  postOptions?: { label: string; value: string | number }[];
}) {
  const list: Assignment[] = Array.isArray(value) ? (value as Assignment[]) : [];
  const update = (next: Assignment[]) => onChange(next);
  const setAt = (i: number, patch: Partial<Assignment>) =>
    update(list.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const removeAt = (i: number) => {
    const next = list.filter((_, idx) => idx !== i);
    // 删除后若无主职，默认把首行设为主职
    if (next.length && !next.some((a) => a.isPrimary)) next[0] = { ...next[0], isPrimary: true };
    update(next);
  };
  const addOne = () => {
    const next = [...list, { dept: '', post: '', startDate: '', isPrimary: list.length === 0 }];
    update(next);
  };
  const markPrimary = (i: number) =>
    update(list.map((a, idx) => ({ ...a, isPrimary: idx === i })));

  return (
    <div className="col-span-2 min-w-0 self-start">
      <div className="overflow-hidden rounded-md border border-input">
        <table className="w-full border-collapse bg-table-surface text-sm">
          <thead className="border-b-2 border-foreground/20 bg-table-header text-left text-sm font-bold text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 font-bold">任职部门</th>
              <th className="px-2.5 py-1.5 font-bold">任职岗位</th>
              <th className="px-2.5 py-1.5 font-bold">任职开始时间</th>
              <th className="w-16 px-2.5 py-1.5 text-center font-bold">主职</th>
              <th className="w-12 px-2.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2.5 py-3 text-center text-xs text-muted-foreground">
                  暂无任职记录，点击下方按钮添加
                </td>
              </tr>
            ) : (
              list.map((a, i) => (
                <tr key={i} className="border-t border-border/50 last:border-0">
                  <td className="px-2 py-1.5">
                    <select
                      className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm"
                      value={a.dept ?? ''}
                      onChange={(e) => setAt(i, { dept: e.target.value })}
                    >
                      <option value="">请选择</option>
                      {deptOptions.map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm"
                      value={a.post ?? ''}
                      onChange={(e) => setAt(i, { post: e.target.value })}
                    >
                      <option value="">请选择</option>
                      {postOptions.map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="date"
                      className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm"
                      value={a.startDate ?? ''}
                      onChange={(e) => setAt(i, { startDate: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => markPrimary(i)}
                      className={cn(
                        'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-medium transition',
                        a.isPrimary
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-input text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                      aria-pressed={!!a.isPrimary}
                      title="标记为唯一主职"
                    >
                      主
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="删除该任职"
                      onClick={() => removeAt(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addOne}
        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-dashed border-input px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5"
      >
        <Plus className="h-3.5 w-3.5" />
        添加任职
      </button>
    </div>
  );
}

/** 任职记录只读子表（详情 / 列表展开用）：表头加粗带底色；表体只显示列分隔线（竖线），不显示行间横线 */
function AssignmentTable({ list }: { list: Assignment[] }) {
  if (!list.length) return <span className="text-muted-foreground">—</span>;
  return (
    <table className="w-full border-collapse bg-table-surface text-sm">
      <thead className="border-b-2 border-foreground/20 bg-table-header text-left text-sm font-bold text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-bold">任职部门</th>
          <th className="border-l border-border/60 px-3 py-2 font-bold">任职岗位</th>
          <th className="border-l border-border/60 px-3 py-2 font-bold">任职开始时间</th>
          <th className="border-l border-border/60 px-3 py-2 font-bold">主职</th>
        </tr>
      </thead>
      <tbody>
        {list.map((a, i) => (
          <tr key={i}>
            <td className="px-3 py-2 font-medium text-foreground">{a.dept || '—'}</td>
            <td className="border-l border-border/60 px-3 py-2 font-medium text-foreground">{a.post || '—'}</td>
            <td className="border-l border-border/60 px-3 py-2">{a.startDate || '—'}</td>
            <td className="border-l border-border/60 px-3 py-2">
              {a.isPrimary ? (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  主
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">兼职</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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

  if (field.type === 'multiselect') {
    const current = Array.isArray(value) ? (value as (string | number)[]) : [];
    const toggle = (v: string | number) => {
      onChange(current.includes(v) ? current.filter((x) => x !== v) : [...current, v]);
    };
    return (
      <div className="col-span-2 min-w-0 self-start">
        {label}
        <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-md border border-input bg-card p-2">
          {(field.options ?? []).length === 0 ? (
            <span className="px-1 py-0.5 text-xs text-muted-foreground">暂无可选项</span>
          ) : (
            (field.options ?? []).map((o) => {
              const on = current.includes(o.value);
              const isFirst = on && current[0] === o.value;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition',
                    on
                      ? isFirst
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-primary/40 bg-primary/5 text-primary/80'
                      : 'border-input text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                  aria-pressed={on}
                >
                  {on ? <Check className="h-3 w-3" /> : null}
                  {o.label}
                  {isFirst ? <span className="ml-0.5 text-[0.65rem] opacity-70">主</span> : null}
                </button>
              );
            })
          )}
        </div>
        {field.hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">可多选，首个勾选为默认</p>
        )}
      </div>
    );
  }

  if (field.type === 'assignments') {
    return (
      <AssignmentEditor
        value={value}
        onChange={onChange}
        deptOptions={field.deptOptions}
        postOptions={field.postOptions}
      />
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
  // 筛选卡折叠 + 计数
  const [filterOpen, setFilterOpen] = useState(true);
  // 真实数据加载态（def.loader 提供时触发骨架；否则用 sample，无加载态）
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!def.loader) return;
    let alive = true;
    setLoading(true);
    def
      .loader()
      .then((data) => {
        if (alive) setRows(data.map((r) => ({ ...r })));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [def]);

  // AI：辅助录入嵌在表单 Sheet 右侧；问答仍用独立 Sheet
  const [aiAssistOpen, setAiAssistOpen] = useState(false);
  const [aiRagOpen, setAiRagOpen] = useState(false);

  // 列表任职子表展开态（按行 id 记录）
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const openCreate = useCallback((opts?: { withAssist?: boolean }) => {
    const seed: Record<string, unknown> = {};
    for (const f of def.form) {
      if (f.type === 'switch') seed[f.key] = 1;
      else seed[f.key] = '';
    }
    setSheetMode('create');
    setEditing(null);
    setFormValues(seed);
    setAiAssistOpen(!!opts?.withAssist);
    setSheetOpen(true);
  }, [def.form]);

  // 表单回填桥接：桥接 AI 组件与当前表单态（schema 真源 = def.form）
  const bridge = useMemo<FormFillBridge>(
    () => ({
      def,
      getSchema: () => toFormFieldSchema(def.form),
      getValues: () => formValues,
      applyFields: (partial) => {
        setFormValues((prev) => {
          const next = { ...prev };
          for (const [k, s] of Object.entries(partial)) next[k] = s.value;
          return next;
        });
      },
      openCreate: () => openCreate(),
    }),
    [def, formValues, openCreate],
  );

  // UC-3 智能录入：打开新增表单，并在右侧展开辅助录入
  const openSmartImport = useCallback(() => {
    openCreate({ withAssist: true });
  }, [openCreate]);

  const closeSheet = (open: boolean) => {
    setSheetOpen(open);
    if (!open) setAiAssistOpen(false);
  };

  const formModes = sheetMode === 'create' || sheetMode === 'edit';
  const splitAssist = formModes && aiAssistOpen;

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

  // 已应用筛选条件计数（收起态提示）
  const filterCount = useMemo(
    () => Object.values(applied).filter((v) => v !== '' && v != null).length,
    [applied],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 1800);
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
    setAiAssistOpen(false);
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
    <FormFillBridgeProvider value={bridge}>
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
            <div className="flex gap-2">
              <Button type="button" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" />
                新建
              </Button>
              <AiFeature feature="text-extract">
                <Button type="button" variant="outline" onClick={openSmartImport}>
                  <Sparkles className="h-4 w-4" /> 智能录入
                </Button>
              </AiFeature>
            </div>
          )
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {(def.filters?.length ?? 0) > 0 ? (
          <div className="mb-4 shrink-0 overflow-hidden rounded-md border bg-card shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">筛选</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs',
                    filterCount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  已设置 {filterCount} 项条件
                </span>
              </div>
              <div className="flex items-center gap-2">
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
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={filterOpen ? '收起筛选' : '展开筛选'}
                  aria-expanded={filterOpen}
                  onClick={() => setFilterOpen((v) => !v)}
                >
                  <ChevronDown className={cn('h-4 w-4 transition', filterOpen && 'rotate-180')} />
                </Button>
              </div>
            </div>
            {filterOpen ? (
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
            ) : null}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-card">
          {def.view === 'cards' ? (
            <AppCardGrid
              rows={pageRows}
              loading={loading}
              filterCount={filterCount}
              def={def}
              readonly={!!def.readonly}
              onView={openView}
              onEdit={openEdit}
              onDelete={removeRow}
              onCreate={openCreate}
              onClearFilters={() => {
                setDraft({});
                setApplied({});
                setPage(1);
              }}
            />
          ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse bg-table-surface">
              <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-left backdrop-blur">
                <tr>
                  {def.columns.map((c) => (
                    <th
                      key={c.key}
                      className="whitespace-nowrap px-4 py-2.5 text-sm font-bold text-muted-foreground"
                    >
                      {c.label}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-4 py-2.5 text-sm font-bold text-muted-foreground">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: pageSize }).map((_, i) => (
                    <tr key={`sk-${i}`} className="border-b last:border-0">
                      {def.columns.map((c) => (
                        <td key={c.key} className="px-4 py-[0.7rem]">
                          <div className="h-4 w-full max-w-[10rem] animate-pulse rounded bg-muted" />
                        </td>
                      ))}
                      <td className="px-4 py-[0.7rem]">
                        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={def.columns.length + 1} className="px-4 py-12">
                      <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
                        {filterCount > 0 ? (
                          <>
                            <SearchX className="h-10 w-10 text-muted-foreground/50" />
                            <div className="text-sm font-medium text-foreground">没有符合条件的记录</div>
                            <p className="max-w-xs text-xs text-muted-foreground">
                              试试调整或清除筛选条件。
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-1 h-8 min-h-8 text-[0.8125rem]"
                              onClick={() => {
                                setDraft({});
                                setApplied({});
                                setPage(1);
                              }}
                            >
                              清除筛选
                            </Button>
                          </>
                        ) : (
                          <>
                            <Inbox className="h-10 w-10 text-muted-foreground/50" />
                            <div className="text-sm font-medium text-foreground">暂无{def.title}数据</div>
                            <p className="max-w-xs text-xs text-muted-foreground">
                              还没有任何记录，创建第一条吧。
                            </p>
                            {!def.readonly ? (
                              <Button
                                type="button"
                                size="sm"
                                className="mt-1 h-8 min-h-8 text-[0.8125rem]"
                                onClick={() => openCreate()}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                新建
                              </Button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => {
                    const rowId = String(row.id);
                    const assignments = getAssignments(row);
                    const isOpen = !!expanded[rowId];
                    const hasAssignments = assignments.length > 0;
                    return (
                      <Fragment key={rowId}>
                        <tr className="border-b border-border/50 last:border-0 bg-table-row even:bg-table-stripe hover:bg-table-hover">
                          {def.columns.map((c) => (
                            <td key={c.key} className="px-4 py-[0.7rem] align-middle text-sm">
                              {c.status ? (
                                <StatusBadge
                                  text={String(row[c.key] ?? '—')}
                                  tone={statusTone(row.status)}
                                />
                              ) : c.key === 'assignmentCount' ? (
                                hasAssignments ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpanded((prev) => ({ ...prev, [rowId]: !isOpen }))
                                    }
                                    className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[0.75rem] font-medium text-primary hover:bg-primary/10"
                                    aria-expanded={isOpen}
                                  >
                                    {assignments.length} 个
                                    {isOpen ? (
                                      <ChevronDown className="h-3 w-3 rotate-180" />
                                    ) : (
                                      <ChevronDown className="h-3 w-3" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )
                              ) : c.tags ? (
                                <TagCluster values={Array.isArray(row[c.key]) ? (row[c.key] as unknown[]) : []} />
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
                                  <RowMoreMenu onDelete={() => removeRow(row)} />
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {isOpen && hasAssignments ? (
                          <tr className="border-b last:border-0 bg-muted/20">
                            <td colSpan={def.columns.length + 1} className="px-4 py-3">
                              <AssignmentTable list={assignments} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          )}

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

      <Sheet open={sheetOpen} onOpenChange={closeSheet}>
        <SheetContent
          side="right"
          className={cn(
            'flex w-full flex-col p-0',
            splitAssist ? 'sm:max-w-4xl' : 'max-w-[32rem] sm:max-w-[32rem]',
          )}
        >
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="text-[1.05rem] font-semibold leading-none">
              {sheetMode === 'create' ? '新建' : sheetMode === 'edit' ? '编辑' : '详情'} · {def.title}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {sheetMode === 'view' ? '查看记录详情' : '填写表单后保存'}
            </SheetDescription>
          </SheetHeader>

          {/* 创建/编辑：可展开右侧辅助录入 */}
          {formModes ? (
            <div className="flex items-center gap-2 border-b bg-muted/30 px-5 py-2">
              <AiFeature feature="text-extract">
                <Button
                  type="button"
                  variant={aiAssistOpen ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAiAssistOpen((v) => !v)}
                >
                  <Sparkles className="h-4 w-4" />
                  {aiAssistOpen ? '收起辅助' : '辅助录入'}
                </Button>
              </AiFeature>
              <span className="text-xs text-muted-foreground">
                {aiAssistOpen
                  ? '右侧抽取后自动填入左侧表单，请核对后保存'
                  : '打开后在右侧粘贴/上传，识别结果写入左侧'}
              </span>
            </div>
          ) : null}

          <div className={cn('flex min-h-0 flex-1', splitAssist ? 'flex-row' : 'flex-col')}>
            <div
              className={cn(
                'flex min-h-0 min-w-0 flex-col',
                splitAssist ? 'w-1/2 border-r' : 'flex-1',
              )}
            >
          {sheetMode === 'view' ? (
            <div className="border-b px-5 py-3">
              <AiFeature feature="detail-summary">
                <AiSummary record={formValues} defTitle={def.title} />
              </AiFeature>
              <div className="mt-2 flex justify-end">
                <AiFeature feature="rag-qa">
                  <Button type="button" variant="outline" size="sm" onClick={() => setAiRagOpen(true)}>
                    <Sparkles className="h-4 w-4" /> AI 问答
                  </Button>
                </AiFeature>
              </div>
            </div>
          ) : null}

          {sheetMode === 'view' ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
              <DetailDefList
                items={[
                  ...def.form
                    .filter((f) => f.type !== 'multiselect' && f.type !== 'assignments')
                    .map((f) => ({
                      label: f.label,
                      value: detailValue(f, formValues[f.key]),
                      key: f.key,
                    })),
                  ...(def.detailExtra ? def.detailExtra(formValues) : []),
                ]}
              />
              {getAssignments(formValues).length > 0 ? (
                <div className="mt-4 border-t pt-3">
                  <h4 className="mb-2 text-sm font-semibold text-foreground">任职明细</h4>
                  <AssignmentTable list={getAssignments(formValues)} />
                </div>
              ) : null}
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
                      'relative',
                    )}
                  >
                    <FieldControl
                      field={f}
                      value={formValues[f.key]}
                      onChange={(v) => setFormValues((prev) => ({ ...prev, [f.key]: v }))}
                    />
                    {/* 单字段 Sparkles：打开右侧辅助录入 */}
                    <AiFeature feature="text-extract">
                      <button
                        type="button"
                        onClick={() => setAiAssistOpen(true)}
                        className="absolute right-1 top-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`辅助录入 ${f.label}`}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </button>
                    </AiFeature>
                  </div>
                ))}
              </div>
            </div>
          )}

          <SheetFooter className="justify-end gap-2 border-t px-5 py-4">
            {sheetMode === 'view' ? (
              <>
                <Button type="button" variant="outline" className="min-h-9 text-sm font-medium" onClick={() => closeSheet(false)}>
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
                <Button type="button" variant="outline" className="min-h-9 text-sm font-medium" onClick={() => closeSheet(false)}>
                  取消
                </Button>
                <Button type="button" className="min-h-9 text-sm font-medium" onClick={saveForm}>
                  {sheetMode === 'edit' ? '保存' : '创建'}
                </Button>
              </>
            )}
          </SheetFooter>
            </div>

            {splitAssist ? (
              <div className="flex w-1/2 min-h-0 min-w-0 flex-col bg-muted/10">
                <AiTextExtract
                  embedded
                  autoApplyOnDone
                  onClose={() => setAiAssistOpen(false)}
                />
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* UC-4 AI 问答面板 */}
      <Sheet open={aiRagOpen} onOpenChange={setAiRagOpen}>
        <SheetContent side="right" className="w-full max-w-[40rem] p-0 sm:max-w-[40rem]">
          <AiRag record={sheetMode === 'view' ? formValues : null} onClose={() => setAiRagOpen(false)} />
        </SheetContent>
      </Sheet>

      {toast ? (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-popover px-4 py-2 text-sm shadow-card">
          {toast}
        </div>
      ) : null}
      </div>
    </FormFillBridgeProvider>
  );
}

function RowMoreMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-muted-foreground hover:bg-muted/60"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        更多
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-md border bg-popover p-1 shadow-card"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[0.8125rem] text-destructive hover:bg-destructive/10"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Phase B: app 卡片网格视图（view:'cards'） ---------- */

const APP_ICONS: Record<string, LucideIcon> = {
  layoutDashboard: LayoutDashboard,
  shieldCheck: ShieldCheck,
  activity: Activity,
  boxes: Boxes,
  package: Package,
  cog: Cog,
  settings: Settings,
  appWindow: AppWindow,
  layers: Layers,
};

function AppTileIcon({ name }: { name?: unknown }) {
  const Cmp = APP_ICONS[String(name ?? '')] ?? LayoutGrid;
  return <Cmp className="h-5 w-5" />;
}

function labelOf(def: AdminPageDef, key: string, value: unknown): string {
  const field = def.form.find((f) => f.key === key);
  return field ? optionLabel(field, value) : String(value ?? '—');
}

function AppTile({
  row,
  def,
  readonly,
  onView,
  onEdit,
  onDelete,
}: {
  row: Record<string, unknown>;
  def: AdminPageDef;
  readonly: boolean;
  onView: (row: Record<string, unknown>) => void;
  onEdit: (row: Record<string, unknown>) => void;
  onDelete: (row: Record<string, unknown>) => void;
}) {
  return (
    <div className="group relative flex flex-col rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <AppTileIcon name={row.icon} />
        </div>
        {row.status != null ? (
          <StatusBadge
            text={String(row.statusText ?? (row.status === 1 ? '启用' : '禁用'))}
            tone={statusTone(row.status)}
          />
        ) : null}
      </div>

      <div className="mt-3 min-w-0">
        <div className="truncate text-[0.95rem] font-semibold text-foreground">
          {String(row.name ?? '未命名')}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{String(row.code ?? '')}</div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-muted/70 px-2 py-0.5 text-xs text-muted-foreground">
          {labelOf(def, 'kind', row.kind)}
        </span>
        <span className="rounded-md bg-muted/70 px-2 py-0.5 text-xs text-muted-foreground">
          {labelOf(def, 'runtime', row.runtime)}
        </span>
      </div>

      <div className="mt-2 truncate rounded-md bg-muted/40 px-2 py-1 font-mono text-xs text-foreground/80">
        {String(row.base_path ?? '—')}
      </div>

      <div className="mt-3 flex items-center gap-1 border-t pt-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
          onClick={() => onView(row)}
        >
          <Eye className="h-3 w-3" />
          详情
        </button>
        {!readonly ? (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
              onClick={() => onEdit(row)}
            >
              <Pencil className="h-3 w-3" />
              编辑
            </button>
            <RowMoreMenu onDelete={() => onDelete(row)} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function AppCardGrid({
  rows,
  loading,
  filterCount,
  def,
  readonly,
  onView,
  onEdit,
  onDelete,
  onCreate,
  onClearFilters,
}: {
  rows: Record<string, unknown>[];
  loading: boolean;
  filterCount: number;
  def: AdminPageDef;
  readonly: boolean;
  onView: (row: Record<string, unknown>) => void;
  onEdit: (row: Record<string, unknown>) => void;
  onDelete: (row: Record<string, unknown>) => void;
  onCreate: () => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`sk-${i}`} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between">
                <div className="h-11 w-11 animate-pulse rounded-lg bg-muted" />
                <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
              </div>
              <div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted" />
              <div className="mt-3 flex gap-1.5">
                <div className="h-5 w-12 animate-pulse rounded bg-muted" />
                <div className="h-5 w-12 animate-pulse rounded bg-muted" />
              </div>
              <div className="mt-2 h-7 w-full animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 py-6 text-center">
          {filterCount > 0 ? (
            <>
              <SearchX className="h-10 w-10 text-muted-foreground/50" />
              <div className="text-sm font-medium text-foreground">没有符合条件的记录</div>
              <p className="max-w-xs text-xs text-muted-foreground">试试调整或清除筛选条件。</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 h-8 min-h-8 text-[0.8125rem]"
                onClick={onClearFilters}
              >
                清除筛选
              </Button>
            </>
          ) : (
            <>
              <Inbox className="h-10 w-10 text-muted-foreground/50" />
              <div className="text-sm font-medium text-foreground">暂无{def.title}数据</div>
              <p className="max-w-xs text-xs text-muted-foreground">还没有任何记录，创建第一条吧。</p>
              {!readonly ? (
                <Button
                  type="button"
                  size="sm"
                  className="mt-1 h-8 min-h-8 text-[0.8125rem]"
                  onClick={onCreate}
                >
                  <Plus className="h-3.5 w-3.5" />
                  新建
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((row) => (
            <AppTile
              key={String(row.id)}
              row={row}
              def={def}
              readonly={readonly}
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
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
export function ModulePage() {
  return <ModuleManagePage />;
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
