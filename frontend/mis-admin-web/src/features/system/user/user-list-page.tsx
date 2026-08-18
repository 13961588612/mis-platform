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
import { fetchApps } from '@/lib/api/platform';
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
import { ApiError } from '@/lib/api/errors';
import { listEnabledRoles } from '@/lib/api/roles';
import { getConfigByKey } from '@/lib/api/configs';
import type {
  AppItem,
  EmployeeItem,
  EmployeePhoneMatch,
  OrgItem,
  RoleItem,
  UserView,
} from '@/types/api';

import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import { EmployeePickerDialog } from './employee-picker-dialog';
import { PermissionTabs } from './permission-tabs';

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

interface UserFormState {
  username: string;
  realName: string;
  employeeId: string;
  employeeName: string;
  email: string;
  phone: string;
  password: string;
  /** 所属 APP（显式归属，D1/D2），以字符串存储以适配原生 select */
  appId: string;
  orgIds: string[];
  deptIds: string[];
  roleIds: string[];
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
  const [apps, setApps] = useState<AppItem[]>([]);
  const [username, setUsername] = useState('');
  const [realName, setRealName] = useState('');
  const [phone, setPhone] = useState('');
  const [queryAppIds, setQueryAppIds] = useState<string[]>([]);
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
  const [form, setForm] = useState<UserFormState>({
    username: '',
    realName: '',
    employeeId: '',
    employeeName: '',
    email: '',
    phone: '',
    password: '',
    appId: '',
    orgIds: [],
    deptIds: [],
    roleIds: [],
  });
  // 按手机查员工命中多个时，弹出手动选择
  const [phoneMatches, setPhoneMatches] = useState<EmployeePhoneMatch[]>([]);
  // 当前已选定（待绑定/已绑定）的员工详情，用于只读展示其组织/部门/岗位
  const [boundEmployee, setBoundEmployee] = useState<EmployeePhoneMatch | null>(null);
  // 系统参数「用户是否强制绑定员工」（user.force.employee.bind）；开启时创建必须绑定、编辑禁止解绑
  const [forceBindEmp, setForceBindEmp] = useState(false);
  // 强制绑定场景下的员工选择对话框
  const [pickerOpen, setPickerOpen] = useState(false);
  // 字段级错误（T6）：字段名 → 错误文案，绑定到对应输入框的 error/helperText
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 修改表单字段并清除该字段已有的红字错误
  const patch = useCallback((p: Partial<UserFormState>) => {
    setForm((f) => ({ ...f, ...p }));
    setErrors((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(p) as (keyof UserFormState)[]) {
        if (next[k as string]) {
          delete next[k as string];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

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
        appIds: queryAppIds.map(Number),
      });
      setRows(data.list ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载用户失败');
    } finally {
      setLoading(false);
    }
  }, [page, size, username, realName, phone, status, queryOrgIds, queryDeptIds, queryAppIds]);

  useEffect(() => {
    void (async () => {
      try {
        const [orgList, roleList, appList] = await Promise.all([
          listOrgs(),
          listEnabledRoles(),
          fetchApps(),
        ]);
        setOrgs(orgList);
        setRoles(roleList);
        setApps(appList);
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
      appId: '',
      orgIds: [],
      deptIds: [],
      roleIds: [],
    });
    setErrors({});
    setPhoneMatches([]);
    setBoundEmployee(null);
    setPickerOpen(false);
    setForceBindEmp(false);
    void getConfigByKey('user.force.employee.bind')
      .then((c) => setForceBindEmp(c?.configValue === 'true'))
      .catch(() => setForceBindEmp(false));
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
      appId: row.appId ?? '',
      orgIds: [],
      deptIds: [],
      roleIds: row.roles?.map((r) => r.id) ?? [],
    });
    setErrors({});
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
    setPickerOpen(false);
    setForceBindEmp(false);
    void getConfigByKey('user.force.employee.bind')
      .then((c) => setForceBindEmp(c?.configValue === 'true'))
      .catch(() => setForceBindEmp(false));
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
      appId: row.appId ?? '',
      orgIds,
      deptIds,
      roleIds: row.roles?.map((r) => r.id) ?? [],
    }));
    setErrors({});
    setSheetOpen(true);
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

  const formModes = mode === 'create' || mode === 'edit' || mode === 'perms';
  const splitAssist = (mode === 'create' || mode === 'edit') && aiAssistOpen;
  // 已绑定员工的用户：姓名/手机由员工模块维护，禁止在前端修改（与后端双保险，Req4）
  // 强制绑定模式：员工来源唯一，手机号/姓名/邮箱由员工主数据提供且不可编辑
  const isForce = forceBindEmp;
  // 员工字段（手机/姓名/邮箱）是否禁用：强制模式或已绑定员工时禁用
  const empFieldsDisabled = isForce || !!form.employeeId;
  // 所属 APP 是否禁用：编辑且已绑定员工时禁用（其余场景可编辑）
  const appIdDisabled = mode === 'edit' && !!form.employeeId;

  async function checkPhone() {
    const value = form.phone.trim();
    if (!value) {
      patch({ employeeId: '', employeeName: '' });
      setPhoneMatches([]);
      setBoundEmployee(null);
      return;
    }
    try {
      const matches = await listEmployeesByPhone(value);
      if (matches.length === 0) {
        patch({ employeeId: '', employeeName: '' });
        setPhoneMatches([]);
        setBoundEmployee(null);
        if (forceBindEmp && mode === 'create') {
          toast.warning('系统已开启「用户强制绑定员工」，该手机号未匹配到员工，无法创建');
        } else {
          toast.info(mode === 'create' ? '未匹配到员工，将创建为「非员工用户」' : '未匹配到员工，无法绑定');
        }
      } else if (matches.length === 1) {
        const m = matches[0];
        patch({
          employeeId: m.id,
          employeeName: m.realName ?? '',
          realName: form.realName || m.realName || '',
        });
        setBoundEmployee(m);
        setPhoneMatches([]);
        toast.success(`已匹配员工「${m.realName ?? ''}」，${mode === 'edit' ? '将在保存时绑定' : '将绑定该员工'}`);
      } else {
        // 多个员工同手机 → 提示并手动选择
        setPhoneMatches(matches);
        patch({ employeeId: '', employeeName: '' });
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
    patch({
      employeeId: m.id,
      employeeName: m.realName ?? '',
      realName: form.realName || m.realName || '',
    });
    setBoundEmployee(m);
    setPhoneMatches([]);
    toast.success(`已选择员工「${m.realName ?? ''}」，${mode === 'edit' ? '将在保存时绑定' : '将绑定'}`);
  }

  // 强制绑定场景：从员工选择器回填手机 / 姓名 / 邮箱
  function onEmployeePicked(emp: EmployeeItem) {
    patch({
      employeeId: emp.id,
      employeeName: emp.realName,
      phone: emp.phone ?? '',
      realName: emp.realName,
      email: emp.email ?? '',
    });
    setBoundEmployee({
      id: emp.id,
      realName: emp.realName,
      deptId: null,
      deptName: null,
      orgName: emp.orgName ?? null,
      posts:
        emp.posts && emp.posts.length > 0
          ? emp.posts.map((p) => ({
              postId: p.postId,
              postName: p.postName ?? null,
              deptId: p.deptId ?? null,
              deptName: p.deptName ?? null,
              orgName: p.orgName ?? null,
              isPrimary: p.isPrimary,
            }))
          : null,
    });
    toast.success(`已绑定员工「${emp.realName}」`);
  }

  function unbindEmployee() {
    patch({ employeeId: '', employeeName: '' });
    setBoundEmployee(null);
  }

  async function onSave() {
    setSaving(true);
    setErrors({});
    try {
      if (mode === 'create') {
        if (!form.username.trim()) {
          setErrors({ username: '请输入用户名' });
          toast.warning('请填写用户名');
          return;
        }
        if (!form.appId) {
          setErrors({ appId: '请选择所属应用' });
          toast.warning('请选择所属应用');
          return;
        }
        if (isForce && !form.employeeId) {
          toast.warning('系统已开启「用户强制绑定员工」，请先通过「绑定员工」选择员工');
          return;
        }
        await createUser({
          username: form.username.trim(),
          appId: Number(form.appId),
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
          appId: form.appId ? Number(form.appId) : null,
          employeeId: form.employeeId ? Number(form.employeeId) : null,
          realName: empFieldsDisabled ? undefined : form.realName.trim() || undefined,
          email: empFieldsDisabled ? undefined : form.email.trim() || undefined,
          phone: empFieldsDisabled ? undefined : form.phone.trim() || undefined,
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
      // T6：按后端业务码将错误挂载到对应字段，保留 toast
      if (e instanceof ApiError) {
        const next: Record<string, string> = {};
        if (e.code === 40901) next.username = e.message;
        else if (e.code === 40918) next.phone = e.message;
        else if (e.code === 40001) next.appId = e.message; // VALIDATION_ERROR：归属 APP 冲突 / 改 APP 守卫
        else next.form = e.message;
        setErrors(next);
        toast.error(e.message);
      } else {
        toast.error(e instanceof Error ? e.message : '保存失败');
      }
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
          description="按用户名/姓名/组织/部门/手机/应用查询；非员工用户组织与部门可留空。"
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
          {/* 查询条件（对齐员工管理：用户名 / 姓名 / 组织 / 部门 / 所属APP / 手机 / 状态） */}
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
              <div className="min-w-[12rem] flex-[1.4]">
                <label className={fieldLabel}>所属APP</label>
                <FilterMultiSelect
                  options={apps.map((a) => ({ label: a.name, value: a.id }))}
                  value={queryAppIds}
                  onChange={(v) =>
                    setQueryAppIds(Array.isArray(v) ? (v as (string | number)[]).map(String) : [])
                  }
                  triggerClassName={filterControlClass}
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
                  setQueryAppIds([]);
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

            {formModes && mode !== 'perms' && (
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
                    <PermissionTabs
                      orgs={orgs}
                      roles={roles}
                      value={{ orgIds: form.orgIds, deptIds: form.deptIds, roleIds: form.roleIds }}
                      onChange={(next) => patch(next)}
                    />
                  ) : (
                    <>
                      {isForce && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                          系统已开启「用户强制绑定员工」：请先选择所属 APP，再通过「绑定员工」选择员工，其手机号 / 姓名 / 邮箱 将自动带入且不可编辑。未绑定员工不可保存。
                        </div>
                      )}

                      <Field label="所属APP" required error={errors.appId}>
                        <select
                          value={form.appId}
                          disabled={appIdDisabled}
                          aria-invalid={!!errors.appId}
                          onChange={(e) => patch({ appId: e.target.value })}
                          className={cn(
                            'w-full rounded-md border border-input bg-card px-3 py-2 text-sm',
                            filterControlClass,
                            errors.appId ? 'border-destructive' : '',
                          )}
                        >
                          <option value="">请选择应用</option>
                          {apps.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field label="手机" error={errors.phone}>
                        <Input
                          value={form.phone}
                          disabled={empFieldsDisabled}
                          aria-invalid={!!errors.phone}
                          onChange={(e) => patch({ phone: e.target.value })}
                          onBlur={() => {
                            if (!isForce) void checkPhone();
                          }}
                          placeholder={isForce ? '绑定员工后自动带入' : '失焦时检测是否已存在员工'}
                        />
                        {!!form.employeeId && !isForce ? (
                          <p className="mt-1 text-xs text-muted-foreground">已绑定员工，手机由员工模块维护，不可修改</p>
                        ) : null}
                      </Field>

                      <Field label="姓名" error={errors.realName}>
                        <Input
                          value={form.realName}
                          disabled={empFieldsDisabled}
                          onChange={(e) => patch({ realName: e.target.value })}
                        />
                        {!!form.employeeId ? (
                          <p className="mt-1 text-xs text-muted-foreground">已绑定员工，姓名由员工模块维护，不可修改</p>
                        ) : null}
                      </Field>

                      <Field label="邮箱" error={errors.email}>
                        <Input
                          value={form.email}
                          disabled={empFieldsDisabled}
                          onChange={(e) => patch({ email: e.target.value })}
                        />
                      </Field>

                      <Field label="用户名" required error={errors.username}>
                        <Input
                          value={form.username}
                          aria-invalid={!!errors.username}
                          onChange={(e) => patch({ username: e.target.value })}
                        />
                      </Field>

                      {mode === 'create' && (
                        <Field label="初始密码">
                          <Input
                            type="password"
                            value={form.password}
                            placeholder="空则使用系统默认"
                            onChange={(e) => patch({ password: e.target.value })}
                          />
                        </Field>
                      )}

                      {/* 员工绑定区 */}
                      {isForce ? (
                        <Field label="员工绑定">
                          {!!form.employeeId ? (
                            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">
                                  已绑定员工：{form.employeeName || form.realName}
                                </span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setPickerOpen(true)}
                                >
                                  重新选择
                                </Button>
                              </div>
                              {boundEmployee ? <EmployeeInfoBlock emp={boundEmployee} /> : null}
                            </div>
                          ) : (
                            <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
                              绑定员工
                            </Button>
                          )}
                        </Field>
                      ) : !!form.employeeId ? (
                        <Field label="员工绑定">
                          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">
                                已绑定员工：{form.employeeName || form.realName}
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isForce}
                                onClick={() => unbindEmployee()}
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
                              onChange={(e) => patch({ phone: e.target.value })}
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

        {/* 强制绑定员工选择器 */}
        <EmployeePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          appId={form.appId ? Number(form.appId) : undefined}
          excludeUserId={mode === 'edit' && editing ? editing.id : undefined}
          onPicked={onEmployeePicked}
        />

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
  error,
  children,
}: {
  label: string;
  required?: boolean;
  /** 字段级错误文案（T6），非空时在控件下方以红色展示 */
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={SHEET_FORM_FIELD}>
      <label className={fieldLabel}>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
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
    <div className="mt-2 rounded-md border border-dashed border-border/70 bg-muted/30 p-3 text-sm">
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
