import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { DetailDefList } from '@/components/common/detail-def-list';
import { StatusBadge } from '@/components/common/list-page-skeleton';
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
import type { AdminField, AdminPageDef } from '@/features/system/types';
import { AiFeature } from '@/features/ai/components/ai-feature';
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
import { DeptTreeSelect } from '@/components/common/dept-tree-select';
import { FilterMultiSelect } from '@/components/common/filter-multi-select';
import { HEADER_ACTION_BTN_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
import {
  assignUserRoles,
  createUser,
  deleteUser,
  listEmployeesByPhone,
  pageUsers,
  resetUserPassword,
  updateUser,
  updateUserStatus,
} from '@/lib/api/users';
import { listEnabledRoles } from '@/lib/api/roles';
import type { DeptNode, EmployeePhoneMatch, OrgItem, RoleItem, UserView } from '@/types/api';

import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';

const fieldLabel = SHEET_FORM_LABEL;
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm text-foreground';

/** 查询栏控件高度：与 Input h-9 对齐，避免 native select / 下拉触发器被 padding 撑高 */
const filterControlClass = 'h-9 min-h-9 py-0';

// 结果列：用户名 / 姓名 / 组织 / 部门 / 手机 / 状态 / 创建时间（已移除工号，对齐员工管理风格）
const USER_COLUMNS: ResizableColumn[] = [
  { key: 'username', label: '用户名' },
  { key: 'realName', label: '姓名' },
  { key: 'orgName', label: '组织' },
  { key: 'deptName', label: '部门' },
  { key: 'phone', label: '手机' },
  { key: 'status', label: '状态' },
  { key: 'createdAt', label: '创建时间' },
  { key: '__ops__', label: '操作', locked: true },
];

const thPad = 'px-3';

type FormMode = 'create' | 'edit' | 'perms' | 'detail';

interface OrgDeptGroup {
  orgId: string;
  orgName: string;
  items: { node: DeptNode; depth: number }[];
}

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
  const [username, setUsername] = useState('');
  const [realName, setRealName] = useState('');
  const [phone, setPhone] = useState('');
  const [queryOrgIds, setQueryOrgIds] = useState<string[]>([]);
  const [queryDeptIds, setQueryDeptIds] = useState<string[]>([]);
  const [status, setStatus] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<UserView[]>([]);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<RoleItem[]>([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState<FormMode>('create');
  const [editing, setEditing] = useState<UserView | null>(null);
  const [viewing, setViewing] = useState<UserView | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiAssistOpen, setAiAssistOpen] = useState(false);
  const [aiRagOpen, setAiRagOpen] = useState(false);
  const [form, setForm] = useState({
    username: '',
    realName: '',
    employeeId: '' as string,
    employeeName: '',
    email: '',
    phone: '',
    password: '',
    orgIds: [] as string[],
    deptIds: [] as string[],
    roleIds: [] as string[],
  });
  // 按手机查员工命中多个时，弹出手动选择
  const [phoneMatches, setPhoneMatches] = useState<EmployeePhoneMatch[]>([]);
  // 当前已选定（待绑定/已绑定）的员工详情，用于只读展示其组织/部门/岗位
  const [boundEmployee, setBoundEmployee] = useState<EmployeePhoneMatch | null>(null);

  // 权限 Sheet 内「组织 → 部门」按组织分组（Req5 修复：避免多组织树扁平拼接丢失归属）
  const [permsOrgGroups, setPermsOrgGroups] = useState<OrgDeptGroup[]>([]);

  const buildOrgGroups = useCallback(
    async (orgIds: string[]): Promise<OrgDeptGroup[]> => {
      if (!orgIds.length) return [];
      try {
        const trees = await Promise.all(orgIds.map((id) => fetchDeptTree(id)));
        return orgIds
          .map((oid, i) => ({
            orgId: oid,
            orgName: orgs.find((o) => o.id === oid)?.name ?? oid,
            items: flattenDepts(trees[i] ?? []),
          }))
          .filter((g) => g.items.length > 0);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载部门树失败');
        return [];
      }
    },
    [orgs],
  );

  const loadPermsDepts = useCallback(
    async (orgIds: string[]) => {
      setPermsOrgGroups(await buildOrgGroups(orgIds));
    },
    [buildOrgGroups],
  );

  // 组织变化 → 重新聚合部门树
  useEffect(() => {
    void loadPermsDepts(form.orgIds);
  }, [form.orgIds, loadPermsDepts]);

  // 部门树变化 → 剔除已不在范围内（如组织被取消勾选）的部门，避免脏选中
  useEffect(() => {
    if (permsOrgGroups.length === 0) return;
    const valid = new Set(permsOrgGroups.flatMap((g) => g.items.map((d) => d.node.id)));
    setForm((f) =>
      f.deptIds.some((id) => !valid.has(id))
        ? { ...f, deptIds: f.deptIds.filter((id) => valid.has(id)) }
        : f,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅依赖部门树快照
  }, [permsOrgGroups]);

  const size = 20;

  const { widthOf, startResize, hasCustom, reset: resetColWidths, tableStyle } = useColumnWidths(
    USER_COLUMNS,
    'mis-user-table-widths',
  );

  const getValue = useCallback((row: UserView, key: string) => {
    switch (key) {
      case 'username':
        return row.username;
      case 'realName':
        return row.realName ?? '';
      case 'orgName':
        return row.orgName ?? '';
      case 'deptName':
        return row.deptName ?? '';
      case 'phone':
        return row.phone ?? '';
      case 'status':
        return row.status;
      case 'createdAt':
        return row.createdAt ?? '';
      default:
        return null;
    }
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(rows, getValue);

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
        { key: 'email', label: '邮箱', type: 'text' },
        { key: 'phone', label: '手机', type: 'text' },
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
            if (k === 'roleIds') {
              const arr = Array.isArray(val)
                ? val.map(String)
                : String(val)
                    .split(/[,，]/)
                    .map((x) => x.trim())
                    .filter(Boolean);
              next.roleIds = arr;
            } else if (k === 'username' || k === 'realName' || k === 'email' || k === 'phone') {
              next[k] = String(val);
            }
          }
          return next;
        });
      },
      openCreate: () => openCreate(),
    }),
    [userAiDef, form, openCreate],
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await pageUsers({
        page,
        size,
        username: username.trim() || undefined,
        realName: realName.trim() || undefined,
        phone: phone.trim() || undefined,
        status: status === '' ? undefined : status,
        orgIds: queryOrgIds.map(Number),
        deptIds: queryDeptIds.map(Number),
      });
      setRows(data.list ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载用户失败');
    } finally {
      setLoading(false);
    }
  }, [page, size, username, realName, phone, status, queryOrgIds, queryDeptIds]);

  useEffect(() => {
    void (async () => {
      try {
        const [orgList, roleList] = await Promise.all([listOrgs(), listEnabledRoles()]);
        setOrgs(orgList);
        setRoles(roleList);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载组织失败');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首屏
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  function openCreate(opts?: { withAssist?: boolean }) {
    setMode('create');
    setEditing(null);
    setForm({
      username: '',
      realName: '',
      employeeId: '',
      employeeName: '',
      email: '',
      phone: '',
      password: '',
      orgIds: [],
      deptIds: [],
      roleIds: [],
    });
    setPhoneMatches([]);
    setAiAssistOpen(!!opts?.withAssist);
    setSheetOpen(true);
  }

  function openEdit(row: UserView) {
    setMode('edit');
    setEditing(row);
    setForm({
      username: row.username,
      realName: row.realName ?? '',
      employeeId: row.employeeId ?? '',
      employeeName: row.realName ?? '',
      email: row.email ?? '',
      phone: row.phone ?? '',
      password: '',
      orgIds: [],
      deptIds: [],
      roleIds: row.roles?.map((r) => r.id) ?? [],
    });
    setPhoneMatches([]);
    // 已绑定员工：用列表已有的组织/部门信息回填只读展示（岗位需重新检索时可点「检测绑定」）
    setBoundEmployee(
      row.employeeId
        ? {
            id: row.employeeId,
            realName: row.realName ?? '',
            deptId: null,
            deptName: row.deptName ?? null,
            orgName: row.orgName ?? null,
            posts: null,
          }
        : null,
    );
    setAiAssistOpen(false);
    setSheetOpen(true);
  }

  function openPerms(row: UserView) {
    setMode('perms');
    setEditing(row);
    // N7 / USR-01/03：优先使用后端返回的多组织/多部门数组，缺失时回退到单值字段，保证正确回填
    const orgIds = row.orgIds && row.orgIds.length ? row.orgIds : row.orgId ? [row.orgId] : [];
    const deptIds = row.deptIds && row.deptIds.length ? row.deptIds : row.deptId ? [row.deptId] : [];
    setForm((f) => ({
      ...f,
      orgIds,
      deptIds,
      roleIds: row.roles?.map((r) => r.id) ?? [],
    }));
    setSheetOpen(true);
  }

  // 权限 Sheet 内组织 / 部门多选切换（按组织分组渲染）
  function togglePermsOrg(id: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      orgIds: checked ? [...f.orgIds, id] : f.orgIds.filter((x) => x !== id),
    }));
  }

  function togglePermsDept(id: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      deptIds: checked ? [...f.deptIds, id] : f.deptIds.filter((x) => x !== id),
    }));
  }

  // 详情抽屉：只读展示用户字段 + AI 摘要/问答入口
  function openView(row: UserView) {
    setMode('detail');
    setViewing(row);
    setSheetOpen(true);
  }

  // UC-3 智能录入：打开新增表单，并在右侧展开辅助录入
  const openSmartImport = () => {
    openCreate({ withAssist: true });
  };

  const closeSheet = (open: boolean) => {
    setSheetOpen(open);
    if (!open) setAiAssistOpen(false);
  };

  const formModes = mode === 'create' || mode === 'edit';
  const splitAssist = formModes && aiAssistOpen;
  // 已绑定员工的用户：姓名/手机由员工模块维护，禁止在前端修改（与后端双保险，Req4）
  const bounded = mode === 'edit' && !!form.employeeId;

  async function checkPhone() {
    const value = form.phone.trim();
    if (!value) {
      setForm((f) => ({ ...f, employeeId: '', employeeName: '' }));
      setPhoneMatches([]);
      setBoundEmployee(null);
      return;
    }
    try {
      const matches = await listEmployeesByPhone(value);
      if (matches.length === 0) {
        setForm((f) => ({ ...f, employeeId: '', employeeName: '' }));
        setPhoneMatches([]);
        setBoundEmployee(null);
        toast.info(mode === 'create' ? '未匹配到员工，将创建为「非员工用户」' : '未匹配到员工，无法绑定');
      } else if (matches.length === 1) {
        const m = matches[0];
        setForm((f) => ({
          ...f,
          employeeId: m.id,
          employeeName: m.realName ?? '',
          realName: f.realName || m.realName || '',
        }));
        setBoundEmployee(m);
        setPhoneMatches([]);
        toast.success(`已匹配员工「${m.realName ?? ''}」，${mode === 'edit' ? '将在保存时绑定' : '将绑定该员工'}`);
      } else {
        // 多个员工同手机 → 提示并手动选择
        setPhoneMatches(matches);
        setForm((f) => ({ ...f, employeeId: '', employeeName: '' }));
        setBoundEmployee(null);
        toast.warning('该手机号匹配多个员工，请手动选择');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '查询员工失败');
    }
  }

  function choosePhoneMatch(id: string) {
    const m = phoneMatches.find((x) => x.id === id);
    if (!m) return;
    setForm((f) => ({
      ...f,
      employeeId: m.id,
      employeeName: m.realName ?? '',
      realName: f.realName || m.realName || '',
    }));
    setBoundEmployee(m);
    setPhoneMatches([]);
    toast.success(`已选择员工「${m.realName ?? ''}」，${mode === 'edit' ? '将在保存时绑定' : '将绑定'}`);
  }

  async function onSave() {
    setSaving(true);
    try {
      if (mode === 'create') {
        if (!form.username || !form.realName) {
          toast.warning('请填写用户名、姓名');
          return;
        }
        await createUser({
          username: form.username.trim(),
          realName: form.realName.trim(),
          employeeId: form.employeeId ? Number(form.employeeId) : undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          password: form.password.trim() || undefined,
          roleIds: form.roleIds.map(Number),
        });
        toast.success('已创建用户');
      } else if (mode === 'edit' && editing) {
        // 编辑：员工绑定随表单状态提交（换绑/解绑/不变）。组织/部门不在此处维护，由员工同步或权限页设置。
        await updateUser(editing.id, {
          username: form.username.trim(),
          employeeId: form.employeeId ? Number(form.employeeId) : null,
          realName: bounded ? undefined : form.realName.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: bounded ? undefined : form.phone.trim() || undefined,
        });
        toast.success('已更新用户');
      } else if (mode === 'perms' && editing) {
        // 权限页：始终带当前员工绑定，避免误触解绑；组织/部门对非员工用户生效
        await updateUser(editing.id, {
          username: editing.username,
          employeeId: editing.employeeId ? Number(editing.employeeId) : null,
          orgIds: form.orgIds.map(Number),
          deptIds: form.deptIds.map(Number),
        });
        await assignUserRoles(editing.id, form.roleIds.map(Number));
        toast.success('已保存权限');
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
  const dataCols = USER_COLUMNS.filter((c) => !c.locked);

  return (
    <FormFillBridgeProvider value={bridge}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          title="用户管理"
          description="按用户名/姓名/组织/部门/手机查询；非员工用户组织与部门可留空。"
          breadcrumbs={buildAppBreadcrumbs({
            app: 'system',
            group: '权限中心',
            title: '用户管理',
          })}
          actions={
            <div className="flex items-center gap-2">
              {hasCustom ? <ResetColWidthButton onClick={resetColWidths} /> : null}
              <PermissionGate permission="system:user:add">
                <Button type="button" className={HEADER_ACTION_BTN_CLASS} onClick={() => openCreate()}>
                  <Plus className="h-4 w-4" />
                  新增用户
                </Button>
              </PermissionGate>
              <AiFeature feature="text-extract">
                <Button type="button" variant="outline" className={HEADER_ACTION_BTN_CLASS} onClick={openSmartImport}>
                  <Sparkles className="h-4 w-4" />
                  智能录入
                </Button>
              </AiFeature>
            </div>
          }
        />

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* 查询条件（对齐员工管理：用户名 / 姓名 / 组织 / 部门 / 手机 / 状态） */}
          <div className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-end gap-2 p-3">
              <div className="w-32 shrink-0">
                <label className={fieldLabel}>用户名</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="模糊搜索"
                  className="h-9"
                />
              </div>
              <div className="w-32 shrink-0">
                <label className={fieldLabel}>姓名</label>
                <Input
                  value={realName}
                  onChange={(e) => setRealName(e.target.value)}
                  placeholder="姓名"
                  className="h-9"
                />
              </div>
              <div className="min-w-[12rem] flex-[1.4]">
                <label className={fieldLabel}>组织</label>
                <FilterMultiSelect
                  options={orgs.map((o) => ({ label: o.name, value: o.id }))}
                  value={queryOrgIds}
                  onChange={(v) =>
                    setQueryOrgIds(Array.isArray(v) ? (v as (string | number)[]).map(String) : [])
                  }
                  triggerClassName={filterControlClass}
                />
              </div>
              <div className="min-w-[12rem] flex-[1.4]">
                <label className={fieldLabel}>部门</label>
                <DeptTreeSelect
                  multiple
                  value={queryDeptIds.map(Number)}
                  onChange={(v) => setQueryDeptIds(v.map(String))}
                  className={filterControlClass}
                />
              </div>
              <div className="w-36 shrink-0">
                <label className={fieldLabel}>手机号码</label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="手机号"
                  className="h-9"
                />
              </div>
              <div className="w-28">
                <label className={fieldLabel}>状态</label>
                <select
                  className={cn(
                    'w-full rounded-md border border-input bg-card px-3 text-sm text-foreground',
                    filterControlClass,
                  )}
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
                className={HEADER_ACTION_BTN_CLASS}
                onClick={() => {
                  setPage(1);
                  void loadUsers();
                }}
              >
                <Search className="h-4 w-4" />
                查询
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className={HEADER_ACTION_BTN_CLASS}
                onClick={() => {
                  setUsername('');
                  setRealName('');
                  setPhone('');
                  setStatus('');
                  setQueryOrgIds([]);
                  setQueryDeptIds([]);
                  setPage(1);
                  void loadUsers();
                }}
              >
                重置
              </Button>
            </div>
          </div>

          {/* 结果表 */}
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card">
            <div className="min-h-0 flex-1 overflow-auto bg-table-surface">
              <table
                className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
                style={tableStyle}
              >
                <thead className="bg-table-header text-muted-foreground">
                  <tr>
                    {dataCols.map((col) => {
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
                  {loading ? (
                    <tr>
                      <td colSpan={USER_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                        加载中…
                      </td>
                    </tr>
                  ) : sorted.length === 0 ? (
                    <tr>
                      <td colSpan={USER_COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    sorted.map((row) => (
                      <tr key={row.id} className="border-b border-border/50 last:border-0 bg-table-row even:bg-table-stripe hover:bg-table-hover">
                        <td className="px-3 py-2">
                          <span className="font-medium">{row.username}</span>
                          {row.isTenantAdmin === 1 ? (
                            <span className="ml-1 text-[0.7rem] text-amber-600">管理员</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">{row.realName ?? '—'}</td>
                        <td className="px-3 py-2">{row.orgName ?? '—'}</td>
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
                              <IconBtn title="权限" onClick={() => openPerms(row)}>
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

        <Sheet open={sheetOpen} onOpenChange={closeSheet}>
          <SheetContent
            className={cn(
              'flex w-full flex-col',
              splitAssist ? 'sm:max-w-4xl' : 'sm:max-w-md',
            )}
          >
            <SheetHeader>
              <SheetTitle>
                {mode === 'create'
                  ? '新增用户'
                  : mode === 'edit'
                    ? '编辑用户'
                    : mode === 'perms'
                      ? '用户权限'
                      : '用户详情'}
              </SheetTitle>
            </SheetHeader>

            {formModes && (
              <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
                <AiFeature feature="text-extract">
                  <Button
                    variant={aiAssistOpen ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAiAssistOpen((v) => !v)}
                  >
                    <Sparkles className="h-4 w-4" />
                    {aiAssistOpen ? '收起辅助' : '辅助录入'}
                  </Button>
                </AiFeature>
                <span className="text-xs text-muted-foreground">
                  {aiAssistOpen
                    ? '右侧抽取后自动填入左侧表单，请核对后保存'
                    : '打开后在右侧粘贴/上传，识别结果写入左侧'}
                </span>
              </div>
            )}

            <div className={cn('flex min-h-0 flex-1', splitAssist ? 'flex-row' : 'flex-col')}>
              <div
                className={cn(
                  'flex min-h-0 min-w-0 flex-col',
                  splitAssist ? 'w-1/2 border-r' : 'flex-1',
                )}
              >
                <div className={SHEET_FORM_BODY}>
                  {mode === 'detail' && viewing ? (
                    <UserDetail viewing={viewing} onAiRag={() => setAiRagOpen(true)} />
                  ) : mode === 'perms' ? (
                    <>
                      <Field label="组织（可多选）">
                        <div className="max-h-40 space-y-1 overflow-auto rounded-md border p-2">
                          {orgs.map((o) => {
                            const checked = form.orgIds.includes(o.id);
                            return (
                              <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => togglePermsOrg(o.id, checked)}
                                />
                                {o.name}
                              </label>
                            );
                          })}
                        </div>
                      </Field>
                      <Field label="部门（可多选，按组织分组）">
                        {form.orgIds.length === 0 ? (
                          <p className="text-xs text-muted-foreground">请先选择组织</p>
                        ) : permsOrgGroups.length === 0 ? (
                          <p className="text-xs text-muted-foreground">该组织下暂无部门</p>
                        ) : (
                          <div className="max-h-56 space-y-2 overflow-auto rounded-md border p-2">
                            {permsOrgGroups.map((group) => (
                              <div key={group.orgId}>
                                <div className="mb-1 text-xs font-medium text-muted-foreground">
                                  {group.orgName}
                                </div>
                                {group.items.map(({ node, depth }) => {
                                  const checked = form.deptIds.includes(node.id);
                                  return (
                                    <label
                                      key={node.id}
                                      className="flex cursor-pointer items-center gap-2 text-sm"
                                      style={{ paddingLeft: depth * 14 + 8 }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => togglePermsDept(node.id, checked)}
                                      />
                                      {node.name}
                                    </label>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        )}
                      </Field>
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
                    </>
                  ) : (
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
                          disabled={mode === 'edit' && bounded}
                          onChange={(e) => setForm((f) => ({ ...f, realName: e.target.value }))}
                        />
                        {mode === 'edit' && bounded ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            已绑定员工，姓名由员工模块维护，不可修改
                          </p>
                        ) : null}
                      </Field>
                      {mode === 'create' ? (
                        <>
                          <Field label="手机">
                            <Input
                              value={form.phone}
                              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                              onBlur={() => void checkPhone()}
                              placeholder="失焦时检测是否已存在员工"
                            />
                            {form.employeeId ? (
                              <p className="mt-1 text-xs text-emerald-600">
                                将绑定员工：{form.employeeName || form.realName}
                              </p>
                            ) : null}
                            {phoneMatches.length > 1 ? (
                              <div className="mt-1">
                                <label className={fieldLabel}>选择要绑定的员工</label>
                                <select
                                  className={fieldInput}
                                  value=""
                                  onChange={(e) => choosePhoneMatch(e.target.value)}
                                >
                                  <option value="">请选择…</option>
                                  {phoneMatches.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.realName}
                                      {m.deptName ? `（${m.orgName ?? ''} / ${m.deptName}）` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : null}
                          </Field>
                          {/* 自动检测员工后展示其任职组织/部门/岗位，无需手工选择（Req2） */}
                          {boundEmployee ? <EmployeeInfoBlock emp={boundEmployee} /> : null}
                          <Field label="初始密码">
                            <Input
                              type="password"
                              value={form.password}
                              placeholder="空则使用系统默认"
                              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                            />
                          </Field>
                        </>
                      ) : (
                        <>
                          <Field label="手机">
                            <Input
                              value={form.phone}
                              disabled={bounded}
                              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                            />
                            {bounded ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                已绑定员工，手机由员工模块维护，不可修改
                              </p>
                            ) : null}
                          </Field>

                          {/* 编辑：支持手工绑定 / 解绑员工（Req2） */}
                          {bounded ? (
                            <Field label="员工绑定">
                              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-medium">
                                    已绑定员工：
                                    {editing?.realName ?? form.employeeName ?? boundEmployee?.realName ?? form.realName}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setForm((f) => ({ ...f, employeeId: '', employeeName: '' }));
                                      setBoundEmployee(null);
                                    }}
                                  >
                                    解绑员工
                                  </Button>
                                </div>
                                {boundEmployee ? <EmployeeInfoBlock emp={boundEmployee} /> : null}
                              </div>
                            </Field>
                          ) : (
                            <Field label="员工绑定">
                              <div className="flex items-center gap-2">
                                <Input
                                  value={form.phone}
                                  placeholder="输入手机号后点「检测绑定」"
                                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                                  className="h-9"
                                />
                                <Button type="button" variant="secondary" size="sm" onClick={() => void checkPhone()}>
                                  检测绑定
                                </Button>
                              </div>
                              {phoneMatches.length > 1 ? (
                                <div className="mt-1">
                                  <label className={fieldLabel}>选择要绑定的员工</label>
                                  <select
                                    className={fieldInput}
                                    value=""
                                    onChange={(e) => choosePhoneMatch(e.target.value)}
                                  >
                                    <option value="">请选择…</option>
                                    {phoneMatches.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.realName}
                                        {m.deptName ? `（${m.orgName ?? ''} / ${m.deptName}）` : ''}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : null}
                              {boundEmployee ? <EmployeeInfoBlock emp={boundEmployee} /> : null}
                            </Field>
                          )}
                        </>
                      )}
                      <Field label="邮箱">
                        <Input
                          value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        />
                      </Field>
                      {mode === 'create' && (
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
                    <Button variant="outline" onClick={() => closeSheet(false)}>
                      关闭
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => closeSheet(false)}>
                        取消
                      </Button>
                      <Button disabled={saving} onClick={() => void onSave()}>
                        {saving ? '保存中…' : '保存'}
                      </Button>
                    </>
                  )}
                </SheetFooter>
              </div>

              {splitAssist ? (
                <div className="flex w-1/2 min-h-0 min-w-0 flex-col bg-muted/10">
                  <AiTextExtract
                    embedded
                    autoApplyOnDone
                    onClose={() => setAiAssistOpen(false)}
                  />
                </div>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>

        {/* UC-4 AI 问答面板（详情场景仍独立） */}
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
    <div className={SHEET_FORM_FIELD}>
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

/** 任职信息只读展示块：新增/编辑用户时展示检测到的员工组织、部门、岗位情况（Req2） */
function EmployeeInfoBlock({ emp }: { emp: EmployeePhoneMatch }) {
  const posts = emp.posts && emp.posts.length > 0 ? emp.posts : null;
  return (
    <div className="rounded-md border border-dashed border-border/70 bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
        员工任职信息（自动同步，只读）
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <div className="flex gap-1.5">
          <span className="text-muted-foreground">任职组织：</span>
          <span className="font-medium">{emp.orgName ?? '—'}</span>
        </div>
        <div className="flex gap-1.5">
          <span className="text-muted-foreground">任职部门：</span>
          <span className="font-medium">{emp.deptName ?? '—'}</span>
        </div>
      </div>
      <div className="mt-2">
        <div className="mb-1 text-muted-foreground">岗位情况：</div>
        {posts ? (
          <ul className="space-y-1">
            {posts.map((p, i) => (
              <li
                key={p.postId ?? i}
                className="flex flex-wrap items-center gap-1.5 rounded border border-border/60 bg-background/60 px-2 py-1"
              >
                <span className="text-muted-foreground">{p.orgName ?? '—'}</span>
                <span className="text-muted-foreground">/</span>
                <span>{p.deptName ?? '—'}</span>
                <span className="text-muted-foreground">/</span>
                <span className="font-medium">{p.postName ?? '—'}</span>
                {p.isPrimary === 1 && (
                  <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                    主岗
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}
