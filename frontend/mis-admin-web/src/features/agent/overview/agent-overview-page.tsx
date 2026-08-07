/**
 * 概览页（路径 `/agent/overview`，V19 菜单 `92031`，权限 `agent:overview:view`）。
 *
 * <p>数据来自两个**已就绪**端点的聚合：
 *   - §4.3 #13 `listAgents()` —— Agent 维度（总数 / 运行中 / 异常 / 已启用技能合计）；
 *   - §4.3 #55 `getMonitorOverview()` —— 运行指标（Proxy 状态 / LLM provider 健康与熔断）。
 *
 * <p>**为什么两路各自承担错误，而不是 `Promise.all` 一失败就整页红**：
 * 这两组指标彼此独立 —— #55 挂了不代表 Agent 列表不可用，反之亦然。
 * 概览页是运营进 App 的第一屏，把"其中一半可用"渲染成整页错误会显著放大故障感知。
 * 因此用 `Promise.allSettled` + 分区降级：单侧失败只在该区块显示提示条并可单独重试，
 * **两侧都失败**才把整页交给 `AgentPageShell` 的 error 态。
 *
 * <p>本页**不做轮询**：概览是"看一眼"的场景，`pollingEnabled` 默认 false 的初衷
 * 就是别让每个开着页面的运营都在持续压下游。需要盯盘请去系统监控页。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  CirclePlay,
  Cpu,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PermissionGate } from '@/components/auth/permission-gate';
import { StatCard } from '@/components/common/stat-card';
import { AgentPageShell } from '../components/agent-page-shell';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { getMonitorOverview, listAgents } from '../api/agent-ops-api';
import { agentErrorMessage, formatTime } from '../types';
import type { AgentSummary, MonitorLlmProvider, MonitorOverview } from '../types';

/** 快捷入口：`permission` 与 ui.md §2 的菜单码一致，无权限者直接不渲染该卡。 */
const QUICK_LINKS: ReadonlyArray<{
  to: string;
  title: string;
  desc: string;
  permission: string;
}> = [
  { to: '/agent/agents', title: 'Agent 总览', desc: '实例状态与启停', permission: 'agent:agent:list' },
  { to: '/agent/skills', title: '技能池', desc: '技能创建与启停', permission: 'agent:skill:list' },
  { to: '/agent/sessions', title: '会话管理', desc: '会话检索与回放', permission: 'agent:session:list' },
  { to: '/agent/monitor', title: '系统监控', desc: '运行态与熔断重置', permission: 'agent:monitor:view' },
];

export function AgentOverviewPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [monitor, setMonitor] = useState<MonitorOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  /** wire 无时间戳字段；#55 fetch 成功时打点本地时间用于卡副文案。 */
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setAgentsError(null);
    setMonitorError(null);
    const [agentResult, monitorResult] = await Promise.allSettled([
      listAgents(),
      getMonitorOverview(),
    ]);

    if (agentResult.status === 'fulfilled') {
      setAgents(agentResult.value);
    } else {
      setAgents([]);
      setAgentsError(agentErrorMessage(agentResult.reason, '获取 Agent 列表失败'));
    }

    if (monitorResult.status === 'fulfilled') {
      setMonitor(monitorResult.value);
      setLoadedAt(new Date());
    } else {
      setMonitor(null);
      setMonitorError(agentErrorMessage(monitorResult.reason, '获取监控总览失败'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runningCount = useMemo(() => agents.filter((a) => a.state === 'running').length, [agents]);
  const errorCount = useMemo(() => agents.filter((a) => a.state === 'error').length, [agents]);
  const activeSessions = useMemo(
    () => agents.reduce((sum, a) => sum + (a.active_sessions ?? 0), 0),
    [agents],
  );

  /** 把 `llm.providers`（Record）摊平成带 `name` 的行，供下方明细消费。 */
  const providers = useMemo<MonitorLlmProvider[]>(() => {
    const raw = monitor?.llm?.providers;
    if (!raw) return [];
    return Object.entries(raw).map(([name, value]) => ({
      name,
      healthy_keys: value.healthy_keys,
      key_stats: value.key_stats,
    }));
  }, [monitor]);

  const isFailoverActive = monitor?.llm?.failover?.is_failover_active === true;
  const activeProvider = monitor?.llm?.failover?.active_provider ?? '';
  const healthyKeyTotal = useMemo(
    () =>
      providers.reduce(
        (sum, p) => sum + (typeof p.healthy_keys === 'number' ? p.healthy_keys : 0),
        0,
      ),
    [providers],
  );
  const loadedAtIso = loadedAt ? loadedAt.toISOString() : null;

  /** 两侧都失败才算整页失败：一半可用时不该整页红。 */
  const bothFailed = agentsError !== null && monitorError !== null;

  const headerActions = (
    <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
      <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
      刷新
    </Button>
  );

  return (
    <AgentPageShell
      title="概览"
      description="智能体运营控制台总览。"
      permission="agent:overview:view"
      actions={headerActions}
      loading={loading && agents.length === 0 && monitor === null && !bothFailed}
      error={bothFailed ? (agentsError ?? monitorError) : null}
      onRetry={() => void load()}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
        {/* ---------------- Agent 统计（#13） ---------------- */}
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Agent 统计</h2>
          {agentsError ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{agentsError}</span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => void load()}>
                重试
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Agent 总数" value={agents.length} icon={Bot} />
              <StatCard label="运行中" value={runningCount} icon={CirclePlay} />
              <StatCard label="异常" value={errorCount} icon={AlertTriangle} />
              <StatCard label="活跃会话合计" value={activeSessions} icon={Sparkles} />
            </div>
          )}
        </section>

        {/* ---------------- 运行指标（#55） ---------------- */}
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">运行指标</h2>
          {monitorError ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{monitorError}</span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => void load()}>
                重试
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatCard
                  label="Proxy 健康"
                  value={
                    monitor?.admin
                      ? `${monitor.admin.healthy_proxy_nodes} / ${monitor.admin.proxy_nodes}`
                      : '-'
                  }
                  icon={ServerCog}
                  description={monitor ? `更新于 ${formatTime(loadedAtIso)}` : undefined}
                />
                <StatCard
                  label="模型提供方"
                  value={monitor ? providers.length : '-'}
                  icon={Cpu}
                  description={monitor ? `健康 key 合计 ${healthyKeyTotal}` : undefined}
                />
                <StatCard
                  label="熔断中"
                  value={monitor ? (isFailoverActive ? 1 : 0) : '-'}
                  icon={ShieldAlert}
                  description={
                    monitor
                      ? isFailoverActive
                        ? `当前提供方 ${activeProvider || '未知'}，可在系统监控页重置`
                        : '未触发熔断'
                      : undefined
                  }
                />
              </div>

              {providers.length > 0 ? (
                <Card>
                  <CardContent className="space-y-2 py-3">
                    {providers.map((p) => (
                      <div
                        key={p.name}
                        className="flex flex-wrap items-center gap-2 text-xs"
                      >
                        <span className="min-w-[8rem] font-mono text-foreground">{p.name}</span>
                        <span
                          className={
                            (p.healthy_keys ?? 0) > 0 ? 'text-success' : 'text-destructive'
                          }
                        >
                          {p.healthy_keys} 个健康 key
                        </span>
                        <span className="text-muted-foreground">
                          {p.key_stats?.length ?? 0} 个 key 明细
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </section>

        {/* ---------------- 最近异常 Agent（本地派生，不额外打后端） ---------------- */}
        {!agentsError && errorCount > 0 ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">需要关注的 Agent</h2>
            <Card>
              <CardContent className="space-y-2 py-3">
                {agents
                  .filter((a) => a.state === 'error')
                  .map((a) => (
                    <div key={a.agent_id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-[10rem] font-medium text-foreground">
                        {a.display_name}
                      </span>
                      <span className="font-mono text-muted-foreground">{a.agent_id}</span>
                      <AgentStatusBadge kind="agentRole" value={a.role} />
                      <AgentStatusBadge kind="agentState" value={a.state} />
                      <PermissionGate permission="agent:agent:list">
                        <Link
                          to={`/agent/agents/${encodeURIComponent(a.agent_id)}`}
                          className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          查看详情
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      </PermissionGate>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </section>
        ) : null}

        {/* ---------------- 快捷入口 ---------------- */}
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">快捷入口</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_LINKS.map((link) => (
              <PermissionGate key={link.to} permission={link.permission}>
                <Link to={link.to} className="block">
                  <Card className="px-4 py-3 shadow-card transition-shadow hover:shadow-card-hover">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{link.title}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{link.desc}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
              </PermissionGate>
            ))}
          </div>
        </section>
      </div>
    </AgentPageShell>
  );
}
