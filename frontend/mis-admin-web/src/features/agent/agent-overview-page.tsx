/**
 * 概览页（T01 占位空态）。
 *
 * <p>真实内容（运行指标、Agent 健康聚合、待办审批数）在 T05 填充。
 * 路径与 V19 菜单 `92031` / agent-nav.ts 叶节点一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** 概览（T01 占位）。 */
export function AgentOverviewPage() {
  return <AgentPageShell title="概览" description="智能体运营控制台总览。" />;
}
