/**
 * 知识库子系统（app.code = 'kb'）侧栏静态权威清单。
 *
 * <p>与 `V13__kb_seed.sql` / `V17__kb_hittest_perms.sql` 的 sys_menu 路径/标题/图标/排序
 * 严格一一对应：后端 `/menus/router` 为增量增强来源，静态清单保证迁移未执行或权限未授予时
 * 侧栏结构不出现空洞（与 SYSTEM_NAV 的处理口径一致，见 menus-to-nav.mergeNavWithFallback 注释）。
 *
 * <p>**新增页面必须三处同改**：本文件（导航）、`keep-alive-outlet.tsx` 的 PAGE_MAP（页面映射）、
 * 迁移 SQL 的 sys_menu seed（菜单与权限码）。少改任何一处都会得到「点得进去但没标题」
 * 或「有菜单但页面空白」这类半残状态。
 */
import type { SystemNavLeaf, SystemNavNode } from '@/lib/nav/system-nav';

export const KB_NAV: SystemNavNode[] = [
  { kind: 'leaf', path: '/kb/overview', title: '概览', icon: 'LayoutDashboard' },
  { kind: 'leaf', path: '/kb/categories', title: '分类管理', icon: 'FolderTree' },
  { kind: 'leaf', path: '/kb/libraries', title: '知识库', icon: 'Database' },
  { kind: 'leaf', path: '/kb/documents', title: '文档', icon: 'FileText' },
  { kind: 'leaf', path: '/kb/permissions', title: '搜索权限', icon: 'Lock' },
  { kind: 'leaf', path: '/kb/qa', title: '智能问答', icon: 'Sparkles' },
  // WA-08：命中测试置于「智能问答」与「问答运营」之间（权限码 kb:hittest:run，V17 seed）
  { kind: 'leaf', path: '/kb/hit-test', title: '命中测试', icon: 'Crosshair' },
  { kind: 'leaf', path: '/kb/operations', title: '问答运营', icon: 'BarChart3' },
  // WD-02：同义词管理置于「问答运营」与「引擎配置」之间（权限码 kb:config:synonym:view，V18 seed 菜单 91052）
  // 位置须与 V18 的 sys_menu.sort_no 逐字对齐，否则侧栏顺序与菜单表不一致。
  { kind: 'leaf', path: '/kb/synonyms', title: '同义词', icon: 'Languages' },
  { kind: 'leaf', path: '/kb/engine', title: '引擎配置', icon: 'Cpu' },
];

/** 展平为叶节点列表（KB_NAV 当前全为叶节点，保留分支分支以兼容后续扩展）。 */
export function flattenKbNavLeaves(): SystemNavLeaf[] {
  const out: SystemNavLeaf[] = [];
  for (const n of KB_NAV) {
    if (n.kind === 'leaf') out.push(n);
    else out.push(...n.children);
  }
  return out;
}
