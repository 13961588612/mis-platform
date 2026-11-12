/**
 * Agent 总览页（路径 `/agent/agents`，V19 菜单 `92034`）。
 *
 * <p>覆盖：
 * <ul>
 *   <li>§4.3 #13 列表 / #15–#18 生命周期（start / pause / resume / stop）</li>
 *   <li>原 Worker Catalog（#43）汇总指标 + 调度只读列；编辑深链 coordination</li>
 * </ul>
 *
 * <p>列表行 = 本地 configs 全量；「运行位」列展示本机内存 / Redis 租约持有者。
 * 调度列（适用场景 / 安全等级 / 可调度）由 `GET /agent-ops/catalog` 按 agent_id 拼装，
 * 仅 Worker 有值；Coordinator 显示「—」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  CirclePlay,
  ListChecks,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PermissionGate } from '@/components/auth/permission-gate';
import { StatCard } from '@/components/common/stat-card';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { RESET_COL_WIDTH_OVERLAY_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
import { AgentPageShell } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { actionsFor, type LifecycleAction } from '../components/agent-detail-shell';
import { getWorkerCatalog, listAgents } from '../api/agent-ops-api';
import { useAgentStore } from '../stores/use-agent-store';
import { agentErrorMessage } from '../types';
import type {
  AgentRole,
  AgentState,
  AgentSummary,
  SecurityLevel,
  WorkerCatalog,
  WorkerCatalogWorker,
} from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const AGENT_COLS: ResizableColumn[] = [
  { key: 'display_name', label: '显示名' },
  { key: 'agent_id', label: 'Agent ID' },
  { key: 'role', label: '角色' },
  { key: 'state', label: '状态' },
  { key: 'in_process', label: '运行位' },
  { key: 'when_to_use', label: '适用场景' },
  { key: 'security_level', label: '安全等级' },
  { key: 'catalog_enabled', label: '可调度' },
  { key: 'active_sessions', label: '活跃会话' },
  { key: '__ops__', label: '操作', locked: true },
];

const SECURITY_TEXT: Record<SecurityLevel, { label: string; cls: string }> = {
  read_only: { label: '只读', cls: 'text-info' },
  needs_hitl: { label: '需人工审批', cls: 'text-warning' },
};

const SECURITY_WEIGHT: Record<SecurityLevel, number> = { needs_hitl: 1, read_only: 2 };

/** 列表行：AgentSummary + Catalog 拼装字段。 */
interface AgentListRow extends AgentSummary {
  when_to_use?: string | null;
  security_level?: SecurityLevel | null;
  /** null = 非 Catalog 中的 Worker（如纯 Coordinator）。 */
  catalog_enabled?: boolean | null;
}

/** 待确认的生命周期操作（动作定义 + 目标 Agent）。 */
interface PendingLifecycle {
  action: LifecycleAction;
  agent: AgentSummary;
}

/** 运行位徽章：内存加载态 + 租约持有者。 */
function PresenceBadges({ agent }: { agent: AgentSummary }) {
  const inProcess = agent.in_process === true;
  let leaseLabel = '无租约';
  let leaseVariant: 'success' | 'warning' | 'secondary' = 'secondary';
  if (agent.lease_held_locally) {
    leaseLabel = '本机租约';
    leaseVariant = 'success';
  } else if (agent.lease_owner) {
    leaseLabel = `租约: ${agent.lease_owner}`;
    leaseVariant = 'warning';
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant={inProcess ? 'info' : 'outline'} title={inProcess ? '已在本进程内存' : '未装入本进程'}>
        {inProcess ? '内存' : '未加载'}
      </Badge>
      <Badge
        variant={leaseVariant}
        title={
          agent.core_id
            ? `本机 CORE_ID=${agent.core_id}`
            : '未启用多 Core 租约（或本机未注入 CORE_ID）'
        }
      >
        {leaseLabel}
      </Badge>
    </div>
  );
}

export function AgentListPage() {
  const navigate = useNavigate();

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [catalog, setCatalog] = useState<WorkerCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState<AgentRole | 'all'>('all');
  const [securityFilter, setSecurityFilter] = useState<SecurityLevel | 'all'>('all');
  const [pending, setPending] = useState<PendingLifecycle | null>(null);

  const agentStateFilter = useAgentStore((s) => s.agentStateFilter);
  const setAgentStateFilter = useAgentStore((s) => s.setAgentStateFilter);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    AGENT_COLS,
    'mis-agent-agent-table-widths-v2',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentList, workerCatalog] = await Promise.all([
        listAgents(),
        getWorkerCatalog().catch(() => null),
      ]);
      setAgents(agentList);
      setCatalog(workerCatalog);
      if (workerCatalog == null) {
        // Catalog 失败不挡列表：调度列为空，指标为 0；控制台可另查权限 agent:catalog:list
        console.warn('[AgentList] Worker Catalog 不可用，调度列/汇总将降级');
      }
    } catch (e) {
      setError(agentErrorMessage(e, '获取 Agent 列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workerById = useMemo(() => {
    const map = new Map<string, WorkerCatalogWorker>();
    for (const w of catalog?.workers ?? []) {
      map.set(w.agent_id, w);
    }
    return map;
  }, [catalog]);

  const rows = useMemo<AgentListRow[]>(
    () =>
      agents.map((a) => {
        const w = workerById.get(a.agent_id);
        if (!w) {
          return { ...a, when_to_use: null, security_level: null, catalog_enabled: null };
        }
        return {
          ...a,
          when_to_use: w.when_to_use ?? '',
          security_level: w.security_level,
          catalog_enabled: w.enabled,
        };
      }),
    [agents, workerById],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((a) => {
      if (agentStateFilter !== 'all' && a.state !== agentStateFilter) return false;
      if (roleFilter !== 'all' && a.role !== roleFilter) return false;
      if (securityFilter !== 'all') {
        if (a.security_level !== securityFilter) return false;
      }
      if (!kw) return true;
      return (
        a.display_name.toLowerCase().includes(kw) ||
        a.agent_id.toLowerCase().includes(kw) ||
        (a.when_to_use ?? '').toLowerCase().includes(kw)
      );
    });
  }, [rows, agentStateFilter, roleFilter, securityFilter, keyword]);

  const getSortValue = useCallback((row: AgentListRow, key: string) => {
    if (key === 'security_level') {
      return row.security_level ? SECURITY_WEIGHT[row.security_level] : 99;
    }
    if (key === 'catalog_enabled') {
      if (row.catalog_enabled == null) return 2;
      return row.catalog_enabled ? 0 : 1;
    }
    if (key === 'when_to_use') return row.when_to_use ?? '';
    return row[key as keyof AgentListRow] as unknown;
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(filtered, getSortValue);

  const runningCount = useMemo(() => agents.filter((a) => a.state === 'running').length, [agents]);
  const errorCount = useMemo(() => agents.filter((a) => a.state === 'error').length, [agents]);
  const activeSessions = useMemo(
    () => agents.reduce((sum, a) => sum + (a.active_sessions ?? 0), 0),
    [agents],
  );

  const workerCount = catalog?.workers.length ?? 0;
  const coordinatorCount = catalog?.coordinators.length ?? agents.filter((a) => a.role === 'coordinator').length;
  const dispatchableCount = useMemo(
    () => (catalog?.workers ?? []).filter((w) => w.enabled).length,
    [catalog],
  );
  const highRiskCount = useMemo(
    () => (catalog?.workers ?? []).filter((w) => w.security_level === 'needs_hitl').length,
    [catalog],
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
      description="全部 Agent 的运行态与 Worker 调度摘要；调度元数据在「调度配置」页编辑。"
      permission="agent:agent:list"
      actions={headerActions}
      loading={loading && agents.length === 0}
      error={error}
      onRetry={() => void load()}
      empty={!loading && !error && agents.length === 0}
      emptyText="暂无 Agent 配置"
      emptyHint="显示本地 configs/agents 目录中的全部 Agent；请确认 ai-platform 已启动并完成配置加载。"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <StatCard size="sm" label="Agent 总数" value={agents.length} icon={Bot} />
          <StatCard size="sm" label="运行中" value={runningCount} icon={CirclePlay} />
          <StatCard size="sm" label="异常" value={errorCount} icon={TriangleAlert} />
          <StatCard size="sm" label="活跃会话合计" value={activeSessions} icon={Sparkles} />
          <StatCard size="sm" label="执行者（Worker）" value={workerCount} icon={Users} />
          <StatCard size="sm" label="协调者（Coordinator）" value={coordinatorCount} icon={ListChecks} />
          <StatCard size="sm" label="可被调度" value={dispatchableCount} icon={Settings2} />
          <StatCard size="sm" label="需人工审批" value={highRiskCount} icon={ShieldAlert} />
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <div className="min-w-[12rem] flex-1">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
            <Input
              placeholder="显示名 / Agent ID / 适用场景"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="w-36">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">角色</label>
            <select
              className={selectClass}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as AgentRole | 'all')}
            >
              <option value="all">全部角色</option>
              <option value="coordinator">Coordinator</option>
              <option value="worker">Worker</option>
            </select>
          </div>
          <div className="w-36">
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
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">安全等级</label>
            <select
              className={selectClass}
              value={securityFilter}
              onChange={(e) => setSecurityFilter(e.target.value as SecurityLevel | 'all')}
            >
              <option value="all">全部等级</option>
              <option value="read_only">只读</option>
              <option value="needs_hitl">需人工审批</option>
            </select>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setKeyword('');
              setRoleFilter('all');
              setAgentStateFilter('all');
              setSecurityFilter('all');
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
            <ResetColWidthButton onClick={reset} className={RESET_COL_WIDTH_OVERLAY_CLASS} />
          ) : null}
          <table
            className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
            style={tableStyle}
          >
            <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
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
                sorted.map((agent) => {
                  const security = agent.security_level
                    ? SECURITY_TEXT[agent.security_level]
                    : null;
                  return (
                    <tr
                      key={agent.agent_id}
                      onClick={() =>
                        navigate(`/agent/agents/${encodeURIComponent(agent.agent_id)}`)
                      }
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
                      <td className="px-3 py-2">
                        <PresenceBadges agent={agent} />
                      </td>
                      <td
                        className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground"
                        title={agent.when_to_use ?? undefined}
                      >
                        {agent.role === 'worker'
                          ? agent.when_to_use || '（未声明）'
                          : '—'}
                      </td>
                      <td className={cn('px-3 py-2 text-xs', security?.cls ?? 'text-muted-foreground')}>
                        {security?.label ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {agent.catalog_enabled == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : agent.catalog_enabled ? (
                          <span className="text-success">可调度</span>
                        ) : (
                          <span className="text-muted-foreground">已排除</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {agent.active_sessions ?? 0}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {agent.in_process === true ? (
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
                          ) : null}
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() =>
                              navigate(
                                `/agent/agents/${encodeURIComponent(agent.agent_id)}/coordination`,
                              )
                            }
                          >
                            <Settings2 className="h-3 w-3" />
                            调度配置
                          </button>
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
                  );
                })
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
