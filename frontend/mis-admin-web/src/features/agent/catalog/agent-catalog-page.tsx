/**
 * 原 Worker Catalog 页已并入 Agent 总览（方案 2）。
 * 保留本路径仅作书签兼容：重定向到 `/agent/agents`。
 */
import { Navigate } from 'react-router-dom';

export function AgentCatalogPage() {
  return <Navigate to="/agent/agents" replace />;
}

export default AgentCatalogPage;
