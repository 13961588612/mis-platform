/**
 * 会话管理页（T01 占位空态）。
 *
 * <p>真实内容（全量会话检索、消息回放、批量删除）在 T04 填充。
 * 路径与 V19 菜单 `92033` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** 会话管理（T01 占位）。 */
export function AgentSessionsPage() {
  return <AgentPageShell title="会话管理" description="跨渠道会话的检索与回放。" />;
}
