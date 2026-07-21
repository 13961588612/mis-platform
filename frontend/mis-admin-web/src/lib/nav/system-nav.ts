/** 对齐 mis-portal-prototype.html · 系统管理子系统侧栏（多级可展开，非扁平分组） */

export interface SystemNavLeaf {
  path: string;
  title: string;
  icon: string;
}

export interface SystemNavBranch {
  title: string;
  icon: string;
  children: SystemNavLeaf[];
}

export type SystemNavNode =
  | ({ kind: 'leaf' } & SystemNavLeaf)
  | ({ kind: 'branch' } & SystemNavBranch);

/** 门户原型 subsystems[system].nav */
export const SYSTEM_NAV: SystemNavNode[] = [
  { kind: 'leaf', path: '/dashboard', title: '概览', icon: 'LayoutDashboard' },
  {
    kind: 'branch',
    title: '组织架构',
    icon: 'Network',
    children: [
      { path: '/system/org', title: '组织管理', icon: 'Network' },
      { path: '/system/dept', title: '部门管理', icon: 'FolderTree' },
      { path: '/system/employee', title: '员工管理', icon: 'Users' },
      { path: '/system/post', title: '岗位管理', icon: 'UserCog' },
    ],
  },
  {
    kind: 'branch',
    title: '应用与接口',
    icon: 'Cable',
    children: [
      { path: '/system/app', title: '应用管理', icon: 'AppWindow' },
      { path: '/system/api', title: '接口管理', icon: 'Cable' },
      { path: '/system/module', title: '模块管理', icon: 'GitBranch' },
    ],
  },
  {
    kind: 'branch',
    title: '权限中心',
    icon: 'KeyRound',
    children: [
      { path: '/system/user', title: '用户管理', icon: 'Users' },
      { path: '/system/role', title: '角色权限', icon: 'KeyRound' },
      { path: '/system/menu', title: '菜单管理', icon: 'ListTree' },
    ],
  },
  {
    kind: 'branch',
    title: '基础数据',
    icon: 'BookOpen',
    children: [
      { path: '/system/dict', title: '字典管理', icon: 'BookOpen' },
      { path: '/system/config', title: '系统参数', icon: 'Settings' },
    ],
  },
  {
    kind: 'branch',
    title: '审计',
    icon: 'Activity',
    children: [
      { path: '/monitor/login-log', title: '登录日志', icon: 'Activity' },
      { path: '/monitor/oper-log', title: '操作日志', icon: 'ClipboardList' },
    ],
  },
];

export function flattenSystemNavLeaves(): SystemNavLeaf[] {
  const out: SystemNavLeaf[] = [];
  for (const n of SYSTEM_NAV) {
    if (n.kind === 'leaf') out.push(n);
    else out.push(...n.children);
  }
  return out;
}

export function findSystemNavItem(pathname: string): SystemNavLeaf | undefined {
  return flattenSystemNavLeaves().find(
    (i) => pathname === i.path || pathname.startsWith(`${i.path}/`),
  );
}

export function branchContainsPath(branch: SystemNavBranch, pathname: string): boolean {
  return branch.children.some(
    (c) => pathname === c.path || pathname.startsWith(`${c.path}/`),
  );
}
