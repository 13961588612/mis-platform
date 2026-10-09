/** 工作台（个人事务中心）侧栏 —— app.code = 'task'。
 *
 * <p>与 SYSTEM_NAV 分离：工作台是每个登录用户的个人事务，与业务子系统正交。
 * 见 docs/design/portal-workbench-layout.md §11。
 */
import type { SystemNavNode, SystemNavLeaf } from './system-nav';

export const TASK_NAV: SystemNavNode[] = [
  {
    kind: 'branch',
    title: '工作台',
    icon: 'ClipboardList',
    children: [
      { path: '/task/pending', title: '我的待办', icon: 'ClipboardList' },
      { path: '/task/inbox', title: '消息与待办', icon: 'MessagesSquare' },
      { path: '/task/my-sent', title: '我发起的', icon: 'History' },
      { path: '/task/my-processed', title: '我审批的', icon: 'ClipboardCheck' },
    ],
  },
];

export function flattenTaskNavLeaves(): SystemNavLeaf[] {
  const out: SystemNavLeaf[] = [];
  for (const n of TASK_NAV) {
    if (n.kind === 'leaf') out.push(n);
    else out.push(...n.children);
  }
  return out;
}
