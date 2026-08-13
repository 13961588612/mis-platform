import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
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
import {
  createPostType,
  deletePostType,
  listPostTypes,
  updatePostType,
} from '@/lib/api/posts';
import type { PostTypeItem } from '@/types/api';
import { usePostTypeVersionStore } from './post-type-version-store';

const fieldLabel = SHEET_FORM_LABEL;
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

const POST_TYPE_COLUMNS: ResizableColumn[] = [
  { key: 'code', label: '编码' },
  { key: 'name', label: '名称' },
  { key: 'sort', label: '排序' },
  { key: 'status', label: '状态' },
  { key: 'referenceCount', label: '引用岗位数' },
  { key: '__ops__', label: '操作', locked: true },
];

const thPad = 'px-3';

/**
 * 岗位类型管理（岗位管理页子 Tab 内容）。
 *
 * <p>字段：编码（不可编辑）/ 名称 / 排序 / 状态 / 引用岗位数；删除被引用硬拦截
 * （后端返回「岗位类型已被 N 个岗位引用，禁止删除」）。任何变更后 bump
 * post-type-version-store，驱动岗位列表引擎重挂载刷新下拉（P0-PT-03）。
 */
export function PostTypeManagePage({ headerExtra }: { headerExtra?: ReactNode }) {
  const [rows, setRows] = useState<PostTypeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PostTypeItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', sort: '0', status: 1 });
  const bumpPostTypeVersion = usePostTypeVersionStore((s) => s.bumpPostTypeVersion);

  const { widthOf, startResize, hasCustom, reset: resetColWidths, tableStyle } = useColumnWidths(
    POST_TYPE_COLUMNS,
    'mis-post-type-table-widths',
  );

  const getValue = useCallback((row: PostTypeItem, key: string) => {
    switch (key) {
      case 'code':
        return row.code;
      case 'name':
        return row.name;
      case 'sort':
        return row.sort;
      case 'status':
        return row.status;
      case 'referenceCount':
        return row.referenceCount;
      default:
        return null;
    }
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(rows, getValue);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listPostTypes());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载岗位类型失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ code: '', name: '', sort: '0', status: 1 });
    setOpen(true);
  }

  function openEdit(row: PostTypeItem) {
    setEditing(row);
    setForm({ code: row.code, name: row.name, sort: String(row.sort ?? 0), status: row.status });
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
        await updatePostType(editing.id, {
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          status: form.status,
        });
        toast.success('已更新');
      } else {
        await createPostType({
          code: form.code.trim(),
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          status: form.status,
        });
        toast.success('已创建');
      }
      setOpen(false);
      await load();
      bumpPostTypeVersion();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(row: PostTypeItem) {
    const hint = row.referenceCount > 0 ? `（已被 ${row.referenceCount} 个岗位引用，后端将拦截）` : '';
    if (!window.confirm(`确认删除岗位类型「${row.name}」？${hint}`)) return;
    try {
      await deletePostType(row.id);
      toast.success('已删除');
      await load();
      bumpPostTypeVersion();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  const dataCols = useMemo(() => POST_TYPE_COLUMNS.filter((c) => !c.locked), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="岗位类型管理"
        description="岗位类型（sys_post_type）增删改查；删除被岗位引用的类型将被拦截。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '组织架构',
          title: '岗位管理',
        })}
        actions={
          <div className="flex items-center gap-2">
            {headerExtra ? <>{headerExtra}</> : null}
            {hasCustom ? (
              <Button type="button" variant="outline" size="sm" onClick={resetColWidths}>
                重置列宽
              </Button>
            ) : null}
            <PermissionGate permission="system:post-type:add">
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新增岗位类型
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
                <td colSpan={POST_TYPE_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={POST_TYPE_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                  暂无岗位类型
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
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 align-middle">
                    {row.referenceCount > 0 ? (
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {row.referenceCount} 个岗位
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center justify-end gap-1">
                      <PermissionGate permission="system:post-type:edit">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="h-3 w-3" />
                          编辑
                        </button>
                      </PermissionGate>
                      <PermissionGate permission="system:post-type:delete">
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
            <SheetTitle>{editing ? '编辑岗位类型' : '新增岗位类型'}</SheetTitle>
          </SheetHeader>
          <div className={SHEET_FORM_BODY}>
            {!editing ? (
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>编码 *</label>
                <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
              </div>
            ) : (
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>编码</label>
                <Input value={editing.code} disabled />
                <p className="mt-1 text-xs text-muted-foreground">编码创建后不可编辑</p>
              </div>
            )}
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>名称 *</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>排序</label>
              <Input value={form.sort} onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))} />
            </div>
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
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void onSave()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
