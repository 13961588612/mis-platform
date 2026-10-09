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
      { path: '/system/module', title: '模块管理', icon: 'GitBranch' },
      { path: '/system/menu', title: '菜单管理', icon: 'ListTree' },
    ],
  },
  {
    kind: 'branch',
    title: '权限中心',
    icon: 'KeyRound',
    children: [
      { path: '/system/user', title: '用户管理', icon: 'Users' },
      { path: '/system/role', title: '角色权限', icon: 'KeyRound' },
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
    title: '流程中心',
    icon: 'Workflow',
    children: [
      { path: '/system/workflow/definitions', title: '流程定义', icon: 'GitBranch' },
      // ⚠️ 编排已 Dialog 化（在流程定义页里打开），本项只作「跳到流程中心」的入口：
      // designer-page 进来后立刻 `replace` 回 /system/workflow/definitions，不留历史。
      // 菜单 95007 及它上面绑的 sys_menu_api（取消发布 / PUT 更新定义）**不能删**，
      // 删了那两个端点就全部 403。
      { path: '/system/workflow/designer', title: '流程编排', icon: 'Workflow' },
    ],
  },
  {
    kind: 'branch',
    title: '审计',
    icon: 'Activity',
    children: [
      { path: '/monitor/login-log', title: '登录日志', icon: 'Activity' },
      { path: '/monitor/oper-log', title: '操作日志', icon: 'ClipboardList' },
      { path: '/system/audit-op', title: '业务审计', icon: 'ClipboardCheck' },
      { path: '/system/exec-monitor', title: '执行监控', icon: 'Activity' },
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

/** 任意侧栏树展平为叶子（与 {@link flattenSystemNavLeaves} 同形，可吃 AGENT_NAV / KB_NAV）。 */
export function flattenNavLeaves(nodes: readonly SystemNavNode[]): SystemNavLeaf[] {
  const out: SystemNavLeaf[] = [];
  for (const n of nodes) {
    if (n.kind === 'leaf') out.push(n);
    else out.push(...n.children);
  }
  return out;
}

/** 精确匹配，或 pathname 落在 navPath 的子路径下。 */
export function pathMatches(pathname: string, navPath: string): boolean {
  return pathname === navPath || pathname.startsWith(`${navPath}/`);
}

/**
 * 侧栏叶子是否应高亮：前缀匹配 + **最长命中优先**。
 *
 * <p>否则 `/agent/skills` 与 `/agent/skills/permissions` 会在权限页同时高亮——
 * 短路径是长路径的前缀，单纯 `startsWith` 无法区分「列表页」与「同前缀的兄弟页」。
 */
export function isNavPathActive(
  pathname: string,
  candidatePath: string,
  competingPaths: readonly string[],
): boolean {
  if (!pathMatches(pathname, candidatePath)) return false;
  for (const other of competingPaths) {
    if (other === candidatePath || other.length <= candidatePath.length) continue;
    if (pathMatches(pathname, other)) return false;
  }
  return true;
}

/** 在一组叶子中选出与 pathname 匹配且路径最长的一项。 */
export function pickBestNavLeaf<T extends { path: string }>(
  pathname: string,
  leaves: readonly T[],
): T | undefined {
  let best: T | undefined;
  for (const leaf of leaves) {
    if (!pathMatches(pathname, leaf.path)) continue;
    if (!best || leaf.path.length > best.path.length) best = leaf;
  }
  return best;
}

export function findSystemNavItem(pathname: string): SystemNavLeaf | undefined {
  return pickBestNavLeaf(pathname, flattenSystemNavLeaves());
}

export function branchContainsPath(branch: SystemNavBranch, pathname: string): boolean {
  return branch.children.some((c) => pathMatches(pathname, c.path));
}
