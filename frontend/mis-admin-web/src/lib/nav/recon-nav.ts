/** recon 对账平台（micro-app 远程子应用）在壳子侧栏的导航清单 */

export interface ReconNavLeaf {
  path: string;
  title: string;
  icon: string;
}

export interface ReconNavBranch {
  title: string;
  icon: string;
  children: ReconNavLeaf[];
}

export type ReconNavNode = ({ kind: 'leaf' } & ReconNavLeaf) | ({ kind: 'branch' } & ReconNavBranch);

/**
 * 路径统一挂在 /remote/recon 之下（对应子应用 baseroute）。
 * 壳子路由切换只影响这一个 Tab（见 normalizeRemotePath），子应用内部由 micro-app 路由同步。
 */
export const RECON_NAV: ReconNavNode[] = [
  { kind: 'leaf', path: '/remote/recon/connections', title: '连接管理', icon: 'Cable' },
  { kind: 'leaf', path: '/remote/recon/datasources', title: '数据源管理', icon: 'Database' },
  { kind: 'leaf', path: '/remote/recon/scenarios', title: '场景与检查', icon: 'ListChecks' },
  { kind: 'leaf', path: '/remote/recon/diffs', title: '差异查询', icon: 'GitCompareArrows' },
  { kind: 'leaf', path: '/remote/recon/reports', title: '报告中心', icon: 'FileBarChart2' },
  { kind: 'leaf', path: '/remote/recon/monitor', title: '运行监控', icon: 'Activity' },
];

export function flattenReconNavLeaves(): ReconNavLeaf[] {
  const out: ReconNavLeaf[] = [];
  for (const n of RECON_NAV) {
    if (n.kind === 'leaf') out.push(n);
    else out.push(...n.children);
  }
  return out;
}
