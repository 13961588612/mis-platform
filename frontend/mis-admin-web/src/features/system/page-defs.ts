import type { AdminPageDef, Assignment, FieldOption } from './types';
import { fetchDeptTree } from '@/lib/api/depts';
import { listOrgs } from '@/lib/api/orgs';
import { fetchApps } from '@/lib/api/platform';
import { listEmployees, createEmployee, updateEmployee, deleteEmployee } from '@/lib/api/employees';
import { listPosts, createPost, updatePost, deletePost, listPostTypes } from '@/lib/api/posts';
import { listConfigs, createConfig, updateConfig, deleteConfig } from '@/lib/api/configs';
import type { DeptNode } from '@/types/api';

const STATUS_OPTS = [
  { value: 1, label: '启用' },
  { value: 0, label: '禁用' },
];

function statusText(status: unknown) {
  if (status === 1) return '启用';
  if (status === 2) return '锁定';
  return '禁用';
}

function withStatus(row: Record<string, unknown>) {
  if (!('status' in row)) return row;
  return { ...row, statusText: statusText(row.status) };
}

/**
 * 与「部门管理」页同源的部门可选项：拉取真实 sys_dept 树后扁平化为 {label, value}。
 * value 携带真实 dept id（提交时用 id 对齐后端）；接口失败或部门为空时回退空数组。
 */
export async function loadDeptOptions(): Promise<FieldOption[]> {
  const orgs = await listOrgs();
  const orgId = orgs[0]?.id;
  if (!orgId) return [];
  const tree = await fetchDeptTree(orgId);
  const options: FieldOption[] = [];
  const walk = (nodes: DeptNode[]) => {
    for (const node of nodes) {
      options.push({ value: node.id, label: node.name });
      if (node.children?.length) walk(node.children);
    }
  };
  walk(tree);
  return options;
}

/** 岗位可选项（真实 sys_post，value=id）；失败/为空回退空数组。 */
export async function loadPostOptions(): Promise<FieldOption[]> {
  const posts = await listPosts();
  return posts
    .filter((p) => p.status === 1)
    .map((p) => ({ value: p.id, label: p.name }));
}

/** 岗位类型可选项（真实 sys_post_type，value=id）；仅启用项（status=1）进下拉；失败/为空回退空数组。 */
export async function loadPostTypeOptions(): Promise<FieldOption[]> {
  const types = await listPostTypes();
  return types
    .filter((t) => t.status === 1)
    .map((t) => ({ value: t.id, label: t.name }));
}

/** 员工任职行 → 提交结构：{ deptIds(去重、首项主部门), posts(含 postId/isPrimary/startDate) } */
function employeeAssignmentPayload(
  values: Record<string, unknown>,
): { deptIds: number[]; posts: { postId: number; isPrimary: number; startDate: string | null }[] } {
  const assignments = (Array.isArray(values.assignments) ? values.assignments : []) as Assignment[];
  const deptIds = [...new Set(assignments.map((a) => String(a.dept).trim()).filter(Boolean))].map(Number);
  const posts = assignments
    .filter((a) => String(a.post).trim() !== '')
    .map((a) => ({
      postId: Number(a.post),
      isPrimary: a.isPrimary ? 1 : 0,
      startDate: a.startDate ? String(a.startDate) : null,
    }));
  return { deptIds, posts };
}

/** 对齐 system-admin-template.html · 当前菜单已挂载且走通用引擎的页面 */
export const SYSTEM_PAGE_DEFS: Record<string, AdminPageDef> = {
  '/system/employee': {
    id: 'employee',
    group: '组织架构',
    title: '员工管理',
    description: '租户员工自然人主数据（sys_employee），关联主部门与任职记录。',
    tableDensity: 'compact',
    /** 部门选项与「部门管理」同源：真实 sys_dept 拉取（value=id；接口失败回退空数组） */
    deptOptionsLoader: loadDeptOptions,
    /** 岗位下拉来自真实 sys_post */
    postOptionsLoader: loadPostOptions,
    filters: [
      { key: 'real_name', label: '姓名', type: 'text', col: 4 },
      { key: 'deptId', label: '主部门', type: 'select', col: 4, optionsFrom: 'dept' },
      { key: 'status', label: '状态', type: 'select', col: 2, options: STATUS_OPTS },
    ],
    columns: [
      { key: 'employee_no', label: '工号' },
      { key: 'real_name', label: '姓名' },
      { key: 'genderText', label: '性别' },
      { key: 'dept', label: '主部门' },
      { key: 'assignmentCount', label: '任职数' },
      { key: 'statusText', label: '状态', status: true },
    ],
    form: [
      { key: 'employee_no', label: '工号', type: 'text', col: 6, required: true },
      { key: 'real_name', label: '姓名', type: 'text', col: 6, required: true },
      {
        key: 'gender',
        label: '性别',
        type: 'select',
        col: 4,
        options: [
          { value: 1, label: '男' },
          { value: 2, label: '女' },
        ],
      },
      {
        key: 'assignments',
        label: '任职记录（可多部门多岗位，每行可标记主职）',
        type: 'assignments',
        col: 12,
        optionsFrom: 'dept',
      },
      { key: 'email', label: '邮箱', type: 'text', col: 6 },
      { key: 'phone', label: '手机号', type: 'text', col: 6 },
      { key: 'hire_date', label: '入职日期', type: 'text', col: 6 },
      { key: 'status', label: '状态', type: 'switch', col: 6 },
    ],
    detailExtra: (row) => [
      { label: '主部门', value: (row.dept as string) ?? '—' },
      { label: '主职位', value: (row.title as string) ?? '—' },
    ],
    loader: async () => {
      const employees = await listEmployees();
      return employees.map((e) => {
        const posts = e.posts ?? [];
        const primary = posts.find((p) => p.isPrimary === 1) ?? posts[0];
        return {
          id: e.id,
          employee_no: e.employeeNo,
          real_name: e.realName,
          gender: e.gender,
          dept: primary?.deptName ?? null,
          title: primary?.postName ?? e.title ?? null,
          genderText: e.gender === 1 ? '男' : e.gender === 2 ? '女' : '—',
          assignmentCount: posts.length,
          deptId: e.deptId,
          status: e.status,
          email: e.email,
          phone: e.phone,
          hire_date: e.hireDate,
          assignments: posts.map((p) => ({
            dept: p.deptId,
            deptLabel: p.deptName,
            post: p.postId,
            postLabel: p.postName,
            startDate: p.startDate,
            isPrimary: p.isPrimary === 1,
          })),
        };
      });
    },
    createApi: async (values) => {
      const { deptIds, posts } = employeeAssignmentPayload(values);
      if (!deptIds.length) {
        throw new Error('请至少填写一条任职记录（任职部门必填）');
      }
      await createEmployee({
        deptId: deptIds[0],
        deptIds,
        employeeNo: String(values.employee_no ?? ''),
        realName: String(values.real_name ?? ''),
        email: values.email ? String(values.email) : undefined,
        phone: values.phone ? String(values.phone) : undefined,
        gender: values.gender === '' || values.gender == null ? undefined : Number(values.gender),
        title: values.title ? String(values.title) : undefined,
        hireDate: values.hire_date ? String(values.hire_date) : undefined,
        posts,
      });
    },
    updateApi: async (id, values) => {
      const { deptIds, posts } = employeeAssignmentPayload(values);
      const body: Parameters<typeof updateEmployee>[1] = {
        realName: String(values.real_name ?? ''),
        email: values.email ? String(values.email) : undefined,
        phone: values.phone ? String(values.phone) : undefined,
        gender: values.gender === '' || values.gender == null ? undefined : Number(values.gender),
        title: values.title ? String(values.title) : undefined,
        hireDate: values.hire_date ? String(values.hire_date) : undefined,
        status: values.status === '' || values.status == null ? undefined : Number(values.status),
      };
      if (deptIds.length) {
        body.deptId = deptIds[0];
        body.deptIds = deptIds;
      }
      body.posts = posts;
      await updateEmployee(id, body);
    },
    deleteApi: async (id) => {
      await deleteEmployee(id);
    },
    decorate: withStatus,
  },
  '/system/post': {
    id: 'post',
    group: '组织架构',
    title: '岗位管理',
    description: '部门岗位编制（sys_post / sys_post_type），支持兼职多岗。',
    tableDensity: 'compact',
    /** 部门选项与「部门管理」同源：真实 sys_dept 拉取（value=id；接口失败回退空数组） */
    deptOptionsLoader: loadDeptOptions,
    /** 岗位类型下拉来自真实 sys_post_type */
    postTypeOptionsLoader: loadPostTypeOptions,
    filters: [
      { key: 'name', label: '岗位名称', type: 'text', col: 4 },
      { key: 'deptId', label: '所属部门', type: 'select', col: 4, optionsFrom: 'dept' },
      { key: 'status', label: '状态', type: 'select', col: 2, options: STATUS_OPTS },
    ],
    columns: [
      { key: 'code', label: '岗位编码' },
      { key: 'name', label: '岗位名称' },
      { key: 'dept', label: '所属部门' },
      { key: 'post_type', label: '岗位类型' },
      { key: 'statusText', label: '状态', status: true },
    ],
    form: [
      { key: 'deptId', label: '所属部门', type: 'select', col: 6, required: true, optionsFrom: 'dept' },
      { key: 'postTypeId', label: '岗位类型', type: 'select', col: 6, required: true, optionsFrom: 'post-type' },
      { key: 'code', label: '岗位编码', type: 'text', col: 6, required: true },
      { key: 'name', label: '岗位名称', type: 'text', col: 6, required: true },
      { key: 'status', label: '状态', type: 'switch', col: 6 },
    ],
    loader: async () => {
      const posts = await listPosts();
      return posts.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        deptId: p.deptId,
        dept: p.deptName ?? null,
        postTypeId: p.postTypeId,
        post_type: p.postTypeName ?? null,
        sort: p.sort,
        status: p.status,
      }));
    },
    createApi: async (values) => {
      await createPost({
        deptId: Number(values.deptId),
        postTypeId: Number(values.postTypeId),
        code: String(values.code ?? ''),
        name: String(values.name ?? ''),
        status: values.status === '' || values.status == null ? 1 : Number(values.status),
      });
    },
    updateApi: async (id, values) => {
      await updatePost(id, {
        deptId: Number(values.deptId),
        postTypeId: Number(values.postTypeId),
        code: String(values.code ?? ''),
        name: String(values.name ?? ''),
        status: values.status === '' || values.status == null ? undefined : Number(values.status),
      });
    },
    deleteApi: async (id) => {
      await deletePost(id);
    },
    decorate: withStatus,
  },
  '/system/app': {
    id: 'app',
    group: '应用与接口',
    title: '应用管理',
    description: '门户子系统 / 微前端应用边界（sys_app）。',
    view: 'cards',
    filters: [
      { key: 'name', label: '应用名称', type: 'text', col: 4 },
      {
        key: 'kind',
        label: '种类',
        type: 'select',
        col: 3,
        options: [
          { value: 'subsystem', label: '子系统' },
          { value: 'tool', label: '工具' },
        ],
      },
      { key: 'status', label: '状态', type: 'select', col: 2, options: STATUS_OPTS },
    ],
    columns: [
      { key: 'code', label: '编码' },
      { key: 'name', label: '名称' },
      { key: 'base_path', label: '路由前缀' },
      { key: 'kind', label: '种类' },
      { key: 'runtime', label: '运行方式' },
      { key: 'statusText', label: '状态', status: true },
    ],
    form: [
      { key: 'code', label: '应用编码', type: 'text', col: 6, required: true },
      { key: 'name', label: '应用名称', type: 'text', col: 6, required: true },
      { key: 'icon', label: '图标(lucide)', type: 'text', col: 4 },
      { key: 'base_path', label: '路由前缀', type: 'text', col: 4, placeholder: '/system' },
      { key: 'portal_group', label: '门户分组', type: 'text', col: 4 },
      {
        key: 'kind',
        label: '种类',
        type: 'select',
        col: 4,
        options: [
          { value: 'subsystem', label: '子系统' },
          { value: 'tool', label: '工具' },
        ],
      },
      {
        key: 'runtime',
        label: '运行方式',
        type: 'select',
        col: 4,
        options: [
          { value: 'host', label: '同仓壳内' },
          { value: 'remote', label: 'Module Federation' },
        ],
      },
      { key: 'sort', label: '排序', type: 'number', col: 4 },
      { key: 'status', label: '状态', type: 'switch', col: 6 },
    ],
    /** 正常走 loader 拉 IAM sys_app（含 kb / agent）；接口失败回退空数组 + toast，不留兜底样例 */
    loader: async () => {
      const apps = await fetchApps();
      return apps.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        icon: a.icon,
        base_path: a.basePath,
        kind: a.kind,
        runtime: a.runtime,
        portal_group: a.portalGroup,
        description: a.description,
        sort: a.sort,
        status: a.status,
        enterable: a.enterable,
      }));
    },
    decorate: withStatus,
  },
  '/system/config': {
    id: 'config',
    group: '基础数据',
    title: '系统参数',
    description: '系统参数键值对（sys_config，全局）。',
    filters: [
      { key: 'config_key', label: '参数键', type: 'text', col: 6 },
      { key: 'remark', label: '备注', type: 'text', col: 4 },
    ],
    columns: [
      { key: 'config_key', label: '参数键' },
      { key: 'config_value', label: '参数值' },
      { key: 'remark', label: '备注' },
    ],
    form: [
      {
        key: 'config_key',
        label: '参数键',
        type: 'text',
        col: 12,
        required: true,
        placeholder: 'security.password.min_length',
      },
      { key: 'config_value', label: '参数值', type: 'textarea', col: 12, required: true },
      { key: 'remark', label: '备注', type: 'text', col: 12 },
    ],
    loader: async () => {
      const configs = await listConfigs();
      return configs.map((c) => ({
        id: c.id,
        config_key: c.configKey,
        config_value: c.configValue,
        remark: c.remark,
      }));
    },
    createApi: async (values) => {
      await createConfig({
        configKey: String(values.config_key ?? ''),
        configValue: String(values.config_value ?? ''),
        remark: values.remark ? String(values.remark) : undefined,
      });
    },
    updateApi: async (id, values) => {
      await updateConfig(id, {
        configValue: String(values.config_value ?? ''),
        remark: values.remark ? String(values.remark) : undefined,
      });
    },
    deleteApi: async (id) => {
      await deleteConfig(id);
    },
  },
};
