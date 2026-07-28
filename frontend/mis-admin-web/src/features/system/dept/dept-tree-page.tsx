import { useCallback, useEffect, useMemo, useState } from 'react';
import { Folder, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { TreeTable, type TreeTableColumn, type TreeTableNode } from '@/components/common/tree-table';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { listOrgs } from '@/lib/api/orgs';
import { createDept, deleteDept, fetchDeptTree, updateDept } from '@/lib/api/depts';
import type { DeptNode, OrgItem } from '@/types/api';

/** 种子数据：部门类别 id=3（部门） */
const DEFAULT_CATEGORY_ID = 3;

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

type DeptRow = TreeTableNode & { node: DeptNode };

function flatten(nodes: DeptNode[], depth = 0): DeptRow[] {
  const out: DeptRow[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, depth, node: n });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

export function DeptTreePage() {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgId, setOrgId] = useState('');
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeptNode | null>(null);
  const [parentId, setParentId] = useState('0');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', sort: '0', status: 1 });

  const rows = useMemo(() => flatten(tree), [tree]);

  const columns: TreeTableColumn<DeptRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: '部门名称',
        cell: (row) => <span className="font-medium">{row.node.name}</span>,
      },
      {
        key: 'code',
        header: '编码',
        cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.node.code ?? '—'}</span>,
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
            tone={row.node.status === 1 ? 'success' : 'destructive'}
            text={row.node.status === 1 ? '启用' : '禁用'}
          />
        ),
      },
    ],
    [],
  );

  const loadTree = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      setTree(await fetchDeptTree(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载部门失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listOrgs();
        setOrgs(list);
        if (list[0]) setOrgId(list[0].id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载组织失败');
      }
    })();
  }, []);

  useEffect(() => {
    if (orgId) void loadTree(orgId);
  }, [orgId, loadTree]);

  function openCreate(parent: string) {
    setEditing(null);
    setParentId(parent);
    setForm({ name: '', sort: '0', status: 1 });
    setOpen(true);
  }

  function openEdit(node: DeptNode) {
    setEditing(node);
    setParentId(node.parentId);
    setForm({ name: node.name, sort: String(node.sort ?? 0), status: node.status });
    setOpen(true);
  }

  async function onSave() {
    if (!form.name.trim() || !orgId) {
      toast.warning('请填写部门名称');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateDept(editing.id, {
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          status: form.status,
        });
        toast.success('已更新');
      } else {
        await createDept({
          orgId: Number(orgId),
          parentId: Number(parentId) || 0,
          name: form.name.trim(),
          categoryId: DEFAULT_CATEGORY_ID,
          sort: Number(form.sort) || 0,
        });
        toast.success('已创建');
      }
      setOpen(false);
      await loadTree(orgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(node: DeptNode) {
    if (!window.confirm(`确认删除部门「${node.name}」？`)) return;
    try {
      await deleteDept(node.id);
      toast.success('已删除');
      await loadTree(orgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title="部门管理"
        description="组织内部门树；新增子部门默认类别为「部门」。"
        actions={
          <div className="flex items-center gap-2">
            <select
              className={cn(fieldInput, 'w-40')}
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <PermissionGate permission="system:dept:add">
              <Button size="sm" onClick={() => openCreate(tree[0]?.id ?? '0')}>
                <Plus className="h-4 w-4" />
                新增部门
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          <TreeTable
            rows={rows}
            columns={columns}
            treeColumnKey="name"
            rowIcon={(row) => {
              const hasKids = Boolean(row.node.children?.length);
              return hasKids ? (
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <span className="inline-block w-3.5 shrink-0" />
              );
            }}
            rowActions={(row) => (
              <>
                <PermissionGate permission="system:dept:add">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                    onClick={() => openCreate(row.node.id)}
                  >
                    <Plus className="h-3 w-3" />
                    子部门
                  </button>
                </PermissionGate>
                <PermissionGate permission="system:dept:edit">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                    onClick={() => openEdit(row.node)}
                  >
                    <Pencil className="h-3 w-3" />
                    编辑
                  </button>
                </PermissionGate>
                <PermissionGate permission="system:dept:delete">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                    onClick={() => void onDelete(row.node)}
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </button>
                </PermissionGate>
              </>
            )}
            emptyText="暂无部门数据"
          />
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? '编辑部门' : '新增部门'}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-auto py-4">
            <div>
              <label className={fieldLabel}>名称 *</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className={fieldLabel}>排序</label>
              <Input value={form.sort} onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))} />
            </div>
            {editing ? (
              <div>
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
