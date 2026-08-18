import type { EmployeeItem } from '@/types/api';

/** 启用状态：选择员工时仅允许绑定此类记录。 */
export const EMPLOYEE_STATUS_ENABLED = 1;

/** 弹窗筛选条件（对齐员工管理：姓名/手机/组织/部门/状态）。 */
export interface EmployeePickerFilters {
  realName: string;
  phone: string;
  orgIds: (string | number)[];
  deptIds: (string | number)[];
  status: number | '';
}

/**
 * 是否已输入至少一个主动查询条件。
 *
 * <p>默认状态「启用」不算主动条件（打开即默认选中，未形成用户意图）；
 * 姓名/手机/组织/部门任一非空，或状态被改为非启用，才允许查询。</p>
 */
export function hasAnyFilterCondition(f: EmployeePickerFilters): boolean {
  return (
    f.realName.trim() !== '' ||
    f.phone.trim() !== '' ||
    f.orgIds.length > 0 ||
    f.deptIds.length > 0 ||
    f.status !== EMPLOYEE_STATUS_ENABLED
  );
}

export function genderText(gender: number | null | undefined): string {
  if (gender === 1) return '男';
  if (gender === 2) return '女';
  return '—';
}

export function employeeStatusText(status: number): string {
  if (status === 1) return '启用';
  if (status === 2) return '锁定';
  return '禁用';
}

export function employeeStatusTone(status: number): 'success' | 'warning' | 'destructive' {
  if (status === 1) return 'success';
  if (status === 2) return 'warning';
  return 'destructive';
}

/**
 * 主部门展示：优先主职，否则首条任职；有组织名时显示「组织-部门」，与员工管理列表一致。
 */
export function primaryDeptLabel(emp: EmployeeItem): string {
  const posts = emp.posts ?? [];
  const primary = posts.find((p) => p.isPrimary === 1) ?? posts[0];
  if (!primary) return '—';
  return primary.orgName ? `${primary.orgName}-${primary.deptName}` : (primary.deptName ?? '—');
}

export function isEmployeeSelectable(emp: EmployeeItem): boolean {
  return emp.status === EMPLOYEE_STATUS_ENABLED;
}
