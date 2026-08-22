/**
 * monitor.ts — 系统监控看板服务（T10，从 旧版独立前端 MonitorPage 迁移）。
 *
 * <p>后端端点（ai-platform admin.py）：
 * - GET /api/v1/admin/health          — 系统健康
 * - GET /api/v1/admin/route-stats     — 路由统计
 * - GET /api/v1/admin/llm/status      — LLM 网关状态
 * - GET /api/v1/admin/llm/token-usage — Token 用量摘要
 * - GET /api/v1/admin/proxy/status    — 出口代理状态
 * - GET /api/v1/admin/configs         — Agent 配置概览
 *
 * <p>所有接口只读；失败由页面 Promise.allSettled 逐项降级，不阻塞看板其余卡片。
 */

import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

// ============================================================================
// 类型（snake_case → camelCase）
// ============================================================================

/** 系统健康检查结果。 */
export interface HealthData {
  status: string;
  checks: Record<string, string>;
}

/** 路由统计。 */
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
// 数据映射（后端 snake_case，字段可能缺失 → 前端 camelCase 兜底）
// ============================================================================

function camelize<T = unknown>(obj: unknown): T {
  if (obj === null || obj === undefined) return obj as T;
  if (Array.isArray(obj)) {
    return obj.map((item) => camelize(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      out[camelKey] = camelize(value);
    }
    return out as T;
  }
  return obj as T;
}

// ============================================================================
// API（全部只读；调用方用 Promise.allSettled 容错）
// ============================================================================

async function getData<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await api.get<ApiResult<unknown>>(path);
    if (res.data.code !== 0) return fallback;
    return camelize<T>(res.data.data ?? fallback);
  } catch {
    return fallback;
  }
}

/** 系统健康。 */
export function fetchHealth(): Promise<HealthData | null> {
  return getData<HealthData | null>('/admin/health', null);
}

/** 路由统计。 */
export function fetchRouteStats(): Promise<RouteStats | null> {
  return getData<RouteStats | null>('/admin/route-stats', null);
}

/** LLM 网关状态。 */
export function fetchLlmStatus(): Promise<LlmStatus | null> {
  return getData<LlmStatus | null>('/admin/llm/status', null);
}

/** Token 用量摘要。 */
export function fetchTokenUsage(): Promise<TokenUsageSummary | null> {
  return getData<TokenUsageSummary | null>('/admin/llm/token-usage', null);
}

/** 出口代理状态。 */
export function fetchProxyStatus(): Promise<ProxyStatus | null> {
  return getData<ProxyStatus | null>('/admin/proxy/status', null);
}

/** Agent 配置概览。 */
export function fetchConfigs(): Promise<ConfigSummary[]> {
  return getData<ConfigSummary[]>('/admin/configs', []);
}
