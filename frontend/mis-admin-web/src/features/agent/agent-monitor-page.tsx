/**
 * 系统监控页（T01 占位空态）。
 *
 * <p>真实内容（Proxy 状态、Agent 运行数、LLM provider 熔断重置）在 T05 填充。
 * `resetFailover` 对应 `agent:monitor:operate`（V20）。
 * 路径与 V19 菜单 `92041` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** 系统监控（T01 占位）。 */
export function AgentMonitorPage() {
  return <AgentPageShell title="系统监控" description="代理、Agent 与模型提供方运行态。" />;
}
