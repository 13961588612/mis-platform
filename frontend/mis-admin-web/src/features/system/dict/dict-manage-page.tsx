import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { HEADER_ACTION_BTN_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
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
  createDictItem,
  createDictType,
  deleteDictItem,
  deleteDictType,
  listDictItems,
  listDictTypes,
  updateDictItem,
  updateDictType,
} from '@/lib/api/dicts';
import type { DictItem, DictTypeItem } from '@/types/api';

const fieldLabel = SHEET_FORM_LABEL;

const DICT_ITEM_COLUMNS: ResizableColumn[] = [
  { key: 'label', label: '标签' },
  { key: 'value', label: '值' },
  { key: 'sort', label: '排序' },
  { key: '__ops__', label: '操作', locked: true },
];

const thPad = 'px-3';

export function DictManagePage() {
  const [types, setTypes] = useState<DictTypeItem[]>([]);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [items, setItems] = useState<DictItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'type' | 'item'>('type');
  const [editingType, setEditingType] = useState<DictTypeItem | null>(null);
  const [editingItem, setEditingItem] = useState<DictItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [typeForm, setTypeForm] = useState({ code: '', name: '', remark: '' });
  const [itemForm, setItemForm] = useState({ label: '', value: '', sort: '0' });

  const { widthOf, startResize, hasCustom, reset: resetColWidths, tableStyle } = useColumnWidths(
    DICT_ITEM_COLUMNS,
    'mis-dict-item-table-widths',
  );

  const getValue = useCallback((row: DictItem, key: string) => {
    switch (key) {
      case 'label':
        return row.label;
      case 'value':
        return row.value;
      case 'sort':
        return row.sort;
      default:
        return null;
    }
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(items, getValue);

  const loadTypes = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listDictTypes();
      setTypes(list);
      setTypeId((prev) => prev ?? list[0]?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载字典类型失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadItems = useCallback(async (id: string) => {
    setLoadingItems(true);
    try {
      setItems(await listDictItems(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载字典项失败');
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  useEffect(() => {
    if (typeId) void loadItems(typeId);
  }, [typeId, loadItems]);

  function openTypeCreate() {
    setKind('type');
    setEditingType(null);
    setTypeForm({ code: '', name: '', remark: '' });
    setOpen(true);
  }

  function openTypeEdit(t: DictTypeItem) {
    setKind('type');
    setEditingType(t);
    setTypeForm({ code: t.code, name: t.name, remark: t.remark ?? '' });
    setOpen(true);
  }

  function openItemCreate() {
    if (!typeId) {
      toast.warning('请先选择字典类型');
      return;
    }
    setKind('item');
    setEditingItem(null);
    setItemForm({ label: '', value: '', sort: '0' });
    setOpen(true);
  }

  function openItemEdit(item: DictItem) {
    setKind('item');
    setEditingItem(item);
    setItemForm({ label: item.label, value: item.value, sort: String(item.sort ?? 0) });
    setOpen(true);
  }

  async function onSave() {
    setSaving(true);
    try {
      if (kind === 'type') {
        if (!typeForm.name.trim() || (!editingType && !typeForm.code.trim())) {
          toast.warning('请填写编码与名称');
          return;
        }
        if (editingType) {
          await updateDictType(editingType.id, {
            name: typeForm.name.trim(),
            remark: typeForm.remark.trim() || undefined,
          });
        } else {
          await createDictType({
            code: typeForm.code.trim(),
            name: typeForm.name.trim(),
            remark: typeForm.remark.trim() || undefined,
          });
        }
        toast.success('已保存类型');
        await loadTypes();
      } else if (typeId) {
        if (!itemForm.label.trim() || !itemForm.value.trim()) {
          toast.warning('请填写标签与值');
          return;
        }
        if (editingItem) {
          await updateDictItem(editingItem.id, {
            label: itemForm.label.trim(),
            value: itemForm.value.trim(),
            sort: Number(itemForm.sort) || 0,
          });
        } else {
          await createDictItem({
            typeId: Number(typeId),
            label: itemForm.label.trim(),
            value: itemForm.value.trim(),
            sort: Number(itemForm.sort) || 0,
          });
        }
        toast.success('已保存字典项');
        await loadItems(typeId);
      }
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteType(t: DictTypeItem) {
    if (!window.confirm(`删除类型「${t.name}」？`)) return;
    try {
      await deleteDictType(t.id);
      toast.success('已删除');
      if (typeId === t.id) setTypeId(null);
      await loadTypes();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  async function onDeleteItem(item: DictItem) {
    if (!window.confirm(`确认删除「${item.label}」？`)) return;
    try {
      await deleteDictItem(item.id);
      toast.success('已删除');
      if (typeId) await loadItems(typeId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="字典管理"
        description="字典类型 + 字典项。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '基础数据',
          title: '字典管理',
        })}
        actions={
          <div className="flex items-center gap-2">
            {hasCustom ? <ResetColWidthButton onClick={resetColWidths} /> : null}
            <PermissionGate permission="system:dict:add">
              <Button variant="outline" className={HEADER_ACTION_BTN_CLASS} onClick={openTypeCreate}>
                <Plus className="h-4 w-4" />
                类型
              </Button>
            </PermissionGate>
            <PermissionGate permission="system:dict:add">
              <Button className={HEADER_ACTION_BTN_CLASS} onClick={openItemCreate}>
                <Plus className="h-4 w-4" />
                字典项
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="w-56 shrink-0 overflow-auto rounded-lg border bg-card p-2">
          {loading ? (
            <p className="p-2 text-sm text-muted-foreground">加载中…</p>
          ) : types.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">暂无类型</p>
          ) : (
            types.map((t) => (
              <div key={t.id} className="group mb-0.5 flex items-center gap-1">
                <button
                  type="button"
                  className={cn(
                    'min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm',
                    typeId === t.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
                  )}
                  onClick={() => setTypeId(t.id)}
                >
                  {t.name}
                  <span className="ml-1 text-xs text-muted-foreground">{t.code}</span>
                </button>
                <PermissionGate permission="system:dict:edit">
                  <button
                    type="button"
                    className="hidden rounded p-1 text-muted-foreground group-hover:inline-flex hover:bg-accent"
                    onClick={() => openTypeEdit(t)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </PermissionGate>
                <PermissionGate permission="system:dict:delete">
                  <button
                    type="button"
                    className="hidden rounded p-1 text-muted-foreground group-hover:inline-flex hover:bg-accent"
                    onClick={() => void onDeleteType(t)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </PermissionGate>
              </div>
            ))
          )}
        </aside>

        <div className="min-w-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
          <table
            className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
            style={tableStyle}
          >
            <thead className="bg-table-header text-muted-foreground">
              <tr>
                {DICT_ITEM_COLUMNS.filter((c) => !c.locked).map((col) => {
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
              {loadingItems ? (
                <tr>
                  <td colSpan={DICT_ITEM_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                    加载中…
                  </td>
                </tr>
              ) : !typeId ? (
                <tr>
                  <td colSpan={DICT_ITEM_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                    请选择左侧字典类型
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={DICT_ITEM_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                    暂无字典项
                  </td>
                </tr>
              ) : (
                sorted.map((item) => (
                  <tr key={item.id} className="border-b border-border/50 last:border-0 bg-table-row even:bg-table-stripe hover:bg-table-hover">
                    <td className="px-3 py-2">{item.label}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.value}</td>
                    <td className="px-3 py-2">{item.sort}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <PermissionGate permission="system:dict:edit">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => openItemEdit(item)}
                          >
                            <Pencil className="h-3 w-3" />
                            编辑
                          </button>
                        </PermissionGate>
                        <PermissionGate permission="system:dict:delete">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                            onClick={() => void onDeleteItem(item)}
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
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {kind === 'type'
                ? editingType
                  ? '编辑类型'
                  : '新增类型'
                : editingItem
                  ? '编辑字典项'
                  : '新增字典项'}
            </SheetTitle>
          </SheetHeader>
          <div className={SHEET_FORM_BODY}>
            {kind === 'type' ? (
              <>
                {!editingType ? (
                  <div className={SHEET_FORM_FIELD}>
                    <label className={fieldLabel}>编码 *</label>
                    <Input
                      value={typeForm.code}
                      onChange={(e) => setTypeForm((f) => ({ ...f, code: e.target.value }))}
                    />
                  </div>
                ) : null}
                <div className={SHEET_FORM_FIELD}>
                  <label className={fieldLabel}>名称 *</label>
                  <Input
                    value={typeForm.name}
                    onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className={SHEET_FORM_FIELD}>
                  <label className={fieldLabel}>备注</label>
                  <Input
                    value={typeForm.remark}
                    onChange={(e) => setTypeForm((f) => ({ ...f, remark: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <>
                <div className={SHEET_FORM_FIELD}>
                  <label className={fieldLabel}>标签 *</label>
                  <Input
                    value={itemForm.label}
                    onChange={(e) => setItemForm((f) => ({ ...f, label: e.target.value }))}
                  />
                </div>
                <div className={SHEET_FORM_FIELD}>
                  <label className={fieldLabel}>值 *</label>
                  <Input
                    value={itemForm.value}
                    onChange={(e) => setItemForm((f) => ({ ...f, value: e.target.value }))}
                  />
                </div>
                <div className={SHEET_FORM_FIELD}>
                  <label className={fieldLabel}>排序</label>
                  <Input
                    value={itemForm.sort}
                    onChange={(e) => setItemForm((f) => ({ ...f, sort: e.target.value }))}
                  />
                </div>
              </>
            )}
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
