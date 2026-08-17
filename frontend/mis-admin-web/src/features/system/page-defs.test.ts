import { describe, it, expect, vi } from 'vitest';
import type { PostItem } from '@/types/api';

// node 环境下无 DOM，page-defs 引入的各类 api 模块仅作导入、不会被调用；
// 全部以 vi.mock 替身，避免真实 client（含浏览器依赖）被加载。
vi.mock('@/lib/api/posts', () => ({
  listPosts: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  listPostTypes: vi.fn(),
}));
vi.mock('@/lib/api/depts', () => ({ fetchDeptTree: vi.fn() }));
vi.mock('@/lib/api/orgs', () => ({ listOrgs: vi.fn() }));
vi.mock('@/lib/api/platform', () => ({ fetchApps: vi.fn() }));
vi.mock('@/lib/api/employees', () => ({
  listEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
}));
vi.mock('@/lib/api/configs', () => ({
  listConfigs: vi.fn(),
  createConfig: vi.fn(),
  updateConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

import { SYSTEM_PAGE_DEFS } from './page-defs';
import { listPosts } from '@/lib/api/posts';

describe('SYSTEM_PAGE_DEFS /system/post（R5/R7 改造）', () => {
  it('columns 顺序：org 置首列、dept 第二列 → org,dept,code,name,post_type,quota,statusText', () => {
    const keys = SYSTEM_PAGE_DEFS['/system/post'].columns.map((c) => c.key);
    expect(keys).toEqual(['org', 'dept', 'code', 'name', 'post_type', 'quota', 'statusText']);
  });

  it('loader 映射携带 org / orgId（脏数据 orgName=null 透传 null，UI 显示「—」）', async () => {
    vi.mocked(listPosts).mockResolvedValue([
      {
        id: '1',
        tenantId: '1',
        deptId: '101',
        deptName: '部门甲',
        orgId: '10',
        orgName: '组织甲',
        postTypeId: '7',
        postTypeName: '类型甲',
        code: 'P1',
        name: '岗位一',
        sort: 0,
        status: 1,
        quota: 5,
      } as PostItem,
      // 脏数据行：部门未挂载组织 → 后端 orgId/orgName 缺省，loader 须归一为 null（UI 显示「—」）
      {
        id: '2',
        tenantId: '1',
        deptId: '102',
        deptName: '部门乙',
        orgName: null,
        postTypeId: '7',
        postTypeName: '类型甲',
        code: 'P2',
        name: '岗位二',
        sort: 1,
        status: 1,
        quota: 3,
      } as PostItem,
    ]);
    const loader = SYSTEM_PAGE_DEFS['/system/post'].loader;
    expect(loader).toBeTypeOf('function');
    const rows = await loader!({});
    expect(rows[0].org as string | null).toBe('组织甲');
    expect(rows[0].orgId as string | null).toBe('10');
    // ?? null 归一：undefined orgId / null orgName 均不得漏成 undefined
    expect(rows[1].orgId as string | null).toBeNull();
    expect(rows[1].org as string | null).toBeNull();
  });
});
