/**
 * MCP 管理页（T01 占位空态）。
 *
 * <p>真实内容（MCP Server 增删、连接、工具浏览、`call` 高危二次确认）在 T03 填充。
 * `callMcpTool` 对应高危码 `agent:mcp:call`（V20 独占，未与任何读接口共享）。
 * 路径与 V19 菜单 `92039` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** MCP 管理（T01 占位）。 */
export function AgentMcpPage() {
  return <AgentPageShell title="MCP 管理" description="外部工具服务的连接与调用。" />;
}
