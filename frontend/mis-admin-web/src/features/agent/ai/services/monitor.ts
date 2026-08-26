/**
 * monitor.ts — 系统监控看板服务（T10）。
 *
 * <p>经 BFF 已登记端点（deny-unmapped fail-closed；勿直打 `/api/v1/admin/*`）：
 * - GET /api/v1/agent-ops/monitor/overview   — 健康 / LLM / 代理聚合
 * - GET /api/v1/agent-ops/dispatch/route-stats — 路由统计
 * - GET /api/v1/agent-ops/agents             — Agent 列表（作配置概览）
 *
 * <p>Token 用量无独立登记端点，看板该项返回 null（页面展示「暂无数据」）。
 */

import {
  getMonitorOverview,
  listAgents,
  listRouteStats,
} from '../../api/agent-ops-api';
import type { MonitorOverview, MonitorProxyNode } from '../../types';

// ============================================================================
// 看板视图类型（camelCase，供 MonitorDashboardPage 消费）
// ============================================================================

/** 系统健康检查结果。 */
export interface HealthData {
  status: string;
  checks: Record<string, string>;
}

/** 路由统计（看板口径）。 */
export interface RouteStats {
  totalRequests: number;
  successfulRoutes: number;
  failedRoutes: number;
  byAgent?: Record<string, number>;
  byChannel?: Record<string, number>;
}

/** LLM 网关状态。 */
export interface LlmStatus {
  primaryProvider: string;
  fallbackProvider: string;
  currentProvider: string;
  failoverActive: boolean;
  totalRequests: number;
  errorCount: number;
}

/** Token 用量摘要。 */
export interface TokenUsageSummary {
  totalPrompt: number;
  totalCompletion: number;
  totalTokens: number;
  byUser?: Record<string, number>;
  byModel?: Record<string, number>;
}

/** 出口代理状态。 */
export interface ProxyStatus {
  enabled: boolean;
  totalNodes: number;
  healthyNodes: number;
  nodes?: Array<{ host: string; port: number; healthy: boolean }>;
}

/** Agent 配置概览。 */
export interface ConfigSummary {
  agentId: string;
  displayName: string;
  state: string;
  isActive: boolean;
}

// ============================================================================
// 映射
// ============================================================================

function mapHealth(overview: MonitorOverview): HealthData {
  const admin = overview.admin;
  const llmOk = Boolean(admin?.llm_gateway?.initialized);
  const proxyTotal = Number(admin?.proxy_nodes ?? 0);
  const proxyHealthy = Number(admin?.healthy_proxy_nodes ?? 0);
  const proxyOk = proxyTotal === 0 || proxyHealthy > 0;
  return {
    status: llmOk && proxyOk ? 'ok' : 'degraded',
    checks: {
      llm_gateway: llmOk ? 'ok' : 'error',
      proxy: proxyOk ? 'ok' : 'error',
    },
  };
}

function mapLlm(overview: MonitorOverview): LlmStatus {
  const failover = overview.llm?.failover;
  const providers = overview.llm?.providers ?? {};
  let totalRequests = 0;
  let errorCount = 0;
  for (const provider of Object.values(providers)) {
    for (const key of provider.key_stats ?? []) {
      totalRequests += Number(key.total_calls ?? 0);
      errorCount += Number(key.error_count ?? 0);
    }
  }
  return {
    primaryProvider: failover?.primary ?? '—',
    fallbackProvider: failover?.fallback ?? '—',
    currentProvider: failover?.active_provider ?? failover?.primary ?? '—',
    failoverActive: Boolean(failover?.is_failover_active),
    totalRequests,
    errorCount,
  };
}

function mapProxy(overview: MonitorOverview): ProxyStatus {
  const nodes: MonitorProxyNode[] = Array.isArray(overview.proxy)
    ? overview.proxy
    : Array.isArray(overview.llm?.proxy_pool)
      ? overview.llm.proxy_pool
      : [];
  const healthyNodes = nodes.filter((n) => n.is_healthy).length;
  return {
    enabled: nodes.length > 0,
    totalNodes: nodes.length || Number(overview.admin?.proxy_nodes ?? 0),
    healthyNodes: nodes.length
      ? healthyNodes
      : Number(overview.admin?.healthy_proxy_nodes ?? 0),
    nodes: nodes.map((n) => ({
      host: n.host,
      port: n.port,
      healthy: Boolean(n.is_healthy),
    })),
  };
}

// ============================================================================
// API
// ============================================================================

/** 一次 overview 拉齐健康 / LLM / 代理（避免三连请求）。 */
export async function fetchOverviewCards(): Promise<{
  health: HealthData | null;
  llmStatus: LlmStatus | null;
  proxyStatus: ProxyStatus | null;
}> {
  try {
    const overview = await getMonitorOverview();
    return {
      health: mapHealth(overview),
      llmStatus: mapLlm(overview),
      proxyStatus: mapProxy(overview),
    };
  } catch {
    return { health: null, llmStatus: null, proxyStatus: null };
  }
}

/** 系统健康（来自 monitor/overview.admin）。 */
export async function fetchHealth(): Promise<HealthData | null> {
  const cards = await fetchOverviewCards();
  return cards.health;
}

/** 路由统计。 */
export async function fetchRouteStats(): Promise<RouteStats | null> {
  try {
    const stats = await listRouteStats();
    const total = Number(stats.total_routes ?? 0);
    return {
      totalRequests: total,
      // wire 无成功/失败拆分；看板用总量近似成功、失败记 0
      successfulRoutes: total,
      failedRoutes: 0,
      byAgent: stats.by_agent ?? {},
    };
  } catch {
    return null;
  }
}

/** LLM 网关状态（来自 monitor/overview.llm）。 */
export async function fetchLlmStatus(): Promise<LlmStatus | null> {
  const cards = await fetchOverviewCards();
  return cards.llmStatus;
}

/**
 * Token 用量摘要。
 *
 * <p>BFF 未登记 `/admin/llm/token-usage`，返回 null（页面展示「暂无数据」）。
 */
export async function fetchTokenUsage(): Promise<TokenUsageSummary | null> {
  return null;
}

/** 出口代理状态（来自 monitor/overview.proxy）。 */
export async function fetchProxyStatus(): Promise<ProxyStatus | null> {
  const cards = await fetchOverviewCards();
  return cards.proxyStatus;
}

/** Agent 配置概览。 */
export async function fetchConfigs(): Promise<ConfigSummary[]> {
  try {
    const agents = await listAgents();
    return agents.map((a) => ({
      agentId: a.agent_id,
      displayName: a.display_name || a.agent_id,
      state: a.state || 'unknown',
      isActive: Boolean(a.is_active ?? a.state === 'running'),
    }));
  } catch {
    return [];
  }
}
