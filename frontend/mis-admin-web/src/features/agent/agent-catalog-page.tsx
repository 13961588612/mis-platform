/**
 * Worker Catalog 页（T01 占位空态）。
 *
 * <p>真实内容（全局 Worker 视图、when-to-use / safety 摘要）在 T02 填充。
 * 路径与 V19 菜单 `92035` 一一对应。
 */
import { AgentPageShell } from './components/agent-page-shell';

/** Worker Catalog（T01 占位）。 */
export function AgentCatalogPage() {
  return <AgentPageShell title="Worker Catalog" description="全局可调度的执行者清单。" />;
}
