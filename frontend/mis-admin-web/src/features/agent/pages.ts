/**
 * 智能体运营控制台页面组件桶（re-export）。
 *
 * <p>供 `components/layout/keep-alive-outlet.tsx` 集中注册 `PAGE_MAP` / `DYNAMIC_PAGES`。
 * 同一 feature 内部再导出，不涉及跨 feature 依赖，不触发 `arch/no-cross-feature`。
 *
 * <p>**本文件是「文件布局」与「注册链路」之间唯一的隔离层**（T05 批 1 重组）：
 * 页面文件从平铺挪进了按域划分的子目录（`skills/`、`mcp/`、`agents/` …），
 * 部分文件顺带改名以消除同名碰撞（见下表）。`keep-alive-outlet.tsx` 依赖的 13 个
 * **导出符号名一个都没变** —— 差异全部在这里用 `as` 别名吸收，故注册链路零改动。
 *
 * | 导出符号（对外，勿改） | 实现文件 | 文件内导出名 |
 * |---|---|---|
 * | `AgentSessionsPage`  | `sessions/agent-session-page.tsx`        | `AgentSessionPage`（单数） |
 * | `AgentAgentsPage`    | `agents/agent-list-page.tsx`             | `AgentListPage` |
 * | `AgentSkillsPage`    | `skills/agent-skill-pool-page.tsx`       | `AgentSkillPoolPage` |
 * | 其余 10 个           | 同名文件挪进子目录                        | 与对外符号同名 |
 *
 * <p>`AgentSkillPoolPage` 这次刻意改名：技能域下同时存在「技能池」与
 * 「Agent↔技能绑定」（批 3 的 `agents/agent-skills-page.tsx`），两者若都叫
 * `AgentSkillsPage` 会在本桶文件里撞名。
 *
 * <p>新增页面：见 `lib/nav/agent-nav.ts` 头部「四处同改」清单（导航 / PAGE_MAP / router / SQL 种子）。
 */
export { AgentOverviewPage } from './overview/agent-overview-page';
export { AgentChatPage } from './chat/agent-chat-page';
export { AgentSessionPage as AgentSessionsPage } from './sessions/agent-session-page';
export { AgentListPage as AgentAgentsPage } from './agents/agent-list-page';
export { AgentCatalogPage } from './catalog/agent-catalog-page';
export { AgentDispatchPage } from './dispatch/agent-dispatch-page';
export { AgentSkillPoolPage as AgentSkillsPage } from './skills/agent-skill-pool-page';
export { AgentSkillsPermissionsPage } from './skills/agent-skill-permission-page';
export { AgentMcpPage } from './mcp/agent-mcp-page';
export { AgentWecomPage } from './channels/agent-wecom-page';
export { AgentMonitorPage } from './monitor/agent-monitor-page';
export { AgentApprovalsPage } from './approvals/agent-approval-page';
export { AgentAgentDetailPage } from './agents/agent-detail-route';
