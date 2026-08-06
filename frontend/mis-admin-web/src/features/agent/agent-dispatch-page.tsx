/**
 * 调度观测页（T01 占位空态）。
 *
 * <p>真实内容（调度链路、路由日志、命中统计）在 T02 填充。
 * 路径与 V19 菜单 `92036` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** 调度观测（T01 占位）。 */
export function AgentDispatchPage() {
  return <AgentPageShell title="调度观测" description="协调者到执行者的调度链路与路由分析。" />;
}
