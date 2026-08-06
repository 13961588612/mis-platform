/**
 * 审批中心页（T01 占位空态）。
 *
 * <p>真实内容（待审批列表、通过 / 驳回）在 T05 填充。
 * `decideApproval` 对应 `agent:approval:handle`（V20）。
 * 路径与 V19 菜单 `92042` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** 审批中心（T01 占位）。 */
export function AgentApprovalsPage() {
  return <AgentPageShell title="审批中心" description="需要人工确认的高风险操作。" />;
}
