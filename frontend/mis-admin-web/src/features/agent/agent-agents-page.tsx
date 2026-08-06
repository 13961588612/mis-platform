/**
 * Agent 总览页（T01 占位空态）。
 *
 * <p>真实内容（Agent 列表、启停、健康）在 T02 填充。点列表行进入
 * `/agent/agents/:id/skills|config|coordination` 三个详情子路由（见 agent-agent-detail-page.tsx）。
 * 路径与 V19 菜单 `92034` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** Agent 总览（T01 占位）。 */
export function AgentAgentsPage() {
  return <AgentPageShell title="Agent 总览" description="协调者与执行者实例的统一视图。" />;
}
