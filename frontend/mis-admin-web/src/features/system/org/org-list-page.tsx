import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { DetailDefList } from '@/components/common/detail-def-list';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { createOrg, deleteOrg, listOrgs, updateOrg } from '@/lib/api/orgs';
import type { OrgItem } from '@/types/api';

const fieldLabel = SHEET_FORM_LABEL;
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

const ORG_COLUMNS: ResizableColumn[] = [
  { key: 'code', label: '编码' },
  { key: 'name', label: '名称' },
  { key: 'sort', label: '排序' },
  { key: 'status', label: '状态' },
  { key: 'remark', label: '备注' },
  { key: '__ops__', label: '操作', locked: true },
];

const thPad = 'px-3';

export function OrgListPage() {
  const [rows, setRows] = useState<OrgItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OrgItem | null>(null);
  const [viewing, setViewing] = useState<OrgItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', sort: '0', remark: '', status: 1 });

  const { widthOf, startResize, hasCustom, reset: resetColWidths, tableStyle } = useColumnWidths(
    ORG_COLUMNS,
    'mis-org-table-widths',
  );

  const getValue = useCallback((row: OrgItem, key: string) => {
    switch (key) {
      case 'code':
        return row.code;
      case 'name':
        return row.name;
      case 'sort':
        return row.sort;
      case 'status':
        return row.status;
      case 'remark':
        return row.remark ?? '';
      default:
        return null;
    }
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(rows, getValue);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listOrgs());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setViewing(null);
    setForm({ code: '', name: '', sort: '0', remark: '', status: 1 });
    setOpen(true);
  }

  function openView(row: OrgItem) {
    setViewing(row);
    setEditing(null);
    setOpen(true);
  }

  function openEdit(row: OrgItem) {
    setEditing(row);
    setViewing(null);
    setForm({
      code: row.code,
      name: row.name,
      sort: String(row.sort ?? 0),
      remark: row.remark ?? '',
      status: row.status,
    });
    setOpen(true);
  }

  async function onSave() {
    if (!form.name.trim() || (!editing && !form.code.trim())) {
      toast.warning('请填写编码与名称');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateOrg(editing.id, {
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          status: form.status,
          remark: form.remark.trim() || undefined,
        });
        toast.success('已更新');
      } else {
        await createOrg({
          code: form.code.trim(),
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          remark: form.remark.trim() || undefined,
        });
        toast.success('已创建');
      }
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(row: OrgItem) {
    if (!window.confirm(`确认删除组织「${row.name}」？`)) return;
    try {
      await deleteOrg(row.id);
      toast.success('已删除');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  const dataCols = useMemo(() => ORG_COLUMNS.filter((c) => !c.locked), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="组织管理"
        description="租户下业务组织（扁平列表）。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '组织架构',
          title: '组织管理',
        })}
        actions={
          <div className="flex items-center gap-2">
            {hasCustom ? (
              <Button type="button" variant="outline" size="sm" onClick={resetColWidths}>
                重置列宽
              </Button>
            ) : null}
            <PermissionGate permission="system:org:add">
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新增组织
              </Button>
            </PermissionGate>
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="border-separate border-spacing-0 bg-table-surface text-left text-sm" style={tableStyle}>
          <thead className="bg-table-header text-muted-foreground">
            <tr>
              {dataCols.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{ width: widthOf(col.key) }}
                    className="whitespace-nowrap px-0 py-0 text-[13px] font-bold"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        'flex w-full items-center gap-1 pr-5 text-left font-bold transition-colors',
                        thPad,
                        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                      aria-label={`按${col.label}排序`}
                    >
                      {col.label}
                      <SortIndicator state={active ? sortDir : 'none'} />
                    </button>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      onMouseDown={(e) => startResize(e, col.key)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
                      title={`拖动调整${col.label}列宽`}
                    />
                  </th>
                );
              })}
              <th
                className="whitespace-nowrap px-0 py-0 text-[13px] font-bold"
                style={{ width: widthOf('__ops__') }}
              >
                <span className={cn('block font-bold text-muted-foreground', thPad)}>操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={ORG_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={ORG_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                  暂无数据
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/50 last:border-0 bg-table-row even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 align-middle font-mono text-xs">
                    {row.code}
                  </td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 align-middle font-medium">
                    {row.name}
                  </td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 align-middle">
                    {row.sort}
                  </td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 align-middle">
                    <StatusBadge
                      tone={row.status === 1 ? 'success' : 'destructive'}
                      text={row.status === 1 ? '启用' : '禁用'}
                    />
                  </td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 align-middle text-muted-foreground">
                    {row.remark ?? '—'}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                        onClick={() => openView(row)}
                      >
                        <Eye className="h-3 w-3" />
                        详情
                      </button>
                      <PermissionGate permission="system:org:edit">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="h-3 w-3" />
                          编辑
                        </button>
                      </PermissionGate>
                      <PermissionGate permission="system:org:delete">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                          onClick={() => void onDelete(row)}
                        >
                          <Trash2 className="h-3 w-3" />
                          删除
                        </button>
                      </PermissionGate>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{viewing ? '组织详情' : editing ? '编辑组织' : '新增组织'}</SheetTitle>
          </SheetHeader>
          {viewing ? (
            <div className={SHEET_FORM_BODY}>
              <DetailDefList
                items={[
                  { label: '编码', value: viewing.code },
                  { label: '名称', value: viewing.name },
                  { label: '排序', value: String(viewing.sort ?? 0) },
                  {
                    label: '状态',
                    value: (
                      <StatusBadge
                        tone={viewing.status === 1 ? 'success' : 'destructive'}
                        text={viewing.status === 1 ? '启用' : '禁用'}
                      />
                    ),
                  },
                  { label: '备注', value: viewing.remark },
                ]}
              />
            </div>
          ) : (
            <div className={SHEET_FORM_BODY}>
              {!editing ? (
                <div className={SHEET_FORM_FIELD}>
                  <label className={fieldLabel}>编码 *</label>
                  <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
                </div>
              ) : null}
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>名称 *</label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>排序</label>
                <Input value={form.sort} onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))} />
              </div>
              {editing ? (
                <div className={SHEET_FORM_FIELD}>
                  <label className={fieldLabel}>状态</label>
                  <select
                    className={fieldInput}
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: Number(e.target.value) }))}
                  >
                    <option value={1}>启用</option>
                    <option value={0}>禁用</option>
                  </select>
                </div>
              ) : null}
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>备注</label>
                <Input value={form.remark} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} />
              </div>
            </div>
          )}
          <SheetFooter>
            {viewing ? (
              <Button variant="outline" onClick={() => setOpen(false)}>
                关闭
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button disabled={saving} onClick={() => void onSave()}>
                  {saving ? '保存中…' : '保存'}
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
