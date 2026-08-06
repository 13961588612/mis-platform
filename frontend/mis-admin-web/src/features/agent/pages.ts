/**
 * 智能体运营控制台页面组件桶（re-export）。
 *
 * <p>供 `components/layout/keep-alive-outlet.tsx` 集中注册 `PAGE_MAP` / `DYNAMIC_PAGES`。
 * 同一 feature 内部再导出，不涉及跨 feature 依赖，不触发 `arch/no-cross-feature`。
 *
 * <p>新增页面：见 `lib/nav/agent-nav.ts` 头部「四处同改」清单（导航 / PAGE_MAP / router / SQL 种子）。
 */
export { AgentOverviewPage } from './agent-overview-page';
export { AgentChatPage } from './agent-chat-page';
export { AgentSessionsPage } from './agent-sessions-page';
export { AgentAgentsPage } from './agent-agents-page';
export { AgentCatalogPage } from './agent-catalog-page';
export { AgentDispatchPage } from './agent-dispatch-page';
export { AgentSkillsPage } from './agent-skills-page';
export { AgentSkillsPermissionsPage } from './agent-skills-permissions-page';
export { AgentMcpPage } from './agent-mcp-page';
export { AgentWecomPage } from './agent-wecom-page';
export { AgentMonitorPage } from './agent-monitor-page';
export { AgentApprovalsPage } from './agent-approvals-page';
export { AgentAgentDetailPage } from './agent-agent-detail-page';
