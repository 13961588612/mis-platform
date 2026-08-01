import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Eye, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { DetailDefList } from '@/components/common/detail-def-list';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  assignRoleMenus,
  createRole,
  deleteRole,
  listRoleMenus,
  pageRoles,
  updateRole,
} from '@/lib/api/roles';
import { fetchMenuTree } from '@/lib/api/menus';
import { fetchApps } from '@/lib/api/platform';
import type { AppItem, MenuNode, RoleItem } from '@/types/api';

const DATA_SCOPE: Record<number, string> = {
  1: '全部数据',
  2: '本部门',
  3: '本部门及下级',
  4: '仅本人',
  5: '自定义部门',
  6: '本组织',
};

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

function descendantIds(node: MenuNode): string[] {
  const ids = [node.id];
  for (const c of node.children ?? []) ids.push(...descendantIds(c));
  return ids;
}

function buildParentMap(nodes: MenuNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (list: MenuNode[], parentId?: string) => {
    for (const n of list) {
      if (parentId) map.set(n.id, parentId);
      if (n.children?.length) walk(n.children, n.id);
    }
  };
  walk(nodes);
  return map;
}

function MenuTreeNode({
  node,
  checkedIds,
  onToggle,
  depth,
}: {
  node: MenuNode;
  checkedIds: Set<string>;
  onToggle: (ids: string[], next: boolean) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const descendants = useMemo(() => descendantIds(node), [node]);
  const childIds = descendants.slice(1);
  const allChildrenChecked = childIds.length > 0 && childIds.every((id) => checkedIds.has(id));
  const someChildChecked = childIds.some((id) => checkedIds.has(id));
  const checked = childIds.length > 0 ? allChildrenChecked : checkedIds.has(node.id);
  const indeterminate = someChildChecked && !allChildrenChecked;
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const isBranch = (node.children?.length ?? 0) > 0;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm hover:bg-muted/40',
          depth > 0 && 'ml-3 border-l border-border pl-2',
        )}
      >
        {isBranch ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            aria-label={open ? '收起' : '展开'}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <input
          ref={ref}
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-primary"
          checked={checked}
          onChange={() => onToggle(descendants, !checked)}
        />
        <span className="flex-1 truncate">{node.name}</span>
      </div>
      {isBranch && open ? (
        <div>
          {node.children!.map((c) => (
            <MenuTreeNode
              key={c.id}
              node={c}
              checkedIds={checkedIds}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuTree({
  nodes,
  checkedIds,
  onToggle,
}: {
  nodes: MenuNode[];
  checkedIds: Set<string>;
  onToggle: (ids: string[], next: boolean) => void;
}) {
  return (
    <div className="max-h-[60vh] space-y-0.5 overflow-auto rounded-md border p-2">
      {nodes.map((n) => (
        <MenuTreeNode key={n.id} node={n} checkedIds={checkedIds} onToggle={onToggle} depth={0} />
      ))}
    </div>
  );
}

export function RoleListPage() {
  const [rows, setRows] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [menus, setMenus] = useState<MenuNode[]>([]);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [menuAppId, setMenuAppId] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'edit' | 'menus' | 'detail'>('edit');
  const [editing, setEditing] = useState<RoleItem | null>(null);
  const [viewing, setViewing] = useState<RoleItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    appId: '',
    dataScope: 1,
    remark: '',
    status: 1,
    menuIds: [] as string[],
  });

  const parentMap = useMemo(() => buildParentMap(menus), [menus]);

  // Tree checkbox semantics: checking a node adds it + all descendants + all
  // ancestors (so backend route-tree building can still reach the leaf);
  // unchecking removes the node + its descendants only.
  const toggleMenus = useCallback(
    (ids: string[], next: boolean) => {
      setForm((f) => {
        const set = new Set(f.menuIds);
        if (next) {
          for (const id of ids) {
            set.add(id);
            let p = parentMap.get(id);
            while (p) {
              set.add(p);
              p = parentMap.get(p);
            }
          }
        } else {
          for (const id of ids) set.delete(id);
        }
        return { ...f, menuIds: Array.from(set) };
      });
    },
    [parentMap],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [page, tree, appList] = await Promise.all([
        pageRoles(1, 100),
        fetchMenuTree(),
        fetchApps(),
      ]);
      setRows(page.list ?? []);
      setMenus(tree);
      setApps(appList);
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
    setMode('edit');
    setForm({ code: '', name: '', appId: '', dataScope: 1, remark: '', status: 1, menuIds: [] });
    setOpen(true);
  }

  function openView(row: RoleItem) {
    setViewing(row);
    setEditing(null);
    setMode('detail');
    setOpen(true);
  }

  function openEdit(row: RoleItem) {
    setEditing(row);
    setViewing(null);
    setMode('edit');
    setForm({
      code: row.code,
      name: row.name,
      appId: row.appId ?? '',
      dataScope: row.dataScope ?? 1,
      remark: row.remark ?? '',
      status: row.status,
      menuIds: [],
    });
    setOpen(true);
  }

  async function openMenus(row: RoleItem) {
    setEditing(row);
    setMode('menus');
    setMenuAppId(row.appId ?? '');
    try {
      const [ids, tree] = await Promise.all([
        listRoleMenus(row.id),
        fetchMenuTree(row.appId || undefined),
      ]);
      setMenus(tree);
      setForm((f) => ({ ...f, menuIds: ids.map(String) }));
      setOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载角色菜单失败');
    }
  }

  async function reloadMenus(appId: string) {
    setMenuAppId(appId);
    try {
      const tree = await fetchMenuTree(appId || undefined);
      setMenus(tree);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载菜单树失败');
    }
  }

  async function onSave() {
    setSaving(true);
    try {
      if (mode === 'menus' && editing) {
        await assignRoleMenus(editing.id, form.menuIds.map(Number));
        toast.success('已分配菜单权限');
      } else if (editing) {
        await updateRole(editing.id, {
          name: form.name.trim(),
          appId: form.appId || undefined,
          dataScope: form.dataScope,
          status: form.status,
          remark: form.remark.trim() || undefined,
        });
        toast.success('已更新');
      } else {
        if (!form.code.trim() || !form.name.trim()) {
          toast.warning('请填写编码与名称');
          return;
        }
        await createRole({
          code: form.code.trim(),
          name: form.name.trim(),
          appId: form.appId || undefined,
          dataScope: form.dataScope,
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

  async function onDelete(row: RoleItem) {
    if (!window.confirm(`确认删除角色「${row.name}」？`)) return;
    try {
      await deleteRole(row.id);
      toast.success('已删除');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title="角色权限"
        description="角色基本信息与菜单权限分配。"
        actions={
          <PermissionGate permission="system:role:add">
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增角色
            </Button>
          </PermissionGate>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 border-b bg-table-stripe text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-bold">名称</th>
              <th className="px-3 py-2 font-bold">所属应用</th>
              <th className="px-3 py-2 font-bold">编码</th>
              <th className="px-3 py-2 font-bold">数据范围</th>
              <th className="px-3 py-2 font-bold">状态</th>
              <th className="px-3 py-2 font-bold">操作</th>
            </tr>
          </thead>
          <tbody className="bg-table-surface">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border/50 last:border-0 even:bg-table-stripe hover:bg-table-hover">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2">{apps.find((a) => a.id === row.appId)?.name ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                  <td className="px-3 py-2">{DATA_SCOPE[row.dataScope] ?? row.dataScope}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={row.status === 1 ? 'success' : 'destructive'} text={row.status === 1 ? '启用' : '禁用'} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                        onClick={() => openView(row)}
                      >
                        <Eye className="h-3 w-3" />
                        详情
                      </button>
                      <PermissionGate permission="system:role:edit">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="h-3 w-3" />
                          编辑
                        </button>
                      </PermissionGate>
                      <PermissionGate permission="system:role:assignMenu">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => void openMenus(row)}
                        >
                          <Shield className="h-3 w-3" />
                          权限
                        </button>
                      </PermissionGate>
                      <PermissionGate permission="system:role:delete">
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
            <SheetTitle>
              {mode === 'detail' ? '角色详情' : mode === 'menus' ? '分配菜单' : editing ? '编辑角色' : '新增角色'}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-auto py-4">
            {mode === 'detail' && viewing ? (
              <DetailDefList
                items={[
                  { label: '编码', value: viewing.code },
                  { label: '名称', value: viewing.name },
                  { label: '数据范围', value: DATA_SCOPE[viewing.dataScope] ?? viewing.dataScope },
                  { label: '状态', value: <StatusBadge tone={viewing.status === 1 ? 'success' : 'destructive'} text={viewing.status === 1 ? '启用' : '禁用'} /> },
                  { label: '备注', value: viewing.remark },
                ]}
              />
            ) : mode === 'edit' ? (
              <>
                {!editing ? (
                  <div>
                    <label className={fieldLabel}>编码 *</label>
                    <Input
                      value={form.code}
                      onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    />
                  </div>
                ) : null}
                <div>
                  <label className={fieldLabel}>所属应用</label>
                  <select
                    className={fieldInput}
                    value={form.appId}
                    onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}
                  >
                    <option value="">请选择</option>
                    {apps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={fieldLabel}>名称 *</label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>数据范围</label>
                  <div className="space-y-1.5">
                    {Object.entries(DATA_SCOPE).map(([k, v]) => {
                      const active = form.dataScope === Number(k);
                      return (
                        <label
                          key={k}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                            active
                              ? 'border-primary bg-primary/5 text-foreground'
                              : 'border-input bg-card hover:bg-muted/40',
                          )}
                        >
                          <input
                            type="radio"
                            name="dataScope"
                            value={k}
                            checked={active}
                            onChange={() => setForm((f) => ({ ...f, dataScope: Number(k) }))}
                            className="h-4 w-4 accent-primary"
                          />
                          <span>{v}</span>
                        </label>
                      );
                    })}
                  </div>
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
                <div>
                  <label className={fieldLabel}>备注</label>
                  <Input
                    value={form.remark}
                    onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className={fieldLabel}>菜单所属应用</label>
                  <select
                    className={fieldInput}
                    value={menuAppId}
                    onChange={(e) => void reloadMenus(e.target.value)}
                  >
                    <option value="">全部应用</option>
                    {apps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <MenuTree
                  nodes={menus}
                  checkedIds={new Set(form.menuIds)}
                  onToggle={toggleMenus}
                />
              </>
            )}
          </div>
          <SheetFooter>
            {mode === 'detail' ? (
              <Button variant="outline" onClick={() => setOpen(false)}>
                关闭
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button disabled={saving} onClick={() => void onSave()}>
                  保存
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
