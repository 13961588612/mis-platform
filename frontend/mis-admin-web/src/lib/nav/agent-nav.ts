/**
 * 智能体运营控制台（app.code = 'agent'）侧栏静态权威清单。
 *
 * <p>与 `V19__agent_ops_seed.sql` 的 sys_menu 路径/标题/图标/排序 **逐条一一对应**：
 * 后端 `/menus/router` 为增量增强来源（见 menus-to-nav.mergeNavWithFallback），
 * 静态清单保证迁移未执行或权限未授予时侧栏结构不出现空洞——与 SYSTEM_NAV / KB_NAV 同口径。
 *
 * <p>**新增页面必须四处同改**（impl-plan §10.1 约定 2）：
 *   ① 本文件（侧栏导航）
 *   ② `components/layout/keep-alive-outlet.tsx` 的 `PAGE_MAP`（精确路径 → 组件）
 *      或 `DYNAMIC_PAGES`（`/agent/agents/:id/**` 这类带 ID 的明细路由）
 *   ③ `app/router.tsx`（`/agent/*` 已整体登记，新增子路径通常无需改）
 *   ④ `V19__agent_ops_seed.sql` 的 sys_menu 种子（菜单文案 + permission 码）
 * 少改任何一处的表现是「菜单点了没反应」或「页面存在但侧栏不显示」。
 *
 * <p>本清单只含 **visible=1 的 12 个侧栏页面**。以下三条详情子路由
 * 在 V19 中是 `type=2 + visible=0`（不进侧栏、permission 仍生效），
 * 故**刻意不出现在这里**，由 `DYNAMIC_PAGES` 提供 Tab 标题：
 *   `/agent/agents/:id/skills`、`/agent/agents/:id/config`、`/agent/agents/:id/coordination`
 *
 * <p>icon 取值必须同步登记到 `lib/nav/icons.ts` 的 `ICON_MAP`，
 * 否则 `resolveNavIcon` 会**静默**回退成 LayoutDashboard（图标全变一个样，不报错，很难查）。
 */
import type { SystemNavLeaf, SystemNavNode } from '@/lib/nav/system-nav';

export const AGENT_NAV: SystemNavNode[] = [
  // ui.md §2.1 对话与会话（V19: 92031–92033）
  { kind: 'leaf', path: '/agent/overview', title: '概览', icon: 'LayoutDashboard' },
  { kind: 'leaf', path: '/agent/chat', title: '本地对话', icon: 'MessageSquare' },
  { kind: 'leaf', path: '/agent/sessions', title: '会话管理', icon: 'History' },
  // ui.md §2.2 智能体与调度（V19: 92034–92036）
  { kind: 'leaf', path: '/agent/agents', title: 'Agent 总览', icon: 'Bot' },
  { kind: 'leaf', path: '/agent/catalog', title: 'Worker Catalog', icon: 'Boxes' },
  { kind: 'leaf', path: '/agent/dispatch', title: '调度观测', icon: 'Route' },
  // ui.md §2.3 技能与工具（V19: 92037–92039）
  { kind: 'leaf', path: '/agent/skills', title: '技能池', icon: 'Sparkles' },
  { kind: 'leaf', path: '/agent/skills/permissions', title: '技能权限', icon: 'Lock' },
  { kind: 'leaf', path: '/agent/mcp', title: 'MCP 管理', icon: 'Plug' },
  // ui.md §2.4 渠道与运维（V19: 92040–92042）
  { kind: 'leaf', path: '/agent/channels/wecom', title: '企微机器人', icon: 'MessagesSquare' },
  { kind: 'leaf', path: '/agent/monitor', title: '系统监控', icon: 'Activity' },
  { kind: 'leaf', path: '/agent/approvals', title: '审批中心', icon: 'ClipboardCheck' },
];

/** 展平为叶节点列表（AGENT_NAV 当前全为叶节点，保留分支处理以兼容后续扩展）。 */
export function flattenAgentNavLeaves(): SystemNavLeaf[] {
  const out: SystemNavLeaf[] = [];
  for (const n of AGENT_NAV) {
    if (n.kind === 'leaf') out.push(n);
    else out.push(...n.children);
  }
  return out;
}
