import { describe, expect, it } from 'vitest';
import type { EmployeeItem, EmployeePostItem } from '@/types/api';
import {
  EMPLOYEE_STATUS_ENABLED,
  employeeStatusText,
  genderText,
  hasAnyFilterCondition,
  isEmployeeSelectable,
  primaryDeptLabel,
} from './employee-picker-utils';

function emp(overrides: Partial<EmployeeItem> = {}): EmployeeItem {
  return {
    id: '1',
    tenantId: '1',
    deptId: '10',
    deptIds: ['10'],
    primaryDeptId: '10',
    posts: [],
    employeeNo: 'E001',
    realName: '张三',
    email: null,
    phone: '13800000000',
    gender: 1,
    title: null,
    hireDate: null,
    status: 1,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function post(overrides: Partial<EmployeePostItem> = {}): EmployeePostItem {
  return {
    postId: '1',
    postName: '工程师',
    deptId: '10',
    deptName: '研发部',
    orgName: '研发中心',
    isPrimary: 1,
    status: 1,
    startDate: null,
    ...overrides,
  };
}

describe('employee-picker-utils', () => {
  it('genderText：1 男 / 2 女 / 其余 —', () => {
    expect(genderText(1)).toBe('男');
    expect(genderText(2)).toBe('女');
    expect(genderText(null)).toBe('—');
    expect(genderText(undefined)).toBe('—');
  });

  it('employeeStatusText：启用 / 禁用 / 锁定', () => {
    expect(employeeStatusText(1)).toBe('启用');
    expect(employeeStatusText(0)).toBe('禁用');
    expect(employeeStatusText(2)).toBe('锁定');
  });

  it('primaryDeptLabel：主职优先，组织-部门；脏数据仅部门名', () => {
    expect(primaryDeptLabel(emp())).toBe('—');
    expect(
      primaryDeptLabel(
        emp({
          posts: [
            post({ isPrimary: 0, deptName: '行政部', orgName: '运营中心' }),
            post({ isPrimary: 1, deptName: '研发部', orgName: '研发中心' }),
          ],
        }),
      ),
    ).toBe('研发中心-研发部');
    expect(primaryDeptLabel(emp({ posts: [post({ orgName: null })] }))).toBe('研发部');
  });

  it('isEmployeeSelectable：仅启用可选', () => {
    expect(isEmployeeSelectable(emp({ status: 1 }))).toBe(true);
    expect(isEmployeeSelectable(emp({ status: 0 }))).toBe(false);
    expect(isEmployeeSelectable(emp({ status: 2 }))).toBe(false);
  });

  it('hasAnyFilterCondition：默认状态启用不算条件，姓名/手机/组织/部门/改状态任一即算', () => {
    const base = {
      realName: '',
      phone: '',
      orgIds: [] as (string | number)[],
      deptIds: [] as (string | number)[],
      status: EMPLOYEE_STATUS_ENABLED as number | '',
    };
    expect(hasAnyFilterCondition(base)).toBe(false);
    expect(hasAnyFilterCondition({ ...base, realName: '张' })).toBe(true);
    expect(hasAnyFilterCondition({ ...base, phone: '138' })).toBe(true);
    expect(hasAnyFilterCondition({ ...base, orgIds: ['1'] })).toBe(true);
    expect(hasAnyFilterCondition({ ...base, deptIds: ['2'] })).toBe(true);
    expect(hasAnyFilterCondition({ ...base, status: 0 })).toBe(true);
    expect(hasAnyFilterCondition({ ...base, realName: '   ' })).toBe(false);
  });
});
