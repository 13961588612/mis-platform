import api from '@/lib/api/client';
import type { ApiResult, DeptNode, DeptPierceNode } from '@/types/api';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

export async function fetchDeptTree(orgId: string | number): Promise<DeptNode[]> {
  const res = await api.get<ApiResult<DeptNode[]>>('/depts/tree', { params: { orgId } });
  return unwrap(res, '获取部门树失败');
}

/** V40 组织穿透：只读 forest（懒加载，每层一次请求）。 */
export async function fetchDeptPierce(orgId: string | number): Promise<DeptPierceNode[]> {
  const res = await api.get<ApiResult<DeptPierceNode[]>>('/depts/pierce', { params: { orgId } });
  return unwrap(res, '获取组织穿透数据失败');
}

export async function createDept(body: {
  orgId: number;
  parentId: number;
  name: string;
  categoryId: number;
  linkedOrgId?: number | null;
  sort?: number;
  leaderEmployeeId?: number;
  /** V54 部门类型 id（应用层必填） */
  deptTypeId?: number;
  /** V54 部门编制数 / headcount 配额（默认 0） */
  establishmentCount?: number;
}): Promise<DeptNode> {
  const res = await api.post<ApiResult<DeptNode>>('/depts', body);
  return unwrap(res, '创建部门失败');
}

export async function updateDept(
  id: string,
  body: {
    name: string;
    categoryId?: number;
    sort?: number;
    status?: number;
    leaderEmployeeId?: number;
    parentId?: number;
    linkedOrgId?: number | null;
    /** V54 部门类型 id（NULL=不修改） */
    deptTypeId?: number;
    /** V54 部门编制数 / headcount 配额（NULL=不修改） */
    establishmentCount?: number;
  },
): Promise<DeptNode> {
  const res = await api.put<ApiResult<DeptNode>>(`/depts/${id}`, body);
  return unwrap(res, '更新部门失败');
}

export async function deleteDept(id: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/depts/${id}`);
  if (res.data.code !== 0) throw new Error(res.data.message || '删除部门失败');
}

/** 编制统计中的轻量员工视图（对齐后端 EmployeeLiteVO：id + name）。 */
export interface EmployeeLiteVO {
  id: string;
  name: string;
  isPrimary?: number | null;
}

/** 编制统计中的岗位明细（对齐后端 PostStaffingVO：postId/postName/postType/holders/vacant）。 */
export interface PostStaffingVO {
  postId: string;
  postName: string;
  /** 岗位类型名（后端字段名为 postType） */
  postType: string;
  holders: EmployeeLiteVO[];
  vacant: boolean;
}

/** 部门岗位编制统计（对齐后端 DeptStaffingVO）。 */
export interface DeptStaffingVO {
  deptId: string;
  deptName: string;
  postCount: number;
  filledCount: number;
  vacantCount: number;
  posts: PostStaffingVO[];
  employees: EmployeeLiteVO[];
}

/** 部门岗位编制：三指标 + 各岗位任职明细 + 部门任职人员（取代前端 mock，接真实后端）。 */
export async function fetchDeptStaffing(deptId: string | number): Promise<DeptStaffingVO> {
  const res = await api.get<ApiResult<DeptStaffingVO>>(`/depts/${deptId}/staffing`);
  return unwrap(res, '获取部门编制失败');
}
