/**
 * Agent 总览页（路径 `/agent/agents`，V19 菜单 `92034`）。
 *
 * <p>覆盖 §4.3 #13 列表 / #15–#18 生命周期（start / pause / resume / stop）。
 * 行点击进入 `/agent/agents/:id` 详情（详情内再分 skills / config / coordination 三个子路由）。
 *
 * <p>**为什么用原生 `<table>` + `<select>`**：`components/ui/` 只有 13 个原语，
 * 没有 table / select / checkbox（impl-plan §2.1 零新框架，禁 `shadcn add`）。
 * 列宽拖拽与表头排序复用 `components/common` 的 `useColumnWidths` / `useClientSort`，
 * 与 `features/kb` 及批 2 的技能池页保持同一手感。
 *
 * <p>**启停按钮的露出规则复用 `actionsFor()`**（从 `agent-detail-shell.tsx` 导出）：
 * 不可用的动作**直接不渲染，不置灰** —— 置灰会让运营反复点击并提工单问"为什么点不动"。
 * 与详情头部共用同一张表，避免两处判断分叉。
 *
 * <p>导出名 `AgentListPage`；`pages.ts` 用 `as AgentAgentsPage` 桥接回
 * `keep-alive-outlet` 依赖的符号名。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CirclePlay, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PermissionGate } from '@/components/auth/permission-gate';
import { StatCard } from '@/components/common/stat-card';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { AgentPageShell } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { actionsFor, type LifecycleAction } from '../components/agent-detail-shell';
import { listAgents } from '../api/agent-ops-api';
import { useAgentStore } from '../stores/use-agent-store';
import { agentErrorMessage } from '../types';
import type { AgentState, AgentSummary } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const AGENT_COLS: ResizableColumn[] = [
  { key: 'display_name', label: '显示名' },
  // key 必须与 AgentSummary 字段同名：排序取值走 `row[key as keyof AgentSummary]`，
  // 写成 'id' 会取到 undefined，该列点击排序静默失效。
  { key: 'agent_id', label: 'Agent ID' },
  { key: 'role', label: '角色' },
  { key: 'state', label: '状态' },
  { key: 'active_sessions', label: '活跃会话' },
  { key: '__ops__', label: '操作', locked: true },
];

/** 待确认的生命周期操作（动作定义 + 目标 Agent）。 */
interface PendingLifecycle {
  action: LifecycleAction;
  agent: AgentSummary;
}

export function AgentListPage() {
  const navigate = useNavigate();

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [pending, setPending] = useState<PendingLifecycle | null>(null);

  const agentStateFilter = useAgentStore((s) => s.agentStateFilter);
  const setAgentStateFilter = useAgentStore((s) => s.setAgentStateFilter);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    AGENT_COLS,
    'mis-agent-agent-table-widths',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAgents(await listAgents());
    } catch (e) {
      setError(agentErrorMessage(e, '获取 Agent 列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return agents.filter((a) => {
      if (agentStateFilter !== 'all' && a.state !== agentStateFilter) return false;
      if (!kw) return true;
      return a.display_name.toLowerCase().includes(kw) || a.agent_id.toLowerCase().includes(kw);
    });
  }, [agents, agentStateFilter, keyword]);

  const getSortValue = useCallback(
    (row: AgentSummary, key: string) => row[key as keyof AgentSummary] as unknown,
    [],
  );
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(filtered, getSortValue);

  const runningCount = useMemo(() => agents.filter((a) => a.state === 'running').length, [agents]);
  const errorCount = useMemo(() => agents.filter((a) => a.state === 'error').length, [agents]);
  const activeSessions = useMemo(
    () => agents.reduce((sum, a) => sum + (a.active_sessions ?? 0), 0),
    [agents],
  );

  /** 执行待确认的生命周期动作：成功关弹窗 + 刷新；失败保持打开让用户看清 toast。 */
  async function runPending(): Promise<void> {
    if (!pending) return;
    try {
      await pending.action.run(pending.agent.agent_id);
      toast.success(`「${pending.agent.display_name}」已${pending.action.label}`);
      setPending(null);
      await load();
    } catch (e) {
      toast.error(agentErrorMessage(e, `${pending.action.label} Agent 失败`));
    }
  }

  const headerActions = (
    <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
      <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
      刷新
    </Button>
  );

  return (
    <AgentPageShell
      title="Agent 总览"
      description="协调者与执行者实例的统一视图。"
      permission="agent:agent:list"
      actions={headerActions}
      loading={loading && agents.length === 0}
      error={error}
      onRetry={() => void load()}
      empty={!loading && !error && agents.length === 0}
      emptyText="暂无 Agent 实例"
      emptyHint="Agent 由 ai-platform 侧的配置目录定义，请确认下游服务已启动并完成配置加载。"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Agent 总数" value={agents.length} icon={Bot} />
          <StatCard label="运行中" value={runningCount} icon={CirclePlay} />
          <StatCard label="异常" value={errorCount} icon={TriangleAlert} />
          <StatCard label="活跃会话合计" value={activeSessions} icon={Sparkles} />
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <div className="min-w-[14rem] flex-1">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
            <Input
              placeholder="搜索显示名 / Agent ID"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">状态</label>
            <select
              className={selectClass}
              value={agentStateFilter}
              onChange={(e) => setAgentStateFilter(e.target.value as AgentState | 'all')}
            >
              <option value="all">全部状态</option>
              <option value="running">运行中</option>
              <option value="paused">已暂停</option>
              <option value="stopped">已停止</option>
              <option value="error">异常</option>
            </select>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setKeyword('');
              setAgentStateFilter('all');
            }}
          >
            重置
          </Button>
          <span className="ml-auto pb-1.5 text-xs text-muted-foreground">
            共 {filtered.length} / {agents.length} 条
          </span>
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
          {hasCustom ? (
            <button
              type="button"
              onClick={reset}
              className="absolute right-3 top-3 z-20 rounded-md bg-card px-2 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground"
            >
              重置列宽
            </button>
          ) : null}
          <table
            className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
            style={tableStyle}
          >
            <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
              <tr>
                {AGENT_COLS.map((c, ci) => {
                  const active = sortKey === c.key;
                  return (
                    <th
                      key={c.key}
                      style={{ width: widthOf(c.key) }}
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={cn(
                        'relative overflow-hidden whitespace-nowrap px-0 py-0 font-bold',
                        ci > 0 && 'border-l border-border/60',
                        c.locked && 'text-right',
                      )}
                    >
                      {c.locked ? (
                        <span className="block px-3 py-2">{c.label}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={cn(
                            'flex w-full items-center gap-1 px-3 py-2 pr-5 text-left font-bold',
                            active
                              ? 'text-foreground'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {c.label}
                          <SortIndicator state={active ? sortDir : 'none'} />
                        </button>
                      )}
                      {!c.locked ? (
                        <span
                          role="separator"
                          aria-label={`调整${c.label}列宽`}
                          onMouseDown={(e) => startResize(e, c.key)}
                          className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={AGENT_COLS.length}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    没有匹配当前筛选条件的 Agent
                  </td>
                </tr>
              ) : (
                sorted.map((agent) => (
                  <tr
                    key={agent.agent_id}
                    onClick={() => navigate(`/agent/agents/${encodeURIComponent(agent.agent_id)}`)}
                    className="cursor-pointer border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                  >
                    <td className="truncate px-3 py-2 font-medium" title={agent.display_name}>
                      {agent.display_name}
                    </td>
                    <td className="truncate px-3 py-2 font-mono text-xs" title={agent.agent_id}>
                      {agent.agent_id}
                    </td>
                    <td className="px-3 py-2">
                      <AgentStatusBadge kind="agentRole" value={agent.role} />
                    </td>
                    <td className="px-3 py-2">
                      <AgentStatusBadge kind="agentState" value={agent.state} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {agent.active_sessions ?? 0}
                    </td>
                    {/*
                      操作列吞掉行点击：否则点「停止」会在弹确认框的同时跳进详情页，
                      用户回到列表时会以为操作没生效。
                    */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <PermissionGate permission="agent:agent:manage">
                          {actionsFor(agent.state).map((action) => {
                            const Icon = action.icon;
                            return (
                              <button
                                key={action.key}
                                type="button"
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem]',
                                  action.danger
                                    ? 'text-destructive hover:bg-destructive/10'
                                    : 'text-primary hover:bg-primary/10',
                                )}
                                onClick={() => setPending({ action, agent })}
                              >
                                <Icon className="h-3 w-3" />
                                {action.label}
                              </button>
                            );
                          })}
                        </PermissionGate>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-muted-foreground hover:bg-accent hover:text-foreground"
                          onClick={() =>
                            navigate(`/agent/agents/${encodeURIComponent(agent.agent_id)}`)
                          }
                        >
                          详情
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        danger={pending?.action.danger ?? false}
        title={pending?.action.confirmTitle ?? ''}
        confirmText={pending?.action.label ?? '确认'}
        description={
          pending ? (
            <>
              <p>
                目标 Agent：「{pending.agent.display_name}」（
                <span className="font-mono">{pending.agent.agent_id}</span>）。
              </p>
              <p>{pending.action.confirmText}</p>
            </>
          ) : null
        }
        onConfirm={runPending}
      />
    </AgentPageShell>
  );
}
