/**
 * 本地对话页（T01 占位空态）。
 *
 * <p>真实内容（与单个 Agent 的会话式调试界面）在 T03 填充。
 * 路径与 V19 菜单 `92032` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** 本地对话（T01 占位）。 */
export function AgentChatPage() {
  return <AgentPageShell title="本地对话" description="与指定 Agent 的会话式调试。" />;
}
