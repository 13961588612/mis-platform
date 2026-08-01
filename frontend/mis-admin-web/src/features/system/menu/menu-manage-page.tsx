import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  AppWindow,
  Circle,
  EyeOff,
  Folder,
  Pencil,
  Plus,
  Search,
  Square,
  Trash2,
  Unlink,
  X,
  Zap,
  icons,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { DetailDefList } from '@/components/common/detail-def-list';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { createMenu, deleteMenu, fetchMenuTree, updateMenu } from '@/lib/api/menus';
import { fetchApps } from '@/lib/api/platform';
import type { AppItem, MenuNode } from '@/types/api';

type LucideIcon = React.ComponentType<{ className?: string }>;

const TYPE_META: Record<number, { label: string; Icon: LucideIcon; dotBg: string; badge: string; iconColor: string }> = {
  1: { label: '目录', Icon: Folder, dotBg: 'bg-muted text-muted-foreground', badge: 'bg-muted text-muted-foreground', iconColor: 'text-muted-foreground' },
  2: { label: '菜单', Icon: Square, dotBg: 'bg-primary/10 text-primary', badge: 'bg-primary/10 text-primary', iconColor: 'text-primary' },
  3: { label: '按钮', Icon: Zap, dotBg: 'bg-success/10 text-success', badge: 'bg-success/10 text-success', iconColor: 'text-success' },
};

const METHOD_META: Record<string, string> = {
  GET: 'bg-success/10 text-success',
  POST: 'bg-primary/10 text-primary',
  PUT: 'bg-warning/10 text-warning',
  DELETE: 'bg-destructive/10 text-destructive',
};

function typeMeta(t: number) {
  return TYPE_META[t] ?? TYPE_META[2];
}

function toPascal(s: string) {
  return s
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

const iconMap = icons as Record<string, LucideIcon>;

function flatten(nodes: MenuNode[], depth = 0): { node: MenuNode; depth: number }[] {
  const out: { node: MenuNode; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

function filterTree(
  nodes: MenuNode[],
  q: string,
  typeFilter: string,
): MenuNode[] {
  const out: MenuNode[] = [];
  for (const n of nodes) {
    const selfMatch =
      (!q || n.name.toLowerCase().includes(q)) &&
      (typeFilter === 'all' || n.type === Number(typeFilter));
    const kids = n.children?.length ? filterTree(n.children, q, typeFilter) : [];
    if (selfMatch) out.push({ ...n, children: kids.length ? kids : undefined });
    else if (kids.length) out.push({ ...n, children: kids });
  }
  return out;
}

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

export function MenuManagePage() {
  const [tree, setTree] = useState<MenuNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MenuNode | null>(null);
  const [parentId, setParentId] = useState('0');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [delTarget, setDelTarget] = useState<MenuNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 2,
    path: '',
    component: '',
    permission: '',
    icon: '',
    sort: '0',
    visible: 1,
    status: 1,
  });
  const [apps, setApps] = useState<AppItem[]>([]);
  const [appId, setAppId] = useState<string | null>(null);

  const flatAll = useMemo(() => flatten(tree), [tree]);
  const visibleFlat = useMemo(
    () => flatten(filterTree(tree, search.trim().toLowerCase(), typeFilter)),
    [tree, search, typeFilter],
  );
  const selected = flatAll.find((f) => f.node.id === selectedId)?.node ?? null;

  useEffect(() => {
    let alive = true;
    fetchApps()
      .then((list) => {
        if (alive) setApps(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async (targetAppId?: string | null) => {
    const useApp = targetAppId ?? appId;
    setLoading(true);
    try {
      const data = await fetchMenuTree(useApp ?? undefined);
      setTree(data);
      if (useApp == null) setAppId(data[0]?.appId ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载菜单失败');
    } finally {
      setLoading(false);
    }
  }, [appId]);

  const onAppChange = (id: string) => {
    setAppId(id);
    void load(id);
  };

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(pid: string) {
    setEditing(null);
    setParentId(pid);
    setForm({
      name: '',
      type: 2,
      path: '',
      component: '',
      permission: '',
      icon: '',
      sort: '0',
      visible: 1,
      status: 1,
    });
    setOpen(true);
  }

  function openEdit(node: MenuNode) {
    setEditing(node);
    setParentId(node.parentId);
    setForm({
      name: node.name,
      type: node.type,
      path: node.path ?? '',
      component: node.component ?? '',
      permission: node.permission ?? '',
      icon: node.icon ?? '',
      sort: String(node.sort ?? 0),
      visible: node.visible,
      status: node.status,
    });
    setOpen(true);
  }

  async function onSave() {
    if (!form.name.trim()) {
      toast.warning('请填写名称');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateMenu(editing.id, {
          name: form.name.trim(),
          path: form.path.trim() || undefined,
          component: form.component.trim() || undefined,
          permission: form.permission.trim() || undefined,
          icon: form.icon.trim() || undefined,
          sort: Number(form.sort) || 0,
          visible: form.visible,
          status: form.status,
        });
        toast.success('已更新');
      } else {
        await createMenu({
          parentId: Number(parentId) || 0,
          name: form.name.trim(),
          type: form.type,
          appId: appId ?? undefined,
          path: form.path.trim() || undefined,
          component: form.component.trim() || undefined,
          permission: form.permission.trim() || undefined,
          icon: form.icon.trim() || undefined,
          sort: Number(form.sort) || 0,
          visible: form.visible,
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

  async function confirmDelete() {
    const node = delTarget;
    if (!node) return;
    setDeleting(true);
    try {
      await deleteMenu(node.id);
      toast.success('已删除');
      if (selectedId === node.id) setSelectedId(null);
      setDelTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  const iconPreview = form.icon.trim() ? iconMap[toPascal(form.icon.trim())] : null;
  const IconPreviewC = iconPreview as LucideIcon;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      <PageHeader
        title="菜单管理"
        breadcrumbs={[{ label: '应用与接口' }, { label: '菜单管理' }]}
        description={`菜单树 · 类型：目录 / 菜单 / 按钮 · 共 ${flatAll.length} 个节点 · 可切换应用查看全部应用菜单`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <AppWindow className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">应用</span>
              <select
                value={appId ?? ''}
                onChange={(e) => onAppChange(e.target.value)}
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              >
                {apps.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.name}
                  </option>
                ))}
                {appId && !apps.some((a) => String(a.id) === appId) && (
                  <option value={appId}>应用 {appId}</option>
                )}
              </select>
            </div>
            <PermissionGate permission="system:menu:add">
              <Button size="sm" onClick={() => openCreate(selectedId ?? '0')}>
                <Plus className="h-4 w-4" />
                新增
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="space-y-2 border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索菜单名称"
                className="h-9 pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([['all', '全部'], ['1', '目录'], ['2', '菜单'], ['3', '按钮']] as const).map(
                ([val, label]) => {
                  const active = typeFilter === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setTypeFilter(val)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {label}
                    </button>
                  );
                },
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {loading ? (
              <p className="p-2 text-sm text-muted-foreground">加载中…</p>
            ) : visibleFlat.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">无匹配节点</p>
            ) : (
              visibleFlat.map(({ node, depth }) => {
                const meta = typeMeta(node.type);
                const Icon = meta.Icon;
                return (
                  <div
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    style={{ paddingLeft: 8 + depth * 12 }}
                    className={cn(
                      'group mb-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm',
                      selectedId === node.id
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'hover:bg-accent',
                    )}
                    onClick={() => setSelectedId(node.id)}
                  >
                    <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded', meta.dotBg)}>
                      <Icon className={cn('h-3.5 w-3.5', meta.iconColor)} />
                    </span>
                    <span className="truncate">{node.name}</span>
                    {node.visible !== 1 && (
                      <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    )}
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        node.status === 0 ? 'bg-muted-foreground' : 'bg-success',
                      )}
                    />
                    <span className="ml-auto hidden items-center gap-0.5 group-hover:flex">
                      <button
                        type="button"
                        title="新增子项"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCreate(node.id);
                        }}
                        className="rounded p-1 hover:bg-background"
                      >
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button
                        type="button"
                        title="编辑"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(node);
                        }}
                        className="rounded p-1 hover:bg-background"
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDelTarget(node);
                        }}
                        className="rounded p-1 hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-auto rounded-lg border bg-card p-4">
          {!selected ? (
            <div className="grid h-full place-items-center py-20 text-center">
              <div>
                <Square className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <p className="mt-3 text-sm text-muted-foreground">从左侧选择菜单节点查看详情</p>
                <p className="mt-1 text-xs text-muted-foreground">或点击右上角「新增」</p>
              </div>
            </div>
          ) : (
            (() => {
              const meta = typeMeta(selected.type);
              const DetailIcon = selected.icon ? (iconMap[toPascal(selected.icon)] as LucideIcon) : Circle;
              const kids = selected.children ?? [];
              const apis = selected.apiList ?? [];
              return (
                <div className="space-y-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={cn('grid h-9 w-9 place-items-center rounded-md', meta.dotBg)}>
                        <DetailIcon className={cn('h-5 w-5', meta.iconColor)} />
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', meta.badge)}>
                            {meta.label}
                          </span>
                          <h2 className="text-lg font-semibold">{selected.name}</h2>
                        </div>
                        <p className="text-xs text-muted-foreground">code {selected.code}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <PermissionGate permission="system:menu:add">
                        <Button size="sm" variant="outline" onClick={() => openCreate(selected.id)}>
                          <Plus className="h-3.5 w-3.5" />
                          子项
                        </Button>
                      </PermissionGate>
                      <PermissionGate permission="system:menu:edit">
                        <Button size="sm" variant="outline" onClick={() => openEdit(selected)}>
                          <Pencil className="h-3.5 w-3.5" />
                          编辑
                        </Button>
                      </PermissionGate>
                      <PermissionGate permission="system:menu:delete">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDelTarget(selected)}
                          className="border-destructive/40 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </Button>
                      </PermissionGate>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/30 p-4">
                    <h3 className="mb-3 text-sm font-semibold">基础信息</h3>
                    <DetailDefList
                      items={[
                        {
                          label: '图标',
                          value: (
                            <span className="grid h-6 w-6 place-items-center rounded bg-background">
                              <DetailIcon className="h-4 w-4" />
                            </span>
                          ),
                        },
                        { label: '名称', value: selected.name },
                        { label: '类型', value: meta.label },
                        {
                          label: '路由 path',
                          value: selected.path ? <Code>{selected.path}</Code> : '—',
                        },
                        {
                          label: '组件 component',
                          value: selected.component ? <Code>{selected.component}</Code> : '—',
                        },
                        {
                          label: '权限码 permission',
                          value: selected.permission ? <Code>{selected.permission}</Code> : '—',
                        },
                        { label: '排序', value: String(selected.sort) },
                        {
                          label: '可见',
                          value:
                            selected.visible === 1 ? (
                              <Badge className="bg-success/10 text-success">显示</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">隐藏</span>
                            ),
                        },
                        {
                          label: '状态',
                          value:
                            selected.status === 1 ? (
                              <Badge className="bg-success/10 text-success">启用</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">禁用</span>
                            ),
                        },
                      ]}
                    />
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">直接子节点（{kids.length}）</h3>
                    {kids.length ? (
                      <div className="overflow-hidden rounded-lg border bg-muted/20">
                        {kids.map((k) => {
                          const km = typeMeta(k.type);
                          const KIcon = km.Icon;
                          return (
                            <div
                              key={k.id}
                              role="button"
                              tabIndex={0}
                              className="flex cursor-pointer items-center gap-2 border-b border-border/50 px-3 py-2 text-sm last:border-0 hover:bg-muted/50 even:bg-muted/40"
                              onClick={() => setSelectedId(k.id)}
                            >
                              <span className={cn('grid h-5 w-5 place-items-center rounded', km.dotBg)}>
                                <KIcon className={cn('h-3.5 w-3.5', km.iconColor)} />
                              </span>
                              <span className="flex-1 truncate">{k.name}</span>
                              <span className="hidden text-xs text-muted-foreground sm:inline">
                                {k.permission || ''}
                              </span>
                              <span className={cn('rounded-full px-2 py-0.5 text-xs', km.badge)}>
                                {km.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">无子节点</p>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">关联 API（{apis.length}）</h3>
                      <span className="text-xs text-muted-foreground">经 sys_menu_api 绑定</span>
                    </div>
                    {apis.length ? (
                      <div className="space-y-1.5">
                        {apis.map((a, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-xs font-medium',
                                  METHOD_META[a.method] ?? 'bg-muted text-muted-foreground',
                                )}
                              >
                                {a.method}
                              </span>
                              <code className="text-xs">{a.path}</code>
                            </span>
                            <Unlink className="h-4 w-4 text-muted-foreground" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">该节点未绑定 API</p>
                    )}
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? '编辑菜单' : '新增菜单'}</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-4">
            <div>
              <label className={fieldLabel}>名称 *</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            {!editing ? (
              <div>
                <label className={fieldLabel}>类型</label>
                <select
                  className={fieldInput}
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: Number(e.target.value) }))}
                >
                  <option value={1}>目录</option>
                  <option value={2}>菜单</option>
                  <option value={3}>按钮</option>
                </select>
              </div>
            ) : null}
            {form.type !== 3 ? (
              <>
                <div>
                  <label className={fieldLabel}>路径</label>
                  <Input
                    value={form.path}
                    onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>组件</label>
                  <Input
                    value={form.component}
                    onChange={(e) => setForm((f) => ({ ...f, component: e.target.value }))}
                  />
                </div>
              </>
            ) : null}
            <div>
              <label className={fieldLabel}>权限码</label>
              <Input
                value={form.permission}
                onChange={(e) => setForm((f) => ({ ...f, permission: e.target.value }))}
              />
            </div>
            <div>
              <label className={fieldLabel}>图标（lucide 名称）</label>
              <div className="flex items-center gap-2">
                <Input
                  value={form.icon}
                  onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                  placeholder="如 users / shield"
                />
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-card">
                  {iconPreview ? (
                    <IconPreviewC className="h-4 w-4" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
              </div>
            </div>
            <div>
              <label className={fieldLabel}>排序</label>
              <Input
                value={form.sort}
                onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))}
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

      {delTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDelTarget(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-lg border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b p-4">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h2 className="text-base font-semibold">删除菜单</h2>
              <button
                type="button"
                onClick={() => setDelTarget(null)}
                className="ml-auto rounded-md p-1.5 hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2 p-4 text-sm">
              <p>
                确定删除菜单 <b>{delTarget.name}</b> ？
              </p>
              <p className="text-muted-foreground">
                {(delTarget.children?.length ?? 0) > 0
                  ? `该节点包含 ${delTarget.children?.length} 个子节点，删除将一并移除。`
                  : '删除后不可恢复。'}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t p-4">
              <Button variant="outline" onClick={() => setDelTarget(null)}>
                取消
              </Button>
              <Button
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs', className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-background px-1.5 py-0.5 text-xs">{children}</code>
  );
}
