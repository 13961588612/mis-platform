/**
 * 财务辅助（app.code = 'finance'）侧栏静态权威清单。
 *
 * <p>与 `V86__finance_pos_account_seed.sql` 对齐。侧栏组件仅支持一层 branch→leaf，
 * 故「银行账目 / POS对账」合并为 branch「POS对账」（产品树三级在 sys_menu 中完整保留）。
 * 新增页面须同步：本文件、PAGE_MAP、Flyway。
 */
import type { SystemNavLeaf, SystemNavNode } from '@/lib/nav/system-nav';

export const FINANCE_NAV: SystemNavNode[] = [
  {
    kind: 'branch',
    title: 'POS对账',
    icon: 'Scale',
    children: [
      {
        path: '/finance/bank-account/pos-account/terminals',
        title: '终端管理',
        icon: 'Monitor',
      },
      {
        path: '/finance/bank-account/pos-account/skt',
        title: '收款台管理',
        icon: 'Store',
      },
      {
        path: '/finance/bank-account/pos-account/reconcile',
        title: '对账处理',
        icon: 'Scale',
      },
      {
        path: '/finance/bank-account/pos-account/marks',
        title: '标记与记录',
        icon: 'Tags',
      },
    ],
  },
];

export function flattenFinanceNavLeaves(): SystemNavLeaf[] {
  const out: SystemNavLeaf[] = [];
  for (const n of FINANCE_NAV) {
    if (n.kind === 'leaf') out.push(n);
    else out.push(...n.children);
  }
  return out;
}
