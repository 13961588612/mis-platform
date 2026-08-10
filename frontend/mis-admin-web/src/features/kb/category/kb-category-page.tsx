import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { PermissionGate } from '@/components/auth/permission-gate';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { EnabledBadge } from '../components/kb-badges';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../api/kb-api';
import type { KbCategory } from '../types';
import { formatTime } from '../types';

const fieldLabel = SHEET_FORM_LABEL;
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

interface CategoryForm {
  name: string;
  parentId: string;
  enabled: string;
  sort: string;
  remark: string;
}

const EMPTY_FORM: CategoryForm = {
  name: '',
  parentId: '',
  enabled: '1',
  sort: '0',
  remark: '',
};

/** 单层缩进渲染：按 parentId 组织为「根 → 子」两级列表（分类树 P0 仅两级）。 */
interface FlatRow {
  category: KbCategory;
  depth: number;
}

function flattenCategories(list: KbCategory[]): FlatRow[] {
  const roots = list.filter((c) => c.parentId == null || c.parentId === 0);
  const childrenOf = (pid: number): KbCategory[] =>
    list.filter((c) => c.parentId === pid).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const out: FlatRow[] = [];
  for (const root of roots.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    out.push({ category: root, depth: 0 });
    for (const child of childrenOf(root.id)) {
      out.push({ category: child, depth: 1 });
    }
  }
  // 补齐父节点不可见的孤儿节点，避免数据丢失
  const rendered = new Set(out.map((r) => r.category.id));
  for (const c of list) {
    if (!rendered.has(c.id)) out.push({ category: c, depth: 0 });
  }
  return out;
}

/** 知识库分类管理页：两级分类的增删改查 + 启停。 */
export function KbCategoryPage() {
  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KbCategory | null>(null);
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  /* 列宽 + 表头排序（分类树一次性加载，无分页副作用） */
  const CATEGORY_COLS = useMemo<ResizableColumn[]>(
    () => [
      { key: 'name', label: '名称' },
      { key: 'enabled', label: '状态' },
      { key: 'sort', label: '排序' },
      { key: 'remark', label: '备注' },
      { key: 'updatedAt', label: '更新时间' },
      { key: '__ops__', label: '操作', locked: true },
    ],
    [],
  );
  const { widthOf, startResize, hasCustom, reset } = useColumnWidths(CATEGORY_COLS, 'mis-kb-category-table-widths');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await listCategories());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载分类失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => flattenCategories(categories), [categories]);
  const getSortValue = useCallback((row: FlatRow, key: string) => row.category[key as keyof KbCategory], []);
  const { sorted: sortedRows, sortKey, sortDir, toggleSort } = useClientSort(rows, getSortValue);
  const rootOptions = useMemo(
    () => categories.filter((c) => c.parentId == null || c.parentId === 0),
    [categories],
  );

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(c: KbCategory) {
    setEditing(c);
    setForm({
      name: c.name,
      parentId: c.parentId == null ? '' : String(c.parentId),
      enabled: String(c.enabled ?? 1),
      sort: String(c.sort ?? 0),
      remark: c.remark ?? '',
    });
    setOpen(true);
  }

  async function onSave() {
    if (!form.name.trim()) {
      toast.warning('请填写分类名称');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateCategory(editing.id, {
          name: form.name.trim(),
          enabled: Number(form.enabled) || 0,
          sort: Number(form.sort) || 0,
          remark: form.remark.trim() || null,
        });
      } else {
        await createCategory({
          name: form.name.trim(),
          parentId: form.parentId === '' ? null : Number(form.parentId),
          enabled: Number(form.enabled) || 0,
          sort: Number(form.sort) || 0,
          remark: form.remark.trim() || null,
        });
      }
      toast.success('已保存');
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(c: KbCategory) {
    if (!window.confirm(`删除分类「${c.name}」？分类下若仍有知识库将被后端拒绝。`)) return;
    try {
      await deleteCategory(c.id);
      toast.success('已删除');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="知识库分类"
        description="两级分类用于组织知识库；停用分类不影响已建知识库的可见性裁定。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'kb', title: '分类管理' })}
        actions={
          <PermissionGate permission="kb:category:add">
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增分类
            </Button>
          </PermissionGate>
        }
      />

      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        {hasCustom ? (
          <button
            type="button"
            onClick={reset}
            className="absolute right-3 top-3 z-20 rounded-md bg-card px-2 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground"
          >
            重置列宽
          </button>
        ) : null}
        <table className="w-full table-fixed border-separate border-spacing-0 bg-table-surface text-left text-sm">
          <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
            <tr>
              {CATEGORY_COLS.map((c, ci) => {
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    style={{ width: widthOf(c.key) }}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn(
                      'overflow-hidden whitespace-nowrap px-3 py-2 font-bold',
                      ci > 0 && 'border-l border-border/60',
                      c.locked && 'text-right',
                    )}
                  >
                    {c.locked ? (
                      c.label
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          'flex w-full items-center gap-1 text-left font-bold',
                          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {c.label}
                        <SortIndicator state={active ? sortDir : 'none'} />
                      </button>
                    )}
                    {!c.locked ? (
                      <span
                        role="separator"
                        aria-label={`调整${c.label}列宽`}
                        onMouseDown={(e) => startResize(e, c.key)}
                        className="absolute right-0 top-0 h-full w-[3px] cursor-col-resize"
                      />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  暂无分类
                </td>
              </tr>
            ) : (
              sortedRows.map(({ category, depth }) => (
                <tr
                  key={category.id}
                  className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                >
                  <td className="px-3 py-2">
                    <span style={{ paddingLeft: `${depth * 1.25}rem` }}>
                      {depth > 0 ? <span className="mr-1 text-muted-foreground">└</span> : null}
                      {category.name}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <EnabledBadge enabled={category.enabled} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{category.sort ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{category.remark ?? '-'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatTime(category.updatedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <PermissionGate permission="kb:category:edit">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => openEdit(category)}
                        >
                          <Pencil className="h-3 w-3" />
                          编辑
                        </button>
                      </PermissionGate>
                      <PermissionGate permission="kb:category:delete">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                          onClick={() => void onDelete(category)}
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
            <SheetTitle>{editing ? '编辑分类' : '新增分类'}</SheetTitle>
          </SheetHeader>
          <div className={SHEET_FORM_BODY}>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>名称 *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            {!editing ? (
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>上级分类</label>
                <select
                  className={selectClass}
                  value={form.parentId}
                  onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
                >
                  <option value="">（作为根分类）</option>
                  {rootOptions.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>状态</label>
              <select
                className={selectClass}
                value={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.value }))}
              >
                <option value="1">启用</option>
                <option value="0">停用</option>
              </select>
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>排序</label>
              <Input
                value={form.sort}
                onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))}
              />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>备注</label>
              <Input
                value={form.remark}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
              />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void onSave()}>
              保存
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
