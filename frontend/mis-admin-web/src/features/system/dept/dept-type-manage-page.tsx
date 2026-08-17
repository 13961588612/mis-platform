import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Folder, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import { TreeTable, type TreeTableColumn, type TreeTableNode } from '@/components/common/tree-table';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  createDeptType,
  deleteDeptType,
  updateDeptType,
} from '@/lib/api/dept-types';
import { listDeptTypeTree } from '@/lib/api/dept-types';
import { DeptTypeTreeSelect } from '@/components/common/dept-type-tree-select';
import type { DeptTypeTreeNode } from '@/types/api';
import { useDeptTypeVersionStore } from './dept-type-version-store';

const fieldLabel = SHEET_FORM_LABEL;
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

type DeptTypeRow = TreeTableNode & { node: DeptTypeTreeNode };

/**
 * 按展开集合扁平化：未展开节点不输出其子行。
 * 默认 expandedIds 为空 → 仅顶级分类可见。
 */
function flattenVisible(
  nodes: DeptTypeTreeNode[],
  expandedIds: Set<string>,
  depth = 0,
): DeptTypeRow[] {
  const out: DeptTypeRow[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, depth, node: n });
    const children = n.children ?? [];
    if (children.length > 0 && expandedIds.has(n.id)) {
      out.push(...flattenVisible(children, expandedIds, depth + 1));
    }
  }
  return out;
}

/**
 * 部门类型管理（V54 树形化）：
 *
 * <p>树表列：名称（展开/缩进）/ 编码 / 层级 / 末级 / 排序 / 状态 / 操作。
 * 默认仅展示顶级；有子节点时可展开收缩。行内「子类型」仅非末级（分类）可见；
 * 首次在末级下挂子级可在侧栏选「上级类型」。删除非末级被拦截。
 */
export function DeptTypeManagePage({ headerExtra }: { headerExtra?: ReactNode }) {
  const [tree, setTree] = useState<DeptTypeTreeNode[]>([]);
  /** 已展开节点 id；初始空 = 默认只显示顶级 */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeptTypeTreeNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', sort: '0', status: 1, parentId: '0', isLeaf: 1 });
  const bumpDeptTypeVersion = useDeptTypeVersionStore((s) => s.bumpDeptTypeVersion);

  const rows = useMemo(() => flattenVisible(tree, expandedIds), [tree, expandedIds]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTree(await listDeptTypeTree());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载部门类型失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(parentId: string | number = '0') {
    setEditing(null);
    setForm({ code: '', name: '', sort: '0', status: 1, parentId: String(parentId), isLeaf: 1 });
    setOpen(true);
  }

  function openEdit(row: DeptTypeTreeNode) {
    setEditing(row);
    setForm({
      code: row.code ?? '',
      name: row.name,
      sort: String(row.sort ?? 0),
      status: row.status ?? 1,
      parentId: String(row.parentId),
      isLeaf: row.isLeaf === 0 ? 0 : 1,
    });
    setOpen(true);
  }

  async function onSave() {
    if (!form.name.trim() || (!editing && !form.code.trim())) {
      toast.warning('请填写编码与名称');
      return;
    }
    const parentId = Number(form.parentId) || 0;
    setSaving(true);
    try {
      if (editing) {
        await updateDeptType(editing.id, {
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          status: form.status,
          parentId,
          isLeaf: form.isLeaf,
        });
        toast.success('已更新');
      } else {
        await createDeptType({
          code: form.code.trim(),
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          status: form.status,
          parentId,
          isLeaf: form.isLeaf,
        });
        toast.success('已创建');
        if (parentId !== 0) {
          setExpandedIds((prev) => new Set(prev).add(String(parentId)));
        }
      }
      setOpen(false);
      await load();
      bumpDeptTypeVersion();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(row: DeptTypeTreeNode) {
    if (row.isLeaf !== 1) {
      toast.warning('分类节点（非末级）不可删除，请先删除其下级类型');
      return;
    }
    const ref = row.referenceCount ?? 0;
    const hint = ref > 0 ? `（已被 ${ref} 个部门引用，后端将拦截）` : '';
    if (!window.confirm(`确认删除部门类型「${row.name}」？${hint}`)) return;
    try {
      await deleteDeptType(row.id);
      toast.success('已删除');
      await load();
      bumpDeptTypeVersion();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  const columns: TreeTableColumn<DeptTypeRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: '名称',
        cell: (row) => <span className="font-medium">{row.node.name}</span>,
      },
      {
        key: 'code',
        header: '编码',
        cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.node.code ?? '—'}</span>,
      },
      {
        key: 'level',
        header: '层级',
        cell: (row) => <span className="text-muted-foreground">L{row.depth + 1}</span>,
        className: 'text-center',
        align: 'center',
      },
      {
        key: 'leaf',
        header: '末级',
        cell: (row) =>
          row.node.isLeaf === 1 ? (
            <span className="inline-flex items-center rounded-md bg-success/10 px-2 py-0.5 text-xs text-success">末级</span>
          ) : (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">分类</span>
          ),
        className: 'text-center',
        align: 'center',
      },
      {
        key: 'sort',
        header: '排序',
        cell: (row) => row.node.sort ?? 0,
        className: 'text-center',
        align: 'center',
      },
      {
        key: 'status',
        header: '状态',
        cell: (row) => (
          <StatusBadge
            tone={(row.node.status ?? 1) === 1 ? 'success' : 'destructive'}
            text={(row.node.status ?? 1) === 1 ? '启用' : '禁用'}
          />
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="部门类型管理"
        description="部门类型层级树：默认仅顶级；是否末级为显式字段；仅非末级（分类）可挂子类型。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '组织架构',
          title: '部门管理',
        })}
        actions={
          <div className="flex items-center gap-2">
            {headerExtra ? <>{headerExtra}</> : null}
            <PermissionGate permission="system:dept-type:add">
              <Button size="sm" onClick={() => openCreate('0')}>
                <Plus className="h-4 w-4" />
                新增顶级类型
              </Button>
            </PermissionGate>
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">暂无部门类型</div>
        ) : (
          <TreeTable
            rows={rows}
            columns={columns}
            treeColumnKey="name"
            actionsAlwaysVisible
            storageKey="mis-dept-type-tree-table-widths-v1"
            rowIcon={(row) => {
              const hasChildren = (row.node.children?.length ?? 0) > 0;
              const expanded = expandedIds.has(row.node.id);
              const isLeaf = row.node.isLeaf === 1;
              return (
                <>
                  {hasChildren ? (
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={expanded ? '收起' : '展开'}
                      aria-expanded={expanded}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(row.node.id);
                      }}
                    >
                      <ChevronRight className={cn('h-3.5 w-3.5 transition', expanded && 'rotate-90')} />
                    </button>
                  ) : (
                    <span className="inline-block h-5 w-5 shrink-0" aria-hidden />
                  )}
                  {isLeaf ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </>
              );
            }}
            rowActions={(row) => (
              <>
                {/* 仅非末级（分类）可快捷新增子类型；末级请在侧栏选上级挂接 */}
                {row.node.isLeaf !== 1 ? (
                  <PermissionGate permission="system:dept-type:add">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                      onClick={() => openCreate(row.node.id)}
                    >
                      <Plus className="h-3 w-3" />
                      子类型
                    </button>
                  </PermissionGate>
                ) : null}
                <PermissionGate permission="system:dept-type:edit">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                    onClick={() => openEdit(row.node)}
                  >
                    <Pencil className="h-3 w-3" />
                    编辑
                  </button>
                </PermissionGate>
                <PermissionGate permission="system:dept-type:delete">
                  <button
                    type="button"
                    disabled={row.node.isLeaf !== 1}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void onDelete(row.node)}
                    title={row.node.isLeaf !== 1 ? '分类节点不可删除' : '删除'}
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </button>
                </PermissionGate>
              </>
            )}
            emptyText="暂无部门类型"
          />
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? '编辑部门类型' : '新增部门类型'}</SheetTitle>
          </SheetHeader>
          <div className={SHEET_FORM_BODY}>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>上级类型</label>
              <DeptTypeTreeSelect
                value={form.parentId === '0' ? null : form.parentId}
                onChange={(v) => setForm((f) => ({ ...f, parentId: v == null || v === '' ? '0' : String(v) }))}
                selectMode="non-leaf"
                excludeId={editing ? editing.id : null}
                placeholder="顶级（无上级）"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                仅可挂到非末级（分类）；留空为顶级。编辑时不可选自身及其下级。
              </p>
            </div>
            {!editing ? (
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>编码 *</label>
                <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
              </div>
            ) : (
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>编码</label>
                <Input value={editing.code ?? ''} disabled />
                <p className="mt-1 text-xs text-muted-foreground">编码创建后不可编辑</p>
              </div>
            )}
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>名称 *</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>是否末级 *</label>
              <select
                className={fieldInput}
                value={form.isLeaf}
                onChange={(e) => setForm((f) => ({ ...f, isLeaf: Number(e.target.value) }))}
              >
                <option value={1}>末级（可被部门选用）</option>
                <option value={0}>非末级 / 分类（可挂子类型）</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                显式字段：有子类型时不可改为末级；已被部门引用时不可改为分类。
              </p>
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
