/**
 * monitor-dashboard-page.tsx — 系统监控看板页（T10，从 agent/frontend MonitorPage 迁移）。
 *
 * <p>功能等价迁移（admin.py 后端端点，数据口径对齐）+ shadcn 统一：
 * - 系统健康（PostgreSQL / Redis / Qdrant 等）
 * - LLM 网关状态（主/备供应商、故障转移）
 * - 出口代理状态
 * - Token 用量统计 + 路由统计（含成功率进度条）
 * - Agent 配置概览表
 *
 * <p>每 30s 自动刷新；各指标 Promise.allSettled 逐项降级，单点失败不阻塞看板。
 * UI 规范：表格吸顶单层滚动、圆角 4px、表头 13px。
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, Cpu, RefreshCw, Server, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import {
  fetchConfigs,
  fetchHealth,
  fetchLlmStatus,
  fetchProxyStatus,
  fetchRouteStats,
  fetchTokenUsage,
  type ConfigSummary,
  type HealthData,
  type LlmStatus,
  type ProxyStatus,
  type RouteStats,
  type TokenUsageSummary,
} from './services/monitor';

const REFRESH_INTERVAL_MS = 30000;

function formatNumber(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '0';
  return new Intl.NumberFormat('zh-CN').format(n);
}

function formatTokenCount(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(1)}%`;
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

/** 状态点（ok=绿 / 异常=红）。 */
function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        ok ? 'bg-emerald-500' : 'bg-red-500',
      )}
    />
  );
}

export function MonitorDashboardPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [routeStats, setRouteStats] = useState<RouteStats | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSummary | null>(null);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [configs, setConfigs] = useState<ConfigSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      fetchHealth(),
      fetchRouteStats(),
      fetchLlmStatus(),
      fetchTokenUsage(),
      fetchProxyStatus(),
      fetchConfigs(),
    ]);
    if (results[0].status === 'fulfilled') setHealth(results[0].value);
    if (results[1].status === 'fulfilled') setRouteStats(results[1].value);
    if (results[2].status === 'fulfilled') setLlmStatus(results[2].value);
    if (results[3].status === 'fulfilled') setTokenUsage(results[3].value);
    if (results[4].status === 'fulfilled') setProxyStatus(results[4].value);
    if (results[5].status === 'fulfilled') setConfigs(results[5].value ?? []);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed && failed.status === 'rejected') {
      setError(failed.reason instanceof Error ? failed.reason.message : '部分指标获取失败');
    }
    setLastUpdated(new Date().toISOString());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void fetchAll();
    const interval = setInterval(() => void fetchAll(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const successRate =
    routeStats && routeStats.totalRequests > 0
      ? (routeStats.successfulRoutes / routeStats.totalRequests) * 100
      : 0;

  const headerActions = (
    <Button size="sm" variant="outline" onClick={() => void fetchAll()} disabled={isLoading}>
      <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
      {isLoading ? '刷新中…' : '刷新'}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="系统监控"
        description="Agent 平台实时健康与性能指标（每 30s 自动刷新）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '系统监控' })}
        actions={headerActions}
      />

      {error ? (
        <div className="mb-3 flex items-center justify-between rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
          <span>⚠ {error}</span>
          <button type="button" className="text-xs text-yellow-600 hover:text-yellow-700" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      ) : null}

      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">最后更新: {formatDateTime(lastUpdated)}</p>
      </div>

      {/* 三卡：系统健康 / LLM 网关 / 出口代理 */}
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* 系统健康 */}
        <div className="rounded border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Server className="h-4 w-4 text-primary" />
            系统健康状态
          </h3>
          {health?.checks ? (
            <div className="space-y-2">
              {Object.entries(health.checks).map(([name, status]) => {
                const ok = status === 'ok';
                return (
                  <div key={name} className="flex items-center justify-between">
                    <span className="text-xs capitalize text-muted-foreground">{name}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
                      )}
                    >
                      {ok ? '正常' : '异常'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
        </div>

        {/* LLM 网关 */}
        <div className="rounded border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Cpu className="h-4 w-4 text-primary" />
            LLM 网关状态
          </h3>
          {llmStatus ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">当前供应商</span>
                <span className="text-sm font-medium">{llmStatus.currentProvider ?? llmStatus.primaryProvider}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">主供应商</span>
                <span className="text-sm">{llmStatus.primaryProvider}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">备用供应商</span>
                <span className="text-sm">{llmStatus.fallbackProvider}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">故障转移</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    llmStatus.failoverActive ? 'bg-yellow-100 text-yellow-700' : 'bg-emerald-100 text-emerald-700',
                  )}
                >
                  {llmStatus.failoverActive ? '已激活' : '正常'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">总请求数</span>
                <span className="text-sm">{formatNumber(llmStatus.totalRequests)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">错误数</span>
                <span className="text-sm text-red-600">{formatNumber(llmStatus.errorCount)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
        </div>

        {/* 出口代理 */}
        <div className="rounded border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            出口代理状态
          </h3>
          {proxyStatus ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">代理状态</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    proxyStatus.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700',
                  )}
                >
                  {proxyStatus.enabled ? '已启用' : '已禁用'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">健康节点</span>
                <span className="text-sm">
                  {proxyStatus.healthyNodes} / {proxyStatus.totalNodes}
                </span>
              </div>
              {proxyStatus.nodes && proxyStatus.nodes.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {proxyStatus.nodes.map((node, idx) => (
                    <div key={`${node.host}-${idx}`} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">
                        {node.host}:{node.port}
                      </span>
                      <StatusDot ok={node.healthy} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
        </div>
      </div>

      {/* 双卡：Token 用量 / 路由统计 */}
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Token 用量 */}
        <div className="rounded border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Token 用量统计</h3>
          {tokenUsage ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Prompt</p>
                <p className="text-lg font-bold">{formatTokenCount(tokenUsage.totalPrompt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Completion</p>
                <p className="text-lg font-bold">{formatTokenCount(tokenUsage.totalCompletion)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">总计</p>
                <p className="text-lg font-bold text-primary">{formatTokenCount(tokenUsage.totalTokens)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
        </div>

        {/* 路由统计 */}
        <div className="rounded border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">路由统计</h3>
          {routeStats ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">总请求数</p>
                <p className="text-lg font-bold">{formatNumber(routeStats.totalRequests)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">成功路由</p>
                <p className="text-lg font-bold text-emerald-600">{formatNumber(routeStats.successfulRoutes)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">失败路由</p>
                <p className="text-lg font-bold text-red-600">{formatNumber(routeStats.failedRoutes)}</p>
              </div>
              {routeStats.totalRequests > 0 ? (
                <div className="col-span-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">成功率</span>
                    <span className="font-medium">{formatPercent(successRate)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(successRate, 100)}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
        </div>
      </div>

      {/* Agent 配置概览：表格吸顶单层滚动 */}
      <div className="min-h-0 flex-1 overflow-auto rounded border bg-card">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-sm font-semibold">Agent 配置概览</h3>
        </div>
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-table-header text-[13px] text-muted-foreground">
            <tr>
              {['Agent ID', '显示名称', '状态', '活跃'].map((label, i) => (
                <th
                  key={label}
                  className={cn(
                    'whitespace-nowrap border-b border-border px-2.5 py-2 font-medium',
                    i > 0 && 'border-l border-border/60',
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2.5 py-8 text-center text-sm text-muted-foreground">
                  暂无 Agent 配置
                </td>
              </tr>
            ) : (
              configs.map((config) => (
                <tr key={config.agentId} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                  <td className="whitespace-nowrap px-2.5 py-2 font-mono text-xs font-medium">{config.agentId}</td>
                  <td className="px-2.5 py-2">{config.displayName}</td>
                  <td className="px-2.5 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        config.state === 'running'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-700',
                      )}
                    >
                      {config.state ?? 'unknown'}
                    </span>
                  </td>
                  <td className="px-2.5 py-2">
                    {config.isActive ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MonitorDashboardPage;
