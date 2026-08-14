/**
 * 调度观测页（路径 `/agent/dispatch`，V19 菜单 `92036`，权限 `agent:dispatch:list`）。
 *
 * <p>三个区块的就绪度不同，但都是真实数据流：
 *   - **主视图**：§4.3 #46 `listRouteLogs()` + #47 `listRouteStats()`
 *     —— 路由日志表 + 命中统计。`from` / `to` / `coordinator_id` 三个筛选
 *     只作用于这两个端点。
 *   - **调度链路（traces）**：§4.3 #45 `listDispatchTraces()` —— T04 收口后
 *     ai-platform 返回 `{traces, total}` 信封，只支持 `limit` 过滤（不支持
 *     from/to/status/coordinator），故本区块固定拉最近 100 条、独立刷新，
 *     与主筛选区解耦 —— 失败只塌陷自己那一块，不影响路由日志与命中统计。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, GitBranch, Info, RefreshCw, Route, Target } from 'lucide-react';
import { cn, todayLocalDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/common/stat-card';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { AgentPageShell, AgentContentState } from '../components/agent-page-shell';
import { AgentStatusBadge } from '../components/agent-status-badge';
import {
  listAgents,
  listDispatchTraces,
  listRouteLogs,
  listRouteStats,
  type DispatchQuery,
} from '../api/agent-ops-api';
import { agentErrorMessage, formatTime } from '../types';
import type { AgentSummary, DispatchTrace, RouteAgentShare, RouteLog, RouteStats } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/**
 * 路由日志列。
 *
 * <p>key 必须与 `RouteLog` 的真实字段同名（排序走 `row[key]`）：
 * 时间是 `timestamp` 不是 `created_at`，"为什么命中"由 `strategy_used` 承载 ——
 * 后端从未下发过 `reason` 字段，那一列此前恒为空。
 */
const LOG_COLS: ResizableColumn[] = [
  { key: 'timestamp', label: '时间' },
  { key: 'dispatch_kind', label: '类型' },
  { key: 'session_id', label: '会话' },
  { key: 'matched_agent_id', label: '命中 Agent' },
  { key: 'strategy_used', label: '命中策略', locked: true },
];

/** `#47` 失败或未加载时的空统计，保证消费点永远拿到可枚举对象。 */
const EMPTY_ROUTE_STATS: RouteStats = {
  total_routes: 0,
  by_agent: {},
  by_strategy: {},
  by_kind: {},
  avg_latency_ms: 0,
  avg_confidence: 0,
};

/**
 * 调度链路列（对齐 `DispatchTrace` 真实 wire）。
 *
 * <p>key 必须与字段同名（排序走 `row[key]`）：时间是 `created_at`，会话是
 * `session_id`；「调度」列用 `coordinator_id` 排序，单元格展示「调度者 → 执行者」。
 */
const TRACE_COLS: ResizableColumn[] = [
  { key: 'created_at', label: '时间' },
  { key: 'session_id', label: '会话' },
  { key: 'coordinator_id', label: '调度' },
  { key: 'tool', label: '工具' },
  { key: 'intent', label: '意图' },
  { key: 'latency_ms', label: '耗时' },
  { key: 'status', label: '结果' },
  { key: 'brief_rejected', label: 'Brief 拒绝', locked: true },
];

/** 调度链路「谁→谁」展示文案。 */
function formatDispatchEdge(trace: DispatchTrace): string {
  const from = (trace.coordinator_id || '').trim() || '-';
  const to = (trace.worker_id || '').trim() || '-';
  return `${from} → ${to}`;
}

/**
 * 本地日期输入（`yyyy-MM-dd`）→ ISO 8601 UTC（impl-plan §10.5「时间」约定）。
 *
 * <p>与会话页同款实现：`<input type="date">` 给的是本地日期，直接当字符串发过去
 * 会让"今天"在东八区少算 8 小时；`to` 补到 23:59:59.999，否则"截至今天"漏掉今天。
 */
function toIsoUtc(localDate: string, endOfDay: boolean): string | undefined {
  if (!localDate) return undefined;
  const [y, m, d] = localDate.split('-').map((x) => Number.parseInt(x, 10));
  if (!y || !m || !d) return undefined;
  const dt = endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toISOString();
}

/** `ratio` 可能是 0–1 小数，也可能后端已乘 100；>1 时按百分数原样显示。 */
function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '-';
  const pct = ratio > 1 ? ratio : ratio * 100;
  return `${pct.toFixed(1)}%`;
}

/** 统计条的宽度百分比（钳到 0–100，避免异常值把布局撑破）。 */
function barWidth(ratio: number): string {
  if (!Number.isFinite(ratio)) return '0%';
  const pct = ratio > 1 ? ratio : ratio * 100;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

export function AgentDispatchPage() {
  // ---- 筛选输入态（未提交）；起止日期默认当天 ----
  const [fromDate, setFromDate] = useState(todayLocalDate);
  const [toDate, setToDate] = useState(todayLocalDate);
  const [coordinatorId, setCoordinatorId] = useState('');
  const [kind, setKind] = useState('');

  /** 已提交的查询条件；与输入态分开，避免改一个字符就打一次后端。默认当天。 */
  const [applied, setApplied] = useState<DispatchQuery>(() => {
    const today = todayLocalDate();
    return { from: toIsoUtc(today, false), to: toIsoUtc(today, true) };
  });

  // ---- 主视图：#46 路由日志 + #47 命中统计（ready） ----
  const [logs, setLogs] = useState<RouteLog[]>([]);
  // #47 返回聚合对象而非数组，state 形状必须跟着改，否则 `[...stats]` 直接崩
  const [stats, setStats] = useState<RouteStats>(EMPTY_ROUTE_STATS);
  const [loading, setLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  // ---- 独立区块：#45 调度链路（ready，固定拉最近 100 条） ----
  const [traces, setTraces] = useState<DispatchTrace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [tracesError, setTracesError] = useState<string | null>(null);

  /** 协调者下拉候选（#13 ready）；失败只让下拉退化为空，不影响主视图。 */
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  const logCols = useColumnWidths(LOG_COLS, 'mis-agent-dispatch-log-widths');
  const traceCols = useColumnWidths(TRACE_COLS, 'mis-agent-dispatch-trace-widths');

  const loadMain = useCallback(async (query: DispatchQuery) => {
    setLoading(true);
    setLogsError(null);
    setStatsError(null);
    const [logResult, statResult] = await Promise.allSettled([
      listRouteLogs(query),
      listRouteStats(query),
    ]);

    if (logResult.status === 'fulfilled') {
      setLogs(logResult.value);
    } else {
      setLogs([]);
      setLogsError(agentErrorMessage(logResult.reason, '获取路由日志失败'));
    }

    if (statResult.status === 'fulfilled') {
      setStats(statResult.value);
    } else {
      setStats(EMPTY_ROUTE_STATS);
      setStatsError(agentErrorMessage(statResult.reason, '获取路由统计失败'));
    }
    setLoading(false);
  }, []);

  const loadTraces = useCallback(async () => {
    setTracesLoading(true);
    setTracesError(null);
    try {
      // #45 只支持 limit 过滤，固定拉最近 100 条；信封在 api 层已剥掉
      setTraces(await listDispatchTraces(100));
    } catch (e) {
      setTraces([]);
      setTracesError(agentErrorMessage(e, '获取调度链路失败'));
    } finally {
      setTracesLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    try {
      setAgents(await listAgents());
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    void loadMain(applied);
  }, [loadMain, applied]);

  useEffect(() => {
    void loadTraces();
  }, [loadTraces]);

  /** 点「查询」：把输入态固化成查询条件，主视图重跑（traces 不受筛选影响）。 */
  function applyFilter(): void {
    setApplied({
      from: toIsoUtc(fromDate, false),
      to: toIsoUtc(toDate, true),
      coordinator_id: coordinatorId || undefined,
      kind: kind || undefined,
    });
  }

  function onReset(): void {
    const today = todayLocalDate();
    setFromDate(today);
    setToDate(today);
    setCoordinatorId('');
    setKind('');
    setApplied({ from: toIsoUtc(today, false), to: toIsoUtc(today, true) });
  }

  const getLogSortValue = useCallback(
    (row: RouteLog, key: string) => row[key as keyof RouteLog] as unknown,
    [],
  );
  const {
    sorted: sortedLogs,
    sortKey: logSortKey,
    sortDir: logSortDir,
    toggleSort: toggleLogSort,
  } = useClientSort(logs, getLogSortValue);

  const getTraceSortValue = useCallback(
    (row: DispatchTrace, key: string) => row[key as keyof DispatchTrace] as unknown,
    [],
  );
  const {
    sorted: sortedTraces,
    sortKey: traceSortKey,
    sortDir: traceSortDir,
    toggleSort: toggleTraceSort,
  } = useClientSort(traces, getTraceSortValue);

  /** agent_id → 显示名，用于把 `by_agent` 的裸 id 换成人看得懂的名字。 */
  const agentNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.agent_id, a.display_name);
    return m;
  }, [agents]);

  /**
   * 把 `by_agent` 计数字典摊平成「Agent / 命中数 / 占比」并按命中数降序。
   *
   * <p>后端只给计数不给占比，故用 `total_routes` 现算；`total_routes` 为 0 时
   * 占比取 0，避免除零得到 `NaN` 再喂给 `toFixed()`。
   */
  const rankedStats = useMemo<RouteAgentShare[]>(() => {
    const total = stats.total_routes > 0 ? stats.total_routes : 0;
    return Object.entries(stats.by_agent)
      .map(([agent_id, hit_count]) => ({
        agent_id,
        hit_count,
        ratio: total > 0 ? hit_count / total : 0,
      }))
      .sort((a, b) => b.hit_count - a.hit_count);
  }, [stats]);

  /** 命中总次数：优先用后端的 `total_routes`，缺失时退回逐项求和。 */
  const totalHits = useMemo(() => {
    if (stats.total_routes > 0) return stats.total_routes;
    return rankedStats.reduce((sum, s) => sum + s.hit_count, 0);
  }, [stats, rankedStats]);

  const topStat = rankedStats[0];
  /** 统计区是否"有内容"，替代此前的 `stats.length`。 */
  const hasStats = rankedStats.length > 0;

  const headerActions = (
    <Button
      size="sm"
      variant="outline"
      disabled={loading}
      onClick={() => {
        void loadMain(applied);
        void loadTraces();
      }}
    >
      <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
      刷新
    </Button>
  );

  return (
    <AgentPageShell
      title="调度观测"
      description="协调者到执行者的调度链路与路由分析。"
      permission="agent:dispatch:list"
      actions={headerActions}
      /* 刻意不传 error：筛选区必须常驻，主视图与 traces 各自承载三态 */
      loading={loading && logs.length === 0 && !hasStats && logsError === null}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {/* ---------------- 筛选区：永远可用 ---------------- */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">起始日期</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">结束日期</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="w-44">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">调度类型</label>
            <select
              className={selectClass}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">全部类型</option>
              <option value="agent_router">自动路由</option>
              <option value="coordinator">协调委派</option>
            </select>
          </div>
          <div className="w-56">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">协调者</label>
            <select
              className={selectClass}
              value={coordinatorId}
              onChange={(e) => setCoordinatorId(e.target.value)}
            >
              <option value="">全部协调者</option>
              {agents
                .filter((a) => a.role === 'coordinator')
                .map((a) => (
                  <option key={a.agent_id} value={a.agent_id}>
                    {a.display_name}
                  </option>
                ))}
            </select>
          </div>
          <Button size="sm" onClick={applyFilter}>
            查询
          </Button>
          <Button size="sm" variant="ghost" onClick={onReset}>
            重置
          </Button>
        </div>

        {/* ---------------- 命中统计（#47 ready） ---------------- */}
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">命中统计</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard
              label="命中总次数"
              value={statsError ? '-' : totalHits}
              icon={Target}
              description={
                statsError
                  ? undefined
                  : `自动路由 ${stats.by_kind.agent_router ?? 0} · 协调委派 ${stats.by_kind.coordinator ?? 0}`
              }
            />
            <StatCard
              label="参与 Agent 数"
              value={statsError ? '-' : rankedStats.length}
              icon={Activity}
            />
            <StatCard
              label="命中最多"
              value={
                statsError || !topStat
                  ? '-'
                  : (agentNames.get(topStat.agent_id) ?? topStat.agent_id)
              }
              icon={Route}
              description={topStat && !statsError ? `${topStat.hit_count} 次` : undefined}
            />
          </div>

          <AgentContentState
            error={statsError}
            onRetry={() => void loadMain(applied)}
            empty={!loading && !statsError && !hasStats}
            emptyText="所选范围内暂无命中统计"
            emptyHint="与下方调度链路同源：协调者委派 Worker 后会出现。已有链路记录时刷新本页即可。"
          >
            <Card>
              <CardContent className="space-y-2 py-3">
                {rankedStats.map((stat) => (
                  <div key={stat.agent_id} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-[10rem] truncate font-medium text-foreground">
                        {agentNames.get(stat.agent_id) ?? stat.agent_id}
                      </span>
                      <span className="font-mono text-muted-foreground">{stat.agent_id}</span>
                      <span className="ml-auto text-muted-foreground">
                        {stat.hit_count} 次 · {formatRatio(stat.ratio)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: barWidth(stat.ratio) }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </AgentContentState>
        </section>

        {/* ---------------- 路由日志（#46 ready） ---------------- */}
        <section className="flex shrink-0 flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">
            路由日志
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              共 {logs.length} 条（表头排序仅作用于已加载数据）
            </span>
          </h2>
          <AgentContentState
            loading={loading && logs.length === 0}
            error={logsError}
            onRetry={() => void loadMain(applied)}
            empty={!loading && !logsError && logs.length === 0}
            emptyText="所选范围内暂无路由日志"
            emptyHint="与下方调度链路同源。命中 Agent 为 mis-rag、策略为 coordinator_delegate。"
          >
            <div className="relative max-h-[26rem] min-h-[12rem] overflow-auto rounded-lg border bg-table-surface">
              {logCols.hasCustom ? (
                <button
                  type="button"
                  onClick={logCols.reset}
                  className="absolute right-3 top-3 z-20 rounded-md bg-card px-2 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground"
                >
                  重置列宽
                </button>
              ) : null}
              <table
                className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
                style={logCols.tableStyle}
              >
                <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                  <tr>
                    {LOG_COLS.map((c, ci) => {
                      const active = logSortKey === c.key;
                      return (
                        <th
                          key={c.key}
                          style={{ width: logCols.widthOf(c.key) }}
                          aria-sort={
                            active ? (logSortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
                          className={cn(
                            'relative overflow-hidden whitespace-nowrap px-0 py-0 font-bold',
                            ci > 0 && 'border-l border-border/60',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleLogSort(c.key)}
                            className={cn(
                              'flex w-full items-center gap-1 px-3 py-2 pr-5 text-left font-bold',
                              active
                                ? 'text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {c.label}
                            <SortIndicator state={active ? logSortDir : 'none'} />
                          </button>
                          {!c.locked ? (
                            <span
                              role="separator"
                              aria-label={`调整${c.label}列宽`}
                              onMouseDown={(e) => logCols.startResize(e, c.key)}
                              className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
                            />
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {formatTime(log.timestamp)}
                      </td>
                      <td className="px-3 py-2">
                        <AgentStatusBadge
                          kind="dispatchKind"
                          value={log.dispatch_kind || 'agent_router'}
                        />
                      </td>
                      <td
                        className="truncate px-3 py-2 font-mono text-xs"
                        title={log.session_id ?? ''}
                      >
                        {log.session_id || '-'}
                      </td>
                      <td
                        className="truncate px-3 py-2 text-xs"
                        title={log.matched_agent_id ?? ''}
                      >
                        {log.matched_agent_id || <span className="text-warning">未命中</span>}
                      </td>
                      <td
                        className="truncate px-3 py-2 text-xs text-muted-foreground"
                        title={log.input_text ?? log.strategy_used ?? ''}
                      >
                        {log.strategy_used || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AgentContentState>
        </section>

        {/* ---------------- 调度链路（#45 ready，独立塌陷） ---------------- */}
        <section className="flex shrink-0 flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
              调度链路（Traces）
              <AgentStatusBadge kind="dispatchKind" value="coordinator" />
            </h2>
            <span className="pb-1.5 text-xs text-muted-foreground">
              仅协调委派明细 · 最近 {traces.length} 条 · 固定取最新 100 条
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={tracesLoading}
              onClick={() => void loadTraces()}
            >
              <RefreshCw className={cn('h-4 w-4', tracesLoading && 'animate-spin')} />
              刷新链路
            </Button>
          </div>

          <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
            <p className="leading-relaxed">
              调度链路来自 ai-platform 的最近委派记录（Redis 环形缓冲，重启后仍可查）；
              <span className="font-medium text-foreground">失败不影响</span>
              上方的路由日志与命中统计。问完一轮后请点「刷新链路」。
            </p>
          </div>

          <AgentContentState
            loading={tracesLoading && traces.length === 0}
            error={tracesError}
            onRetry={() => void loadTraces()}
            empty={!tracesLoading && !tracesError && traces.length === 0}
            emptyText="暂无调度链路"
            emptyHint="用 MIS智能对话助手问完后点刷新。对话与观测必须连同一套 Redis（默认都是 Nacos 的 :8000）。"
          >
            <div className="relative max-h-[26rem] min-h-[12rem] overflow-auto rounded-lg border bg-table-surface">
              {traceCols.hasCustom ? (
                <button
                  type="button"
                  onClick={traceCols.reset}
                  className="absolute right-3 top-3 z-20 rounded-md bg-card px-2 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground"
                >
                  重置列宽
                </button>
              ) : null}
              <table
                className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
                style={traceCols.tableStyle}
              >
                <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                  <tr>
                    {TRACE_COLS.map((c, ci) => {
                      const active = traceSortKey === c.key;
                      return (
                        <th
                          key={c.key}
                          style={{ width: traceCols.widthOf(c.key) }}
                          aria-sort={
                            active ? (traceSortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
                          className={cn(
                            'relative overflow-hidden whitespace-nowrap px-0 py-0 font-bold',
                            ci > 0 && 'border-l border-border/60',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleTraceSort(c.key)}
                            className={cn(
                              'flex w-full items-center gap-1 px-3 py-2 pr-5 text-left font-bold',
                              active
                                ? 'text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {c.label}
                            <SortIndicator state={active ? traceSortDir : 'none'} />
                          </button>
                          {!c.locked ? (
                            <span
                              role="separator"
                              aria-label={`调整${c.label}列宽`}
                              onMouseDown={(e) => traceCols.startResize(e, c.key)}
                              className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
                            />
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedTraces.map((trace, index) => (
                    <tr
                      key={`${trace.session_id}-${trace.task_id}-${index}`}
                      className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {formatTime(trace.created_at)}
                      </td>
                      <td
                        className="truncate px-3 py-2 font-mono text-xs"
                        title={trace.session_id}
                      >
                        {trace.session_id || '-'}
                      </td>
                      <td
                        className="truncate px-3 py-2 text-xs"
                        title={formatDispatchEdge(trace)}
                      >
                        <span className="text-muted-foreground">
                          {(trace.coordinator_id || '').trim() || '-'}
                        </span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span>{(trace.worker_id || '').trim() || '-'}</span>
                      </td>
                      <td
                        className="truncate px-3 py-2 text-xs"
                        title={trace.tool ?? ''}
                      >
                        {trace.tool || '-'}
                      </td>
                      <td
                        className="truncate px-3 py-2 text-xs text-muted-foreground"
                        title={trace.intent ?? ''}
                      >
                        {trace.intent || '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {typeof trace.latency_ms === 'number' ? `${trace.latency_ms} ms` : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <AgentStatusBadge kind="dispatchStatus" value={trace.status} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {trace.brief_rejected ? (
                          <span className="text-warning">是</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AgentContentState>
        </section>

        <p className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          路由日志、命中统计与调度链路均来自 BFF 已就绪端点；调度链路固定取最新 100 条。
        </p>
      </div>
    </AgentPageShell>
  );
}
