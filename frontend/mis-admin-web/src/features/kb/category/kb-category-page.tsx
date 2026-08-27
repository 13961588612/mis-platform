import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
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
import { RESET_COL_WIDTH_OVERLAY_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
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
  listManageableCategoryIds,
  updateCategory,
} from '../api/kb-api';
import type { KbCategory } from '../types';
import { formatTime } from '../types';
import {
  CategoryTreeCell,
  buildCategoryOptions,
  flattenCategoryTree,
  initialExpandedSet,
  type FlatCategoryRow,
} from './kb-category-tree';
import { KbCategoryAdminDialog } from './kb-category-admin-dialog';
import { KbCategoryMoveDialog } from './kb-category-move-dialog';

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

/** 知识库分类管理页：任意层级分类的增删改查 + 启停 + 移动 + 管理员授权。 */
export function KbCategoryPage() {
  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [manageableIds, setManageableIds] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [onlyManageable, setOnlyManageable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KbCategory | null>(null);
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 管理员弹窗 / 移动弹窗
  const [adminCategory, setAdminCategory] = useState<KbCategory | null>(null);
  const [moveNode, setMoveNode] = useState<KbCategory | null>(null);

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
      const [list, ids] = await Promise.all([listCategories(), listManageableCategoryIds()]);
      setCategories(list);
      setManageableIds(new Set(ids));
      // 首次加载时全部展开；后续刷新保留用户折叠状态
      setExpanded((prev) => (prev.size === 0 ? initialExpandedSet(list) : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载分类失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => flattenCategoryTree(categories, expanded),
    [categories, expanded],
  );
  const getSortValue = useCallback((row: FlatCategoryRow, key: string) => {
    if (key === 'name') return row.category.name;
    return row.category[key as keyof KbCategory] as string | number | null;
  }, []);
  const { sorted: sortedRows, sortKey, sortDir, toggleSort } = useClientSort(rows, getSortValue);

  const visibleRows = useMemo(() => {
    if (!onlyManageable) return sortedRows;
    return sortedRows.filter((r) => manageableIds.has(r.category.id));
  }, [sortedRows, onlyManageable, manageableIds]);

  const parentOptions = useMemo(
    () => buildCategoryOptions(categories, editing?.id ?? null),
    [categories, editing],
  );

  function toggleNode(id: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openCreateChild(parent: KbCategory) {
    setEditing(null);
    setForm({ ...EMPTY_FORM, parentId: String(parent.id) });
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
    if (
      !window.confirm(
        `删除分类「${c.name}」？若仍有子分类或知识库，后端将拒绝删除；该节点的管理员授权将随节点一并清除。`,
      )
    )
      return;
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
        description="任意层级分类用于组织知识库；停用分类不影响已建知识库的可见性裁定。"
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

      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={onlyManageable}
            onChange={(e) => setOnlyManageable(e.target.checked)}
          />
          只看我可管理的节点
          <span className="text-xs text-muted-foreground/70">（高亮节点 = 在管辖范围内）</span>
        </label>
        <span className="text-xs text-muted-foreground">
          管辖范围 = 授权节点的整棵子树；全局管理员 = 全部分类
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        {hasCustom ? (
          <ResetColWidthButton onClick={reset} className={RESET_COL_WIDTH_OVERLAY_CLASS} />
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
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  {onlyManageable ? '当前管辖范围内暂无分类' : '暂无分类'}
                </td>
              </tr>
            ) : (
              visibleRows.map(({ category, depth }) => {
                const hasChildren = categories.some((c) => c.parentId === category.id);
                const manageable = manageableIds.has(category.id);
                return (
                  <tr
                    key={category.id}
                    className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                  >
                    <td className="px-3 py-2">
                      <CategoryTreeCell
                        category={category}
                        depth={depth}
                        expanded={expanded.has(category.id)}
                        hasChildren={hasChildren}
                        onToggle={() => toggleNode(category.id)}
                        manageable={manageable}
                      />
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
                        <PermissionGate permission="kb:category:add">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => openCreateChild(category)}
                          >
                            <Plus className="h-3 w-3" />
                            子分类
                          </button>
                        </PermissionGate>
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
                        <PermissionGate permission="kb:category:manage">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => setMoveNode(category)}
                          >
                            <ArrowRight className="h-3 w-3" />
                            移动
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => setAdminCategory(category)}
                          >
                            <ShieldCheck className="h-3 w-3" />
                            管理员
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
                );
              })
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
                  {parentOptions.map((o) => (
                    <option key={o.id} value={String(o.id)} disabled={!manageableIds.has(o.id)}>
                      {'　'.repeat(o.depth)}
                      {o.name}
                      {!manageableIds.has(o.id) ? '（管辖外）' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  上级分类须在管辖范围内（根分类需全局管理员）。
                </p>
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

      <KbCategoryAdminDialog
        open={adminCategory != null}
        onOpenChange={(o) => {
          if (!o) setAdminCategory(null);
        }}
        categoryId={adminCategory?.id ?? null}
        categoryName={adminCategory?.name ?? ''}
        onChanged={() => void load()}
      />

      <KbCategoryMoveDialog
        open={moveNode != null}
        onOpenChange={(o) => {
          if (!o) setMoveNode(null);
        }}
        node={moveNode}
        categories={categories}
        manageableIds={manageableIds}
        onMoved={() => void load()}
      />
    </div>
  );
}
