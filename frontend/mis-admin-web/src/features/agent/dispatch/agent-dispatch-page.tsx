/**
 * 调度观测页（路径 `/agent/dispatch`，V19 菜单 `92036`，权限 `agent:dispatch:list`）。
 *
 * <p>三个端点的**就绪度不同**，因此本页刻意拆成两条互不牵连的加载链：
 *   - **主视图（已就绪）**：§4.3 #46 `listRouteLogs()` + #47 `listRouteStats()`
 *     —— 路由日志表 + 命中统计。真实数据。
 *   - **调度链路（pending）**：§4.3 #45 `listDispatchTraces()` —— ai-platform 侧
 *     尚无 trace 落库，BFF 返回 501。
 *
 * <p>**为什么 traces 必须独立成区块而不是并进主加载**：
 * 若用一次 `Promise.all` 拉三个端点，#45 的 501 会把已经能用的路由日志与命中统计
 * 一起拖进 error 态 —— 等于让一个未上线的次要能力，废掉两个已上线的主要能力。
 * 这里 traces 有自己的 loading / error / empty 与重试按钮，失败只塌陷自己那一块。
 *
 * <p>**筛选口径**：`from` / `to` / `coordinator_id` 三项对三个端点通用；
 * `status` 只对 traces 有意义（`RouteLog` / `RouteStat` 没有状态维度），
 * 故 status 下拉放在 traces 区块内，不放主筛选区 —— 放在上面会让用户以为
 * 它能过滤路由日志，然后困惑于"为什么选了失败还是这些行"。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, GitBranch, Info, RefreshCw, Route, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
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
import type { AgentSummary, DispatchTrace, RouteLog, RouteStat } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const LOG_COLS: ResizableColumn[] = [
  { key: 'created_at', label: '时间' },
  { key: 'session_id', label: '会话' },
  { key: 'matched_agent_id', label: '命中 Agent' },
  { key: 'reason', label: '命中原因', locked: true },
];

const TRACE_COLS: ResizableColumn[] = [
  { key: 'started_at', label: '开始时间' },
  { key: 'trace_id', label: 'Trace ID' },
  { key: 'coordinator_id', label: '协调者' },
  { key: 'worker_id', label: '执行者' },
  { key: 'depth', label: '深度' },
  { key: 'duration_ms', label: '耗时' },
  { key: 'status', label: '结果' },
  { key: 'task_brief', label: '任务摘要', locked: true },
];

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
  // ---- 筛选输入态（未提交） ----
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [coordinatorId, setCoordinatorId] = useState('');
  const [traceStatus, setTraceStatus] = useState<DispatchTrace['status'] | 'all'>('all');

  /** 已提交的查询条件；与输入态分开，避免改一个字符就打一次后端。 */
  const [applied, setApplied] = useState<DispatchQuery>({});

  // ---- 主视图：#46 路由日志 + #47 命中统计（ready） ----
  const [logs, setLogs] = useState<RouteLog[]>([]);
  const [stats, setStats] = useState<RouteStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  // ---- 独立区块：#45 调度链路（pending） ----
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
      setStats([]);
      setStatsError(agentErrorMessage(statResult.reason, '获取路由统计失败'));
    }
    setLoading(false);
  }, []);

  const loadTraces = useCallback(async (query: DispatchQuery) => {
    setTracesLoading(true);
    setTracesError(null);
    try {
      setTraces(await listDispatchTraces(query));
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
    void loadTraces({ ...applied, status: traceStatus === 'all' ? undefined : traceStatus });
  }, [loadTraces, applied, traceStatus]);

  /** 点「查询」：把输入态固化成查询条件，两条加载链各自重跑。 */
  function applyFilter(): void {
    setApplied({
      from: toIsoUtc(fromDate, false),
      to: toIsoUtc(toDate, true),
      coordinator_id: coordinatorId || undefined,
    });
  }

  function onReset(): void {
    setFromDate('');
    setToDate('');
    setCoordinatorId('');
    setTraceStatus('all');
    setApplied({});
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

  /** 命中统计按 hit_count 降序（后端未保证顺序，前端兜一次）。 */
  const rankedStats = useMemo(
    () => [...stats].sort((a, b) => (b.hit_count ?? 0) - (a.hit_count ?? 0)),
    [stats],
  );
  const totalHits = useMemo(
    () => stats.reduce((sum, s) => sum + (s.hit_count ?? 0), 0),
    [stats],
  );
  const topStat = rankedStats[0];

  const headerActions = (
    <Button
      size="sm"
      variant="outline"
      disabled={loading}
      onClick={() => {
        void loadMain(applied);
        void loadTraces({ ...applied, status: traceStatus === 'all' ? undefined : traceStatus });
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
      loading={loading && logs.length === 0 && stats.length === 0 && logsError === null}
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
                  <option key={a.id} value={a.id}>
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
            <StatCard label="命中总次数" value={statsError ? '-' : totalHits} icon={Target} />
            <StatCard
              label="参与 Agent 数"
              value={statsError ? '-' : stats.length}
              icon={Activity}
            />
            <StatCard
              label="命中最多"
              value={statsError || !topStat ? '-' : (topStat.display_name ?? topStat.agent_id)}
              icon={Route}
              description={topStat && !statsError ? `${topStat.hit_count} 次` : undefined}
            />
          </div>

          <AgentContentState
            error={statsError}
            onRetry={() => void loadMain(applied)}
            empty={!loading && !statsError && stats.length === 0}
            emptyText="所选范围内暂无命中统计"
            emptyHint="放宽时间范围，或确认该时段内确有会话经过路由分发。"
          >
            <Card>
              <CardContent className="space-y-2 py-3">
                {rankedStats.map((stat) => (
                  <div key={stat.agent_id} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-[10rem] truncate font-medium text-foreground">
                        {stat.display_name || stat.agent_id}
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
        <section className="flex min-h-0 flex-col gap-2">
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
            emptyHint="放宽时间范围或清空协调者筛选后重试。"
          >
            <div className="relative max-h-[26rem] overflow-auto rounded-lg border bg-table-surface">
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
                        {formatTime(log.created_at)}
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
                        title={log.reason ?? ''}
                      >
                        {log.reason || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AgentContentState>
        </section>

        {/* ---------------- 调度链路（#45 pending，独立塌陷） ---------------- */}
        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <h2 className="text-sm font-medium text-foreground">调度链路（Traces）</h2>
            <div className="w-36">
              <select
                className={selectClass}
                value={traceStatus}
                onChange={(e) =>
                  setTraceStatus(e.target.value as DispatchTrace['status'] | 'all')
                }
              >
                <option value="all">全部结果</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="running">执行中</option>
              </select>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={tracesLoading}
              onClick={() =>
                void loadTraces({
                  ...applied,
                  status: traceStatus === 'all' ? undefined : traceStatus,
                })
              }
            >
              <RefreshCw className={cn('h-4 w-4', tracesLoading && 'animate-spin')} />
              刷新链路
            </Button>
          </div>

          <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
            <p className="leading-relaxed">
              调度链路依赖 ai-platform 侧的 trace 落库能力，尚未上线；此区块失败
              <span className="font-medium text-foreground">不影响</span>
              上方的路由日志与命中统计。后端就绪后点「刷新链路」即可，无需刷新浏览器。
            </p>
          </div>

          <AgentContentState
            loading={tracesLoading && traces.length === 0}
            error={tracesError}
            onRetry={() =>
              void loadTraces({
                ...applied,
                status: traceStatus === 'all' ? undefined : traceStatus,
              })
            }
            empty={!tracesLoading && !tracesError && traces.length === 0}
            emptyText="所选范围内暂无调度链路"
            emptyHint="协调者派发任务后才会产生链路记录。"
          >
            <div className="relative max-h-[26rem] overflow-auto rounded-lg border bg-table-surface">
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
                  {sortedTraces.map((trace) => (
                    <tr
                      key={trace.trace_id}
                      className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {formatTime(trace.started_at)}
                      </td>
                      <td className="truncate px-3 py-2 font-mono text-xs" title={trace.trace_id}>
                        {trace.trace_id}
                      </td>
                      <td className="truncate px-3 py-2 text-xs" title={trace.coordinator_id}>
                        {trace.coordinator_id}
                      </td>
                      <td
                        className="truncate px-3 py-2 text-xs"
                        title={trace.worker_id ?? ''}
                      >
                        {trace.worker_id || '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{trace.depth}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {typeof trace.duration_ms === 'number' ? `${trace.duration_ms} ms` : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <AgentStatusBadge kind="dispatchStatus" value={trace.status} />
                      </td>
                      <td
                        className="truncate px-3 py-2 text-xs text-muted-foreground"
                        title={trace.task_brief ?? ''}
                      >
                        {trace.task_brief || '-'}
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
          路由日志与命中统计来自 BFF 已就绪端点；调度链路待 ai-platform 侧 trace 落库后自动可用。
        </p>
      </div>
    </AgentPageShell>
  );
}
