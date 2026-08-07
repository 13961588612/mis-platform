/**
 * Worker Catalog 页（UI#10 全局视图，路径 `/agent/catalog`，V19 菜单 `92035`）。
 *
 * <p>覆盖 §4.3 #43 `getWorkerCatalog()`。T04 收口后真实 wire 是**聚合对象**
 * `{workers[], coordinators[], fallback}` —— 行内全是 worker，协调者是 `coordinators`
 * 字符串数组（无元数据，仅计数展示）。
 *
 * <p>**为什么没有"就地编辑"，只有深链**：
 * §4.3 #44 `saveWorkerCatalog()` 是**整表覆盖**语义（`PUT /catalog` + `{updates}`），
 * 在一个多人同时操作的运营台里做整表提交，等于把"最后保存者覆盖所有人"写进产品 ——
 * 而单 Agent 的 `PUT /agents/{id}/coordination`（#26）本身就有角色互斥校验与
 * 级联清理回执（`CoordinationSaveResult.affected_agents`）。
 * 因此本页定位为**只读总览 + 深链**，编辑一律回到 `/agent/agents/:id/coordination`
 * 这条唯一写入路径，不给第二个入口。
 *
 * <p>**行内深链按钮为什么不包 `agent:catalog:manage`**：它只是跳转，
 * 真正的写权限由目标页 `agent:agent:coordination` 把关。
 * 在这里预先隐藏会让"有调度配置权、无 catalog 管理权"的人找不到入口。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, ListChecks, RefreshCw, ShieldAlert, Settings2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatCard } from '@/components/common/stat-card';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { AgentPageShell, AgentContentState } from '../components/agent-page-shell';
import { getWorkerCatalog } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { SecurityLevel, WorkerCatalog, WorkerCatalogWorker } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const CATALOG_COLS: ResizableColumn[] = [
  { key: 'display_name', label: '显示名' },
  { key: 'agent_id', label: 'Agent ID' },
  { key: 'when_to_use', label: '适用场景（when_to_use）' },
  { key: 'security_level', label: '安全等级' },
  { key: 'enabled', label: '可调度' },
  { key: '__ops__', label: '操作', locked: true },
];

/** 安全等级文案（真实 wire 仅两档：read_only / needs_hitl）。 */
const SECURITY_TEXT: Record<SecurityLevel, { label: string; cls: string }> = {
  read_only: { label: '只读', cls: 'text-info' },
  needs_hitl: { label: '需人工审批（HITL）', cls: 'text-warning' },
};

/** 安全等级排序权重：需人工审批排前面，便于集中复核。 */
const SECURITY_WEIGHT: Record<SecurityLevel, number> = { needs_hitl: 1, read_only: 2 };

export function AgentCatalogPage() {
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState<WorkerCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [securityFilter, setSecurityFilter] = useState<SecurityLevel | 'all'>('all');

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    CATALOG_COLS,
    'mis-agent-catalog-table-widths',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await getWorkerCatalog());
    } catch (e) {
      setCatalog(null);
      setError(agentErrorMessage(e, '获取 Worker Catalog 失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workers = useMemo(() => catalog?.workers ?? [], [catalog]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return workers.filter((worker) => {
      if (securityFilter !== 'all' && worker.security_level !== securityFilter) return false;
      if (!kw) return true;
      return (
        worker.display_name.toLowerCase().includes(kw) ||
        worker.agent_id.toLowerCase().includes(kw) ||
        (worker.when_to_use ?? '').toLowerCase().includes(kw)
      );
    });
  }, [workers, keyword, securityFilter]);

  const getSortValue = useCallback((row: WorkerCatalogWorker, key: string) => {
    if (key === 'security_level') return SECURITY_WEIGHT[row.security_level];
    return row[key as keyof WorkerCatalogWorker] as unknown;
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(filtered, getSortValue);

  const workerCount = workers.length;
  const coordinatorCount = useMemo(() => catalog?.coordinators.length ?? 0, [catalog]);
  const dispatchableCount = useMemo(() => workers.filter((w) => w.enabled).length, [workers]);
  const highRiskCount = useMemo(
    () => workers.filter((w) => w.security_level === 'needs_hitl').length,
    [workers],
  );

  const headerActions = (
    <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
      <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
      刷新
    </Button>
  );

  return (
    <AgentPageShell
      title="Worker Catalog"
      description="全局可调度的执行者清单。"
      permission="agent:catalog:list"
      actions={headerActions}
      /* 刻意不传 error：筛选区在 #43 未就绪时仍需可用，表格区自带三态 */
      loading={loading && workers.length === 0 && error === null}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="执行者（Worker）" value={workerCount} icon={Users} />
          <StatCard label="协调者（Coordinator）" value={coordinatorCount} icon={ListChecks} />
          <StatCard label="可被调度" value={dispatchableCount} icon={Settings2} />
          <StatCard label="需人工审批（needs_hitl）" value={highRiskCount} icon={ShieldAlert} />
        </div>

        <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
          <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
          <p className="leading-relaxed">
            本页是<span className="font-medium text-foreground">只读总览</span>：
            Catalog 元数据（when_to_use / 输入输出契约 / 安全等级）由各 Agent 自己的
            「调度配置」页维护。点击行内「编辑调度配置」深链到该 Agent 的
            coordination 页面单条保存，避免整表覆盖互相冲掉。
          </p>
        </div>

        {/* ---------------- 筛选区：永远可用，包括 error 态 ---------------- */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <div className="min-w-[14rem] flex-1">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
            <Input
              placeholder="搜索显示名 / Agent ID / 适用场景"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="w-44">
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
            variant="ghost"
            onClick={() => {
              setKeyword('');
              setSecurityFilter('all');
            }}
          >
            重置
          </Button>
          <span className="ml-auto pb-1.5 text-xs text-muted-foreground">
            共 {filtered.length} / {workers.length} 条
          </span>
        </div>

        {/* ---------------- 表格区：独立三态（#43 pending 时只有这里变红） ---------------- */}
        <div className="flex min-h-0 flex-1 flex-col">
          <AgentContentState
            loading={loading && workers.length === 0}
            error={error}
            onRetry={() => void load()}
            empty={!loading && !error && workers.length === 0}
            emptyText="Catalog 暂无条目"
            emptyHint="Catalog 由各 Agent 的 metadata.yaml 汇总而来，请确认已有 Agent 配置了 when_to_use 等调度元数据。"
          >
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
                    {CATALOG_COLS.map((c, ci) => {
                      const active = sortKey === c.key;
                      return (
                        <th
                          key={c.key}
                          style={{ width: widthOf(c.key) }}
                          aria-sort={
                            active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
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
                        colSpan={CATALOG_COLS.length}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        没有匹配当前筛选条件的条目
                      </td>
                    </tr>
                  ) : (
                    sorted.map((worker) => {
                      const security =
                        SECURITY_TEXT[worker.security_level] ?? SECURITY_TEXT.read_only;
                      return (
                        <tr
                          key={worker.agent_id}
                          className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                        >
                          <td
                            className="truncate px-3 py-2 font-medium"
                            title={worker.display_name}
                          >
                            {worker.display_name}
                          </td>
                          <td
                            className="truncate px-3 py-2 font-mono text-xs"
                            title={worker.agent_id}
                          >
                            {worker.agent_id}
                          </td>
                          <td
                            className="truncate px-3 py-2 text-xs text-muted-foreground"
                            title={worker.when_to_use ?? ''}
                          >
                            {worker.when_to_use || '（未声明）'}
                          </td>
                          <td className={cn('px-3 py-2 text-xs', security.cls)}>
                            {security.label}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {worker.enabled ? (
                              <span className="text-success">可调度</span>
                            ) : (
                              <span className="text-muted-foreground">已排除</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                                onClick={() =>
                                  navigate(
                                    `/agent/agents/${encodeURIComponent(worker.agent_id)}/coordination`,
                                  )
                                }
                              >
                                <Settings2 className="h-3 w-3" />
                                编辑调度配置
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
          </AgentContentState>
        </div>
      </div>
    </AgentPageShell>
  );
}
