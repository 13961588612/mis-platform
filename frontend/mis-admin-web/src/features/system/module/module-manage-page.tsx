import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Boxes, Folder, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { DetailDefList } from '@/components/common/detail-def-list';
import { TreeTable, type TreeTableNode } from '@/components/common/tree-table';
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
  createModule,
  createModuleApi,
  deleteModule,
  deleteModuleApi,
  fetchModuleApiTree,
  fetchModuleBindings,
  fetchModules,
  updateModule,
  updateModuleApi,
} from '@/lib/api/modules';
import { type ModuleApiBinding, type ModuleApiNode, type ModuleItem } from '@/types/api';

const API_TYPE_OPTS = [
  { value: 'catalog', label: '分组' },
  { value: 'api', label: '接口' },
];
const HTTP_METHOD_OPTS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

const fieldLabel = SHEET_FORM_LABEL;
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

type ApiRow = TreeTableNode & { node: ModuleApiNode };

function flattenApis(nodes: ModuleApiNode[], depth = 0): ApiRow[] {
  const out: ApiRow[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, depth, node: n });
    if (n.children?.length) out.push(...flattenApis(n.children, depth + 1));
  }
  return out;
}

function MethodBadge({ method }: { method: string | null }) {
  if (!method) return <span className="text-[0.65rem] text-muted-foreground">分组</span>;
  const tone: Record<string, string> = {
    GET: 'bg-emerald-500/15 text-emerald-600',
    POST: 'bg-blue-500/15 text-blue-600',
    PUT: 'bg-amber-500/15 text-amber-600',
    DELETE: 'bg-rose-500/15 text-rose-600',
    PATCH: 'bg-violet-500/15 text-violet-600',
  };
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[0.65rem] font-semibold', tone[method] ?? 'bg-muted text-muted-foreground')}>
      {method}
    </span>
  );
}

export function ModuleManagePage() {
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [apiTree, setApiTree] = useState<ModuleApiNode[]>([]);
  const [bindings, setBindings] = useState<ModuleApiBinding[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<'apis' | 'bindings'>('apis');

  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [moduleEditing, setModuleEditing] = useState<ModuleItem | null>(null);
  const [moduleForm, setModuleForm] = useState({ code: '', name: '', serviceName: '', sort: '0', status: 1 });

  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [apiEditing, setApiEditing] = useState<ModuleApiNode | null>(null);
  const [apiForm, setApiForm] = useState({
    type: 'api',
    parentId: 0,
    name: '',
    httpMethod: 'GET',
    pathPattern: '',
    code: '',
    sort: '0',
    status: 1,
  });

  const selected = useMemo(
    () => modules.find((m) => String(m.id) === selectedId) ?? null,
    [modules, selectedId],
  );

  const catalogOptions = useMemo(() => {
    return flattenApis(apiTree)
      .filter((f) => f.node.type === 'catalog')
      .map((f) => ({ value: Number(f.node.id), label: '　'.repeat(f.depth) + f.node.name }));
  }, [apiTree]);

  const apiRows = useMemo(() => flattenApis(apiTree), [apiTree]);

  const loadModules = useCallback(async () => {
    setLoadingModules(true);
    try {
      setModules(await fetchModules());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载模块失败');
    } finally {
      setLoadingModules(false);
    }
  }, []);

  const loadDetail = useCallback(
    async (moduleId: string) => {
      setLoadingDetail(true);
      try {
        const [tree, binds] = await Promise.all([
          fetchModuleApiTree(moduleId),
          fetchModuleBindings(moduleId),
        ]);
        setApiTree(tree);
        setBindings(binds);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载模块详情失败');
      } finally {
        setLoadingDetail(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  function selectModule(id: string) {
    setSelectedId(id);
    void loadDetail(id);
  }

  // ---- 模块 新增/编辑 ----
  function openCreateModule() {
    setModuleEditing(null);
    setModuleForm({ code: '', name: '', serviceName: '', sort: '0', status: 1 });
    setModuleDialogOpen(true);
  }

  function openEditModule(m: ModuleItem) {
    setModuleEditing(m);
    setModuleForm({
      code: m.code,
      name: m.name,
      serviceName: m.serviceName,
      sort: String(m.sort ?? 0),
      status: m.status,
    });
    setModuleDialogOpen(true);
  }

  async function saveModule() {
    if (!moduleForm.code.trim() || !moduleForm.name.trim() || !moduleForm.serviceName.trim()) {
      toast.warning('请填写编码、名称与服务名');
      return;
    }
    try {
      if (moduleEditing) {
        await updateModule(moduleEditing.id, {
          name: moduleForm.name.trim(),
          serviceName: moduleForm.serviceName.trim(),
          sort: Number(moduleForm.sort) || 0,
          status: moduleForm.status,
        });
        toast.success('已更新模块');
      } else {
        await createModule({
          code: moduleForm.code.trim(),
          name: moduleForm.name.trim(),
          serviceName: moduleForm.serviceName.trim(),
          sort: Number(moduleForm.sort) || 0,
        });
        toast.success('已创建模块');
      }
      setModuleDialogOpen(false);
      await loadModules();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存模块失败');
    }
  }

  async function onDeleteModule(m: ModuleItem) {
    if (!window.confirm(`确认删除模块「${m.name}」？模块下存在接口或被菜单绑定时将无法删除。`)) return;
    try {
      await deleteModule(m.id);
      toast.success('已删除');
      if (selectedId === m.id) setSelectedId(null);
      await loadModules();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除模块失败');
    }
  }

  // ---- 接口 新增/编辑 ----
  function openCreateApi(parentId = 0) {
    if (!selectedId) return;
    setApiEditing(null);
    setApiForm({ type: 'api', parentId, name: '', httpMethod: 'GET', pathPattern: '', code: '', sort: '0', status: 1 });
    setApiDialogOpen(true);
  }

  function openEditApi(node: ModuleApiNode) {
    setApiEditing(node);
    setApiForm({
      type: node.type,
      parentId: Number(node.parentId) || 0,
      name: node.name,
      httpMethod: node.httpMethod ?? 'GET',
      pathPattern: node.pathPattern ?? '',
      code: node.code,
      sort: String(node.sort ?? 0),
      status: node.status,
    });
    setApiDialogOpen(true);
  }

  async function saveApi() {
    if (!selectedId) return;
    if (!apiForm.code.trim() || !apiForm.name.trim()) {
      toast.warning('请填写编码与名称');
      return;
    }
    try {
      const payload = {
        parentId: apiForm.parentId || 0,
        code: apiForm.code.trim(),
        type: apiForm.type,
        name: apiForm.name.trim(),
        httpMethod: apiForm.type === 'api' ? apiForm.httpMethod : null,
        pathPattern: apiForm.type === 'api' ? apiForm.pathPattern.trim() || null : null,
        sort: Number(apiForm.sort) || 0,
        status: apiForm.status,
      };
      if (apiEditing) {
        await updateModuleApi(apiEditing.id, payload);
        toast.success('已更新接口');
      } else {
        await createModuleApi({ moduleId: selectedId, ...payload });
        toast.success('已创建接口');
      }
      setApiDialogOpen(false);
      await loadDetail(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存接口失败');
    }
  }

  async function onDeleteApi(node: ModuleApiNode) {
    if (!window.confirm(`确认删除接口「${node.name}」？非空分组或已被菜单绑定的接口将无法删除。`)) return;
    try {
      await deleteModuleApi(node.id);
      toast.success('已删除');
      if (selectedId) await loadDetail(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除接口失败');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="接口模块管理"
        description="平台业务模块（sys_module）及其下接口树（sys_api）。模块停用后其接口全部 403 拒绝。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '应用与接口',
          title: '接口模块管理',
        })}
        actions={
          <PermissionGate permission="system:module:add">
            <Button size="sm" onClick={openCreateModule}>
              <Plus className="h-4 w-4" />
              新增模块
            </Button>
          </PermissionGate>
        }
      />

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 左：模块列表 */}
        <aside className="w-64 shrink-0 overflow-auto rounded-lg border bg-card p-2">
          {loadingModules ? (
            <p className="p-2 text-sm text-muted-foreground">加载中…</p>
          ) : modules.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">暂无模块</p>
          ) : (
            modules.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => selectModule(String(m.id))}
                className={cn(
                  'mb-0.5 flex w-full items-center gap-1 rounded-md py-1.5 pr-2 pl-2 text-left text-sm',
                  selectedId === String(m.id) ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
                )}
              >
                <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{m.name}</span>
                <span className="ml-auto shrink-0">
                  <StatusBadge text={m.status === 1 ? '启用' : '停用'} tone={m.status === 1 ? 'success' : 'destructive'} />
                </span>
              </button>
            ))
          )}
        </aside>

        {/* 模块详情：信息卡 + Tabs（接口树表 / 绑定关系） */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-table-surface">
          {!selected ? (
            <p className="p-4 text-sm text-muted-foreground">请选择左侧模块</p>
          ) : (
            <>
              <div className="border-b p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">{selected.name}</h2>
                  <div className="flex gap-1">
                    <PermissionGate permission="system:module:edit">
                      <Button size="sm" variant="outline" onClick={() => openEditModule(selected)}>
                        <Pencil className="h-3.5 w-3.5" />
                        编辑
                      </Button>
                    </PermissionGate>
                    <PermissionGate permission="system:module:delete">
                      <Button size="sm" variant="outline" onClick={() => void onDeleteModule(selected)}>
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    </PermissionGate>
                  </div>
                </div>
                <DetailDefList
                  className="mt-3"
                  items={[
                    { label: '编码', value: selected.code },
                    { label: '服务名', value: selected.serviceName },
                    { label: '排序', value: String(selected.sort) },
                    { label: '状态', value: selected.status === 1 ? '启用' : '停用' },
                    { label: '创建时间', value: selected.createdAt },
                    { label: '更新时间', value: selected.updatedAt },
                  ]}
                />
              </div>

              <div className="flex items-center justify-between border-b px-3 pt-2">
                <div className="flex gap-1">
                  <TabBtn active={activeTab === 'apis'} onClick={() => setActiveTab('apis')}>
                    接口列表
                  </TabBtn>
                  <TabBtn active={activeTab === 'bindings'} onClick={() => setActiveTab('bindings')}>
                    绑定关系
                  </TabBtn>
                </div>
                {activeTab === 'apis' ? (
                  <PermissionGate permission="system:module:add">
                    <Button size="sm" variant="outline" disabled={!selected} onClick={() => openCreateApi(0)}>
                      <Plus className="h-3.5 w-3.5" />
                      新增接口
                    </Button>
                  </PermissionGate>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto mt-3">
                <div className="px-3 pb-3">
                {activeTab === 'apis' ? (
                  <TreeTable<ApiRow>
                    rows={apiRows}
                    treeColumnKey="name"
                    emptyText="暂无接口"
                    storageKey="mis-module-api-table-widths"
                    rowIcon={(r) =>
                      r.node.type === 'catalog' ? (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <MethodBadge method={r.node.httpMethod} />
                      )
                    }
                    columns={[
                      { key: 'name', header: '名称', cell: (r) => <span className="truncate">{r.node.name}</span> },
                      {
                        key: 'type',
                        header: '类型',
                        cell: (r) => <span className="text-muted-foreground">{r.node.type === 'catalog' ? '分组' : '接口'}</span>,
                      },
                      { key: 'method', header: '方法', cell: (r) => <MethodBadge method={r.node.httpMethod} /> },
                      {
                        key: 'path',
                        header: '路径',
                        cell: (r) => <span className="break-all text-muted-foreground">{r.node.pathPattern ?? '—'}</span>,
                      },
                      {
                        key: 'status',
                        header: '状态',
                        cell: (r) => (
                          <StatusBadge
                            text={r.node.status === 1 ? '启用' : '停用'}
                            tone={r.node.status === 1 ? 'success' : 'destructive'}
                          />
                        ),
                      },
                    ]}
                    rowActions={(r) => (
                      <>
                        <PermissionGate permission="system:module:edit">
                          <button
                            type="button"
                            className="rounded p-1 text-primary hover:bg-primary/10"
                            onClick={() => openEditApi(r.node)}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </PermissionGate>
                        <PermissionGate permission="system:module:delete">
                          <button
                            type="button"
                            className="rounded p-1 text-destructive hover:bg-destructive/10"
                            onClick={() => void onDeleteApi(r.node)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </PermissionGate>
                      </>
                    )}
                  />
                ) : bindings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无绑定关系</p>
                ) : (
                  <table className="w-full border-separate border-spacing-0 bg-table-surface text-sm">
                    <thead className="border-b-2 border-foreground/20 text-left text-sm font-bold text-muted-foreground">
                      <tr>
                        <th className="sticky top-0 z-10 bg-table-header px-2 py-1.5">菜单</th>
                        <th className="sticky top-0 z-10 bg-table-header px-2 py-1.5">权限码</th>
                        <th className="sticky top-0 z-10 bg-table-header px-2 py-1.5">接口</th>
                        <th className="sticky top-0 z-10 bg-table-header px-2 py-1.5">方法</th>
                        <th className="sticky top-0 z-10 bg-table-header px-2 py-1.5">路径</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bindings.map((b, i) => (
                        <tr key={`${b.apiId}-${i}`} className="border-b border-border/50 last:border-0 bg-table-row even:bg-table-stripe hover:bg-table-hover">
                          <td className="px-2 py-1.5">{b.menuName}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{b.permission ?? '—'}</td>
                          <td className="px-2 py-1.5">{b.apiName}</td>
                          <td className="px-2 py-1.5">
                            <MethodBadge method={b.httpMethod} />
                          </td>
                          <td className="px-2 py-1.5 break-all text-muted-foreground">
                            {b.pathPattern ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    </table>
                )}
                  </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* 模块弹窗 */}
      <Sheet open={moduleDialogOpen} onOpenChange={setModuleDialogOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{moduleEditing ? '编辑模块' : '新增模块'}</SheetTitle>
          </SheetHeader>
          <div className={SHEET_FORM_BODY}>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>编码 *</label>
              <Input
                disabled={!!moduleEditing}
                value={moduleForm.code}
                onChange={(e) => setModuleForm((f) => ({ ...f, code: e.target.value }))}
              />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>名称 *</label>
              <Input value={moduleForm.name} onChange={(e) => setModuleForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>服务名 *</label>
              <Input
                value={moduleForm.serviceName}
                onChange={(e) => setModuleForm((f) => ({ ...f, serviceName: e.target.value }))}
              />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>排序</label>
              <Input value={moduleForm.sort} onChange={(e) => setModuleForm((f) => ({ ...f, sort: e.target.value }))} />
            </div>
            {moduleEditing ? (
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>状态</label>
                <select
                  className={fieldInput}
                  value={moduleForm.status}
                  onChange={(e) => setModuleForm((f) => ({ ...f, status: Number(e.target.value) }))}
                >
                  <option value={1}>启用</option>
                  <option value={0}>停用</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">停用的模块，其接口将全部 403 拒绝。</p>
              </div>
            ) : null}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setModuleDialogOpen(false)}>
              取消
            </Button>
            <Button disabled={loadingModules} onClick={() => void saveModule()}>
              保存
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 接口弹窗 */}
      <Sheet open={apiDialogOpen} onOpenChange={setApiDialogOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{apiEditing ? '编辑接口' : '新增接口'}</SheetTitle>
          </SheetHeader>
          <div className={SHEET_FORM_BODY}>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>所属模块</label>
              <Input value={selected?.name ?? ''} disabled />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>类型</label>
              <select
                className={fieldInput}
                value={apiForm.type}
                onChange={(e) => setApiForm((f) => ({ ...f, type: e.target.value }))}
              >
                {API_TYPE_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>父级分组</label>
              <select
                className={fieldInput}
                value={apiForm.parentId}
                onChange={(e) => setApiForm((f) => ({ ...f, parentId: Number(e.target.value) }))}
              >
                <option value={0}>根（模块下）</option>
                {catalogOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>编码 *</label>
              <Input value={apiForm.code} onChange={(e) => setApiForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>名称 *</label>
              <Input value={apiForm.name} onChange={(e) => setApiForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            {apiForm.type === 'api' ? (
              <>
                <div className={SHEET_FORM_FIELD}>
                  <label className={fieldLabel}>HTTP 方法</label>
                  <select
                    className={fieldInput}
                    value={apiForm.httpMethod}
                    onChange={(e) => setApiForm((f) => ({ ...f, httpMethod: e.target.value }))}
                  >
                    {HTTP_METHOD_OPTS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={SHEET_FORM_FIELD}>
                  <label className={fieldLabel}>路径模式</label>
                  <Input
                    value={apiForm.pathPattern}
                    placeholder="/api/v1/..."
                    onChange={(e) => setApiForm((f) => ({ ...f, pathPattern: e.target.value }))}
                  />
                </div>
              </>
            ) : null}
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>排序</label>
              <Input value={apiForm.sort} onChange={(e) => setApiForm((f) => ({ ...f, sort: e.target.value }))} />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>状态</label>
              <select
                className={fieldInput}
                value={apiForm.status}
                onChange={(e) => setApiForm((f) => ({ ...f, status: Number(e.target.value) }))}
              >
                <option value={1}>启用</option>
                <option value={0}>停用</option>
              </select>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setApiDialogOpen(false)}>
              取消
            </Button>
            <Button disabled={loadingDetail} onClick={() => void saveApi()}>
              保存
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-t-md px-3 py-1.5 text-sm',
        active ? 'border-b-2 border-primary font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
