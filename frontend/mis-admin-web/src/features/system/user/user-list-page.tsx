import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Shield,
  Sparkles,
  Trash2,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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
import type { AdminField, AdminPageDef } from '@/features/system/types';
import { AiFeature } from '@/features/ai/components/ai-feature';
import { AiFormFill } from '@/features/ai/components/ai-form-fill';
import { AiTextExtract } from '@/features/ai/components/ai-text-extract';
import { AiSummary } from '@/features/ai/components/ai-summary';
import { AiRag } from '@/features/ai/components/ai-rag';
import {
  FormFillBridgeProvider,
  toFormFieldSchema,
  type FormFillBridge,
} from '@/features/ai/context/form-fill-bridge';
import { listOrgs } from '@/lib/api/orgs';
import { fetchDeptTree } from '@/lib/api/depts';
import {
  assignUserRoles,
  createUser,
  deleteUser,
  pageUsers,
  resetUserPassword,
  updateUser,
  updateUserStatus,
} from '@/lib/api/users';
import { listEnabledRoles } from '@/lib/api/roles';
import type { DeptNode, OrgItem, RoleItem, UserView } from '@/types/api';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-foreground';

type FormMode = 'create' | 'edit' | 'roles' | 'detail';

function flattenDepts(nodes: DeptNode[], depth = 0): { node: DeptNode; depth: number }[] {
  const out: { node: DeptNode; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children?.length) out.push(...flattenDepts(n.children, depth + 1));
  }
  return out;
}

function statusLabel(status: number) {
  if (status === 1) return '启用';
  if (status === 2) return '锁定';
  return '禁用';
}

function statusTone(status: number): 'success' | 'warning' | 'destructive' {
  if (status === 1) return 'success';
  if (status === 2) return 'warning';
  return 'destructive';
}

function formatTime(v: string | null) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('zh-CN');
  } catch {
    return v;
  }
}

export function UserListPage() {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgId, setOrgId] = useState<string>('');
  const [deptTree, setDeptTree] = useState<DeptNode[]>([]);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<UserView[]>([]);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState<FormMode>('create');
  const [editing, setEditing] = useState<UserView | null>(null);
  const [viewing, setViewing] = useState<UserView | null>(null);
  const [saving, setSaving] = useState(false);
  // AI 面板开合状态
  const [aiFormOpen, setAiFormOpen] = useState(false);
  const [aiExtractOpen, setAiExtractOpen] = useState(false);
  const [aiRagOpen, setAiRagOpen] = useState(false);
  const [form, setForm] = useState({
    username: '',
    realName: '',
    employeeNo: '',
    email: '',
    phone: '',
    password: '',
    deptId: '',
    roleIds: [] as string[],
  });

  const size = 20;
  const flatDepts = useMemo(() => flattenDepts(deptTree), [deptTree]);

  // 最小合法 AdminPageDef：仅用于驱动 AI 表单回填桥接（schema 真源 = 本页表单字段）
  const userAiDef = useMemo<AdminPageDef>(
    () => ({
      id: 'user',
      group: '',
      title: '用户',
      description: '',
      columns: [],
      form: [
        { key: 'username', label: '用户名', type: 'text', required: true },
        { key: 'realName', label: '姓名', type: 'text', required: true },
        { key: 'employeeNo', label: '工号', type: 'text', required: true },
        { key: 'email', label: '邮箱', type: 'text' },
        { key: 'phone', label: '手机', type: 'text' },
        { key: 'deptId', label: '部门', type: 'select', options: [] },
        { key: 'roleIds', label: '角色', type: 'select', options: [] },
      ] as AdminField[],
      sample: [],
    }),
    [],
  );

  // 表单回填桥接：桥接 AI 组件与当前 form 状态（schema 真源 = userAiDef.form）
  const bridge = useMemo<FormFillBridge>(
    () => ({
      def: userAiDef,
      getSchema: () => toFormFieldSchema(userAiDef.form),
      getValues: () => form as unknown as Record<string, unknown>,
      applyFields: (partial) => {
        setForm((prev) => {
          const next = { ...prev };
          for (const [k, s] of Object.entries(partial)) {
            const val = s.value;
            if (k === 'deptId') {
              // AI 可能返回部门名 → 在 flatDepts 中按 node.name 匹配取 node.id
              const raw = String(val);
              const hit = flatDepts.find((d) => d.node.name === raw || d.node.id === raw);
              next.deptId = hit ? hit.node.id : raw;
            } else if (k === 'roleIds') {
              const arr = Array.isArray(val)
                ? val.map(String)
                : String(val)
                    .split(/[,，]/)
                    .map((x) => x.trim())
                    .filter(Boolean);
              next.roleIds = arr;
            } else if (
              k === 'username' ||
              k === 'realName' ||
              k === 'employeeNo' ||
              k === 'email' ||
              k === 'phone'
            ) {
              next[k] = String(val);
            }
          }
          return next;
        });
      },
      openCreate: () => openCreate(),
    }),
    [userAiDef, form, openCreate, flatDepts],
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await pageUsers({
        page,
        size,
        username: username.trim() || undefined,
        status: status === '' ? undefined : status,
        deptId: deptId || undefined,
      });
      setRows(data.list ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载用户失败');
    } finally {
      setLoading(false);
    }
  }, [page, size, username, status, deptId]);

  useEffect(() => {
    void (async () => {
      try {
        const [orgList, roleList] = await Promise.all([listOrgs(), listEnabledRoles()]);
        setOrgs(orgList);
        setRoles(roleList);
        if (orgList.length && !orgId) setOrgId(orgList[0].id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载组织失败');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首屏
  }, []);

  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      try {
        const tree = await fetchDeptTree(orgId);
        setDeptTree(tree);
        setExpanded({});
        setDeptId(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载部门树失败');
      }
    })();
  }, [orgId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  function openCreate() {
    setMode('create');
    setEditing(null);
    setForm({
      username: '',
      realName: '',
      employeeNo: '',
      email: '',
      phone: '',
      password: '',
      deptId: deptId ?? '',
      roleIds: [],
    });
    setSheetOpen(true);
  }

  function openEdit(row: UserView) {
    setMode('edit');
    setEditing(row);
    setForm({
      username: row.username,
      realName: row.realName ?? '',
      employeeNo: row.employeeNo ?? '',
      email: row.email ?? '',
      phone: row.phone ?? '',
      password: '',
      deptId: row.deptId ?? '',
      roleIds: row.roles?.map((r) => r.id) ?? [],
    });
    setSheetOpen(true);
  }

  function openRoles(row: UserView) {
    setMode('roles');
    setEditing(row);
    setForm((f) => ({ ...f, roleIds: row.roles?.map((r) => r.id) ?? [] }));
    setSheetOpen(true);
  }

  // 详情抽屉：只读展示用户字段 + AI 摘要/问答入口
  function openView(row: UserView) {
    setMode('detail');
    setViewing(row);
    setSheetOpen(true);
  }

  // UC-3 智能录入：先打开创建 Sheet（seed），再打开抽取面板
  const openSmartImport = () => {
    openCreate();
    setAiExtractOpen(true);
  };

  async function onSave() {
    setSaving(true);
    try {
      if (mode === 'create') {
        if (!form.username || !form.realName || !form.employeeNo || !form.deptId) {
          toast.warning('请填写用户名、姓名、工号并选择部门');
          return;
        }
        await createUser({
          username: form.username.trim(),
          realName: form.realName.trim(),
          employeeNo: form.employeeNo.trim(),
          deptId: Number(form.deptId),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          password: form.password.trim() || undefined,
          roleIds: form.roleIds.map(Number),
        });
        toast.success('已创建用户');
      } else if (mode === 'edit' && editing) {
        await updateUser(editing.id, {
          username: form.username.trim(),
          realName: form.realName.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
        });
        toast.success('已更新用户');
      } else if (mode === 'roles' && editing) {
        await assignUserRoles(editing.id, form.roleIds.map(Number));
        toast.success('已分配角色');
      }
      setSheetOpen(false);
      await loadUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus(row: UserView) {
    const next = row.status === 1 ? 0 : 1;
    try {
      await updateUserStatus(row.id, next);
      toast.success(next === 1 ? '已启用' : '已禁用');
      await loadUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新状态失败');
    }
  }

  async function onResetPwd(row: UserView) {
    if (!window.confirm(`确认重置用户「${row.username}」的密码？`)) return;
    try {
      await resetUserPassword(row.id);
      toast.success('已重置密码');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重置失败');
    }
  }

  async function onDelete(row: UserView) {
    if (!window.confirm(`确认删除用户「${row.username}」？`)) return;
    try {
      await deleteUser(row.id);
      toast.success('已删除');
      await loadUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <FormFillBridgeProvider value={bridge}>
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
        <PageHeader
          title="用户管理"
          description="左侧部门树筛选，右侧用户列表；手机号已脱敏。"
          actions={
            <div className="flex gap-2">
              <PermissionGate permission="system:user:add">
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  新增用户
                </Button>
              </PermissionGate>
              <AiFeature feature="text-extract">
                <Button size="sm" variant="outline" onClick={openSmartImport}>
                  <Sparkles className="h-4 w-4" />
                  智能录入
                </Button>
              </AiFeature>
            </div>
          }
        />

        <div className="flex min-h-0 flex-1 gap-3">
          {/* 左：组织 + 部门树 */}
          <aside className="flex w-60 shrink-0 flex-col rounded-lg border bg-card">
            <div className="border-b p-2">
              <select
                className={fieldInput}
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                aria-label="所属组织"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sidebar-scroll min-h-0 flex-1 overflow-auto p-1">
              <button
                type="button"
                className={cn(
                  'mb-0.5 w-full rounded-md px-2 py-1.5 text-left text-sm',
                  deptId == null ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
                )}
                onClick={() => {
                  setDeptId(null);
                  setPage(1);
                }}
              >
                全部部门
              </button>
              {flatDepts.map(({ node, depth }) => {
                const hasKids = Boolean(node.children?.length);
                const open = expanded[node.id] ?? depth < 1;
                return (
                  <div key={node.id} style={{ paddingLeft: depth * 12 }} className="flex items-center">
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
                      onClick={() => setExpanded((m) => ({ ...m, [node.id]: !open }))}
                      aria-label={open ? '折叠' : '展开'}
                    >
                      {hasKids ? (
                        open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <span className="inline-block w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-sm',
                        deptId === node.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
                      )}
                      onClick={() => {
                        setDeptId(node.id);
                        setPage(1);
                      }}
                    >
                      {node.name}
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* 右：筛选 + 表 */}
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card">
            <div className="flex flex-wrap items-end gap-2 border-b p-3">
              <div className="min-w-[10rem] flex-1">
                <label className={fieldLabel}>用户名</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="模糊搜索"
                  className="h-9"
                />
              </div>
              <div className="w-28">
                <label className={fieldLabel}>状态</label>
                <select
                  className={fieldInput}
                  value={status === '' ? '' : String(status)}
                  onChange={(e) => setStatus(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">全部</option>
                  <option value="1">启用</option>
                  <option value="0">禁用</option>
                  <option value="2">锁定</option>
                </select>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setPage(1);
                  void loadUsers();
                }}
              >
                <Search className="h-4 w-4" />
                查询
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="sticky top-0 z-[1] border-b bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-bold">工号</th>
                    <th className="px-3 py-2 font-bold">用户名</th>
                    <th className="px-3 py-2 font-bold">姓名</th>
                    <th className="px-3 py-2 font-bold">部门</th>
                    <th className="px-3 py-2 font-bold">手机</th>
                    <th className="px-3 py-2 font-bold">状态</th>
                    <th className="px-3 py-2 font-bold">创建时间</th>
                    <th className="px-3 py-2 font-bold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                        加载中…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2">{row.employeeNo ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{row.username}</span>
                          {row.isTenantAdmin === 1 ? (
                            <span className="ml-1 text-[0.7rem] text-amber-600">管理员</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">{row.realName ?? '—'}</td>
                        <td className="px-3 py-2">{row.deptName ?? '—'}</td>
                        <td className="px-3 py-2">{row.phone ?? '—'}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={statusTone(row.status)} text={statusLabel(row.status)} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{formatTime(row.createdAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <IconBtn title="详情" onClick={() => openView(row)}>
                              <Eye className="h-3.5 w-3.5" />
                            </IconBtn>
                            <PermissionGate permission="system:user:edit">
                              <IconBtn title="编辑" onClick={() => openEdit(row)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </IconBtn>
                            </PermissionGate>
                            <PermissionGate permission="system:user:resetPwd">
                              <IconBtn title="重置密码" onClick={() => void onResetPwd(row)}>
                                <KeyRound className="h-3.5 w-3.5" />
                              </IconBtn>
                            </PermissionGate>
                            <PermissionGate permission="system:user:edit">
                              <IconBtn title={row.status === 1 ? '禁用' : '启用'} onClick={() => void onToggleStatus(row)}>
                                <UserX className="h-3.5 w-3.5" />
                              </IconBtn>
                            </PermissionGate>
                            <PermissionGate permission="system:user:assignRole">
                              <IconBtn title="分配角色" onClick={() => openRoles(row)}>
                                <Shield className="h-3.5 w-3.5" />
                              </IconBtn>
                            </PermissionGate>
                            <PermissionGate permission="system:user:delete">
                              <IconBtn title="删除" onClick={() => void onDelete(row)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </IconBtn>
                            </PermissionGate>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
              <span>共 {total} 条</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </Button>
                <span>
                  {page} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent className="flex w-full flex-col sm:max-w-md">
            <SheetHeader>
              <SheetTitle>
                {mode === 'create'
                  ? '新增用户'
                  : mode === 'edit'
                    ? '编辑用户'
                    : mode === 'roles'
                      ? '分配角色'
                      : '用户详情'}
              </SheetTitle>
            </SheetHeader>

            {/* UC-1 AI 填充入口（创建/编辑 Sheet 顶部） */}
            {(mode === 'create' || mode === 'edit') && (
              <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
                <AiFeature feature="form-fill">
                  <Button variant="outline" size="sm" onClick={() => setAiFormOpen(true)}>
                    <Sparkles className="h-4 w-4" /> AI 填充
                  </Button>
                </AiFeature>
                <span className="text-xs text-muted-foreground">
                  对话或上传文档，AI 抽取字段回填（需你确认）
                </span>
              </div>
            )}

            <div className="flex-1 space-y-3 overflow-auto py-4">
              {mode === 'detail' && viewing ? (
                <UserDetail viewing={viewing} onAiRag={() => setAiRagOpen(true)} />
              ) : (
                <>
                  {mode !== 'roles' ? (
                    <>
                      <Field label="用户名" required>
                        <Input
                          value={form.username}
                          disabled={mode === 'edit'}
                          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                        />
                      </Field>
                      <Field label="姓名" required={mode === 'create'}>
                        <Input
                          value={form.realName}
                          onChange={(e) => setForm((f) => ({ ...f, realName: e.target.value }))}
                        />
                      </Field>
                      {mode === 'create' ? (
                        <>
                          <Field label="工号" required>
                            <Input
                              value={form.employeeNo}
                              onChange={(e) => setForm((f) => ({ ...f, employeeNo: e.target.value }))}
                            />
                          </Field>
                          <Field label="部门" required>
                            <select
                              className={fieldInput}
                              value={form.deptId}
                              onChange={(e) => setForm((f) => ({ ...f, deptId: e.target.value }))}
                            >
                              <option value="">请选择</option>
                              {flatDepts.map(({ node, depth }) => (
                                <option key={node.id} value={node.id}>
                                  {'　'.repeat(depth)}
                                  {node.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="初始密码">
                            <Input
                              type="password"
                              value={form.password}
                              placeholder="空则使用系统默认"
                              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                            />
                          </Field>
                        </>
                      ) : null}
                      <Field label="邮箱">
                        <Input
                          value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        />
                      </Field>
                      <Field label="手机">
                        <Input
                          value={form.phone}
                          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                        />
                      </Field>
                    </>
                  ) : null}

                  {(mode === 'create' || mode === 'roles') && (
                    <Field label="角色">
                      <div className="max-h-48 space-y-1 overflow-auto rounded-md border p-2">
                        {roles.map((r) => {
                          const checked = form.roleIds.includes(r.id);
                          return (
                            <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setForm((f) => ({
                                    ...f,
                                    roleIds: checked
                                      ? f.roleIds.filter((id) => id !== r.id)
                                      : [...f.roleIds, r.id],
                                  }))
                                }
                              />
                              {r.name}
                              <span className="text-xs text-muted-foreground">({r.code})</span>
                            </label>
                          );
                        })}
                      </div>
                    </Field>
                  )}
                </>
              )}
            </div>
            <SheetFooter>
              {mode === 'detail' ? (
                <Button variant="outline" onClick={() => setSheetOpen(false)}>
                  关闭
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setSheetOpen(false)}>
                    取消
                  </Button>
                  <Button disabled={saving} onClick={() => void onSave()}>
                    {saving ? '保存中…' : '保存'}
                  </Button>
                </>
              )}
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* UC-1 AI 表单填充面板 */}
        <Sheet open={aiFormOpen} onOpenChange={setAiFormOpen}>
          <SheetContent className="w-full max-w-[44rem] p-0 sm:max-w-[44rem]">
            <AiFormFill onClose={() => setAiFormOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* UC-3 AI 智能录入面板（文本/文档抽取） */}
        <Sheet open={aiExtractOpen} onOpenChange={setAiExtractOpen}>
          <SheetContent className="w-full max-w-[40rem] p-0 sm:max-w-[40rem]">
            <AiTextExtract onClose={() => setAiExtractOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* UC-4 AI 问答面板 */}
        <Sheet open={aiRagOpen} onOpenChange={setAiRagOpen}>
          <SheetContent className="w-full max-w-[40rem] p-0 sm:max-w-[40rem]">
            <AiRag
              record={(viewing ?? null) as unknown as Record<string, unknown> | null}
              onClose={() => setAiRagOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </FormFillBridgeProvider>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={fieldLabel}>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** 详情卡片：只读展示用户字段，并挂载 AI 摘要（UC-2）+ AI 问答（UC-4）入口 */
function UserDetail({ viewing, onAiRag }: { viewing: UserView; onAiRag: () => void }) {
  return (
    <>
      <div className="rounded-md">
        <AiFeature feature="detail-summary">
          <AiSummary record={viewing as unknown as Record<string, unknown>} defTitle="用户" />
        </AiFeature>
        <div className="mt-2 flex justify-end">
          <AiFeature feature="rag-qa">
            <Button variant="outline" size="sm" onClick={onAiRag}>
              <Sparkles className="h-4 w-4" /> AI 问答
            </Button>
          </AiFeature>
        </div>
      </div>
      <div className="mt-1">
        <DetailDefList
          items={[
            { label: '工号', value: viewing.employeeNo },
            { label: '用户名', value: viewing.username },
            { label: '姓名', value: viewing.realName },
            { label: '部门', value: viewing.deptName },
            { label: '组织', value: viewing.orgName },
            { label: '手机', value: viewing.phone },
            { label: '邮箱', value: viewing.email },
            { label: '角色', value: viewing.roles?.map((r) => r.name).join('、') },
            { label: '状态', value: <StatusBadge tone={statusTone(viewing.status)} text={statusLabel(viewing.status)} /> },
            { label: '创建时间', value: formatTime(viewing.createdAt) },
          ]}
        />
      </div>
    </>
  );
}
