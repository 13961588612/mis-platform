import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Folder, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
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
  createPostType,
  deletePostType,
  updatePostType,
} from '@/lib/api/posts';
import { listPostTypeTree } from '@/lib/api/post-types';
import { PostTypeTreeSelect } from '@/components/common/post-type-tree-select';
import type { PostTypeTreeNode } from '@/types/api';
import { usePostTypeVersionStore } from './post-type-version-store';

const fieldLabel = SHEET_FORM_LABEL;
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

type PostTypeRow = TreeTableNode & { node: PostTypeTreeNode };

/** 把后端树（children 递归）扁平化为带 depth 的行，用于 TreeTable 渲染。 */
function flatten(nodes: PostTypeTreeNode[], depth = 0): PostTypeRow[] {
  const out: PostTypeRow[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, depth, node: n });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

/**
 * 岗位类型管理（E.8 树形化）：
 *
 * <p>由原先扁平表格升级为「按 parentId 层级」的树表：列含 层级 / 名称(树) / 编码 / 上级类型 /
 * 末级 / 排序 / 状态 / 引用岗位数 / 操作。新增/编辑支持选择「上级类型」（PostTypeTreeSelect 父级模式，
 * 排除自身及其后代防环）。删除非末级（分类）被后端拦截，前端对分类节点禁用删除并提示。
 * 任何变更后 bump post-type-version-store，驱动岗位列表引擎重挂载刷新下拉（P0-PT-03）。
 */
export function PostTypeManagePage({ headerExtra }: { headerExtra?: ReactNode }) {
  // 树（含 parentId / isLeaf / children / referenceCount / status）
  const [tree, setTree] = useState<PostTypeTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PostTypeTreeNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', sort: '0', status: 1, parentId: '0' });
  const bumpPostTypeVersion = usePostTypeVersionStore((s) => s.bumpPostTypeVersion);

  const rows = useMemo(() => flatten(tree), [tree]);

  /** id → 名称 映射（解析「上级类型」展示用） */
  const idToName = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: PostTypeTreeNode[]) => {
      for (const n of nodes) {
        map.set(n.id, n.name);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTree(await listPostTypeTree());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载岗位类型失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(parentId: string | number = '0') {
    setEditing(null);
    setForm({ code: '', name: '', sort: '0', status: 1, parentId: String(parentId) });
    setOpen(true);
  }

  function openEdit(row: PostTypeTreeNode) {
    setEditing(row);
    setForm({
      code: row.code ?? '',
      name: row.name,
      sort: String(row.sort ?? 0),
      status: row.status ?? 1,
      parentId: String(row.parentId),
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
        await updatePostType(editing.id, {
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          status: form.status,
          parentId,
        });
        toast.success('已更新');
      } else {
        await createPostType({
          code: form.code.trim(),
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          status: form.status,
          parentId,
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

  async function onDelete(row: PostTypeTreeNode) {
    // 非末级（分类节点）不可删：后端拦截，前端直接禁用并提示
    if (row.isLeaf !== 1) {
      toast.warning('分类节点（非末级）不可删除，请先删除其下级类型');
      return;
    }
    const ref = row.referenceCount ?? 0;
    const hint = ref > 0 ? `（已被 ${ref} 个岗位引用，后端将拦截）` : '';
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

  const columns: TreeTableColumn<PostTypeRow>[] = useMemo(
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
        key: 'parent',
        header: '上级类型',
        cell: (row) => {
          if (!row.node.parentId || row.node.parentId === '0') {
            return <span className="text-muted-foreground">顶级（无上级）</span>;
          }
          return <span className="text-foreground/80">{idToName.get(row.node.parentId) ?? row.node.parentId}</span>;
        },
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
      {
        key: 'referenceCount',
        header: '引用岗位数',
        cell: (row) => {
          const c = row.node.referenceCount ?? 0;
          return c > 0 ? (
            <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {c} 个岗位
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
    ],
    [idToName],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="岗位类型管理"
        description="岗位类型（sys_post_type）层级树：支持多级分类（末级方可被岗位引用）；删除被引用/分类节点将被拦截。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '组织架构',
          title: '岗位管理',
        })}
        actions={
          <div className="flex items-center gap-2">
            {headerExtra ? <>{headerExtra}</> : null}
            <PermissionGate permission="system:post-type:add">
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
          <div className="p-10 text-center text-sm text-muted-foreground">暂无岗位类型</div>
        ) : (
          <TreeTable
            rows={rows}
            columns={columns}
            treeColumnKey="name"
            actionsAlwaysVisible
            storageKey="mis-post-type-tree-table-widths"
            rowIcon={(row) => {
              const isLeaf = row.node.isLeaf === 1;
              return isLeaf ? (
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              );
            }}
            rowActions={(row) => (
              <>
                <PermissionGate permission="system:post-type:add">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                    onClick={() => openCreate(row.node.id)}
                  >
                    <Plus className="h-3 w-3" />
                    子类型
                  </button>
                </PermissionGate>
                <PermissionGate permission="system:post-type:edit">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                    onClick={() => openEdit(row.node)}
                  >
                    <Pencil className="h-3 w-3" />
                    编辑
                  </button>
                </PermissionGate>
                <PermissionGate permission="system:post-type:delete">
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
            emptyText="暂无岗位类型"
          />
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? '编辑岗位类型' : '新增岗位类型'}</SheetTitle>
          </SheetHeader>
          <div className={SHEET_FORM_BODY}>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>上级类型</label>
              <PostTypeTreeSelect
                value={form.parentId}
                onChange={(v) => setForm((f) => ({ ...f, parentId: v == null ? '0' : String(v) }))}
                allowNonLeaf
                excludeId={editing ? editing.id : null}
                placeholder="顶级（无上级）"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                选择上级分类；新增顶级类型留空。编辑时不可选自身及其下级（防环）。
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
