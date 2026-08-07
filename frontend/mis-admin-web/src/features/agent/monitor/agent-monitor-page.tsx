/**
 * 系统监控页（路径 `/agent/monitor`，V19 菜单 `92041`，权限 `agent:monitor:view`）。
 *
 * <p>覆盖 §4.3 #55 `getMonitorOverview()`（运行指标，**已就绪**）与
 * #56 `resetFailover()`（熔断重置，操作码 `agent:monitor:operate`）。
 *
 * <p>**T04 收口：真实 wire 是 BFF 三路聚合 `{proxy, llm, admin}`**：
 *   - `proxy`：出站代理节点数组（`GET /admin/proxy/status`）；
 *   - `llm`：LLM 网关状态（`GET /admin/llm/status`），含 `failover` 与
 *     `providers: { name: {healthy_keys, key_stats} }`；
 *   - `admin`：`GET /admin/health` 聚合出的 `proxy_nodes / healthy_proxy_nodes`。
 * 前端臆造的 `proxy_status / agents_running / agents_total / llm_providers / updated_at`
 * 全部删除 ——「运行中 / 已登记 Agent」卡在 wire 上无数据，一并删除
 * （Agent 计数由概览页 / 列表页从 `listAgents()` 承担）。
 *
 * <p>**本页是全 feature 唯一使用 react-query 的地方**（impl-plan §10.1 数据流约定）：
 * 其余 11 页一律 `useState + load() + useEffect`。这里破例是因为**只有本页需要轮询** ——
 * 盯盘场景下手动点刷新不现实，而自己写 `setInterval` 要处理组件卸载、
 * 请求重入、tab 切后台等一堆边界，`refetchInterval` 一行搞定且与 keep-alive 的
 * 多 Tab 缓存天然兼容。
 *
 * <p>**轮询默认关闭**（store `pollingEnabled` 初值 false）：这个接口会穿透 BFF
 * 打到 ai-platform 再打到各 LLM provider，默认开启等于让每个开着页面的运营
 * 持续压下游。由用户显式打开，间隔下限 5s 由 store 兜底。
 *
 * <p>**熔断重置为什么必须二次确认**：`resetFailover` 会把 provider 从熔断态强行拉回
 * 可用态。若故障根因未消除，重置只是让流量重新打进一个坏节点、把快速失败换成大面积超时。
 * 因此走 `AgentConfirmDialog` 并在文案里写清这一点，而不是做成一键按钮。
 */
import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Cpu,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PermissionGate } from '@/components/auth/permission-gate';
import { StatCard } from '@/components/common/stat-card';
import { AgentPageShell } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { getMonitorOverview, resetFailover } from '../api/agent-ops-api';
import { useAgentStore } from '../stores/use-agent-store';
import { agentErrorMessage, formatTime } from '../types';
import type { MonitorLlmProvider, MonitorOverview } from '../types';

const selectClass =
  'h-9 rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const POLLING_OPTIONS = [5_000, 15_000, 30_000, 60_000];

/** 待确认的熔断重置目标；`provider === null` 表示重置全部。 */
interface PendingReset {
  provider: string | null;
}

/** 把 `llm.providers`（Record）摊平成带 `name` 的行，供明细表消费。 */
function toProviderList(data: MonitorOverview | undefined): MonitorLlmProvider[] {
  const providers = data?.llm?.providers;
  if (!providers) return [];
  return Object.entries(providers).map(([name, value]) => ({
    name,
    healthy_keys: value.healthy_keys,
    key_stats: value.key_stats,
  }));
}

export function AgentMonitorPage() {
  const pollingEnabled = useAgentStore((s) => s.pollingEnabled);
  const setPollingEnabled = useAgentStore((s) => s.setPollingEnabled);
  const pollingIntervalMs = useAgentStore((s) => s.pollingIntervalMs);
  const setPollingIntervalMs = useAgentStore((s) => s.setPollingIntervalMs);

  const [pending, setPending] = useState<PendingReset | null>(null);
  /** wire 无时间戳字段；fetch 成功时打点本地时间用于页脚展示。 */
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['agent-ops', 'monitor', 'overview'],
    queryFn: getMonitorOverview,
    refetchInterval: pollingEnabled ? pollingIntervalMs : false,
  });

  useEffect(() => {
    if (data) setLoadedAt(new Date());
  }, [data]);

  const providers = toProviderList(data);
  const providerCount = providers.length;
  const healthyKeyTotal = providers.reduce(
    (sum, p) => sum + (typeof p.healthy_keys === 'number' ? p.healthy_keys : 0),
    0,
  );
  const isFailoverActive = data?.llm?.failover?.is_failover_active === true;
  const activeProvider = data?.llm?.failover?.active_provider ?? '';
  /** 每行可展开的 key 明细（provider 名 → 是否展开）。 */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const errorText = error ? agentErrorMessage(error, '获取监控总览失败') : null;

  /** #56 重置熔断：成功关弹窗 + 立即重取；失败保持打开让用户看清 toast。 */
  async function runReset(): Promise<void> {
    if (!pending) return;
    try {
      await resetFailover(pending.provider ?? undefined);
      toast.success(
        pending.provider ? `已重置提供方「${pending.provider}」的熔断状态` : '已重置全部提供方的熔断状态',
      );
      setPending(null);
      await refetch();
    } catch (e) {
      toast.error(agentErrorMessage(e, '重置 failover 失败'));
    }
  }

  const headerActions = (
    <>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 cursor-pointer accent-primary"
          checked={pollingEnabled}
          onChange={(e) => setPollingEnabled(e.target.checked)}
        />
        自动刷新
      </label>
      <select
        aria-label="自动刷新间隔"
        className={cn(selectClass, 'h-8 text-xs')}
        value={pollingIntervalMs}
        disabled={!pollingEnabled}
        onChange={(e) => setPollingIntervalMs(Number.parseInt(e.target.value, 10))}
      >
        {POLLING_OPTIONS.map((ms) => (
          <option key={ms} value={ms}>
            每 {ms / 1000} 秒
          </option>
        ))}
      </select>
      <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
        <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        刷新
      </Button>
      <PermissionGate permission="agent:monitor:operate">
        <Button
          size="sm"
          variant="destructive"
          disabled={!isFailoverActive}
          onClick={() => setPending({ provider: null })}
        >
          <Zap className="h-4 w-4" />
          重置全部熔断{isFailoverActive ? '（1）' : ''}
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <AgentPageShell
      title="系统监控"
      description="代理、Agent 与模型提供方运行态。"
      permission="agent:monitor:view"
      actions={headerActions}
      loading={isLoading}
      error={errorText}
      onRetry={() => void refetch()}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Proxy 健康"
            value={
              data?.admin ? `${data.admin.healthy_proxy_nodes} / ${data.admin.proxy_nodes}` : '-'
            }
            icon={ServerCog}
          />
          <StatCard
            label="模型提供方"
            value={data ? providerCount : '-'}
            icon={Cpu}
            description={data ? `健康 key 合计 ${healthyKeyTotal}` : undefined}
          />
          <StatCard
            label="熔断中"
            value={data ? (isFailoverActive ? 1 : 0) : '-'}
            icon={ShieldAlert}
            description={
              data
                ? isFailoverActive
                  ? `当前提供方 ${activeProvider || '未知'}`
                  : '未触发熔断'
                : undefined
            }
          />
        </div>

        {/* ---------------- LLM 提供方明细（原生 table + 展开 key_stats） ---------------- */}
        <div className="flex min-h-0 flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">
            模型提供方
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              共 {providerCount} 个
            </span>
          </h2>
          <div className="overflow-auto rounded-lg border bg-table-surface">
            <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
              <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-bold">提供方</th>
                  <th className="whitespace-nowrap border-l border-border/60 px-3 py-2 font-bold">
                    健康 Key
                  </th>
                  <th className="whitespace-nowrap border-l border-border/60 px-3 py-2 font-bold">
                    Key 明细
                  </th>
                  <th className="whitespace-nowrap border-l border-border/60 px-3 py-2 text-right font-bold">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {providers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                      暂无模型提供方数据
                    </td>
                  </tr>
                ) : (
                  providers.map((provider) => {
                    const open = expanded[provider.name] === true;
                    const keyStats = Array.isArray(provider.key_stats) ? provider.key_stats : [];
                    return (
                      <Fragment key={provider.name}>
                        <tr
                          className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                        >
                          <td className="px-3 py-2">
                            <div className="truncate font-mono text-xs" title={provider.name}>
                              {provider.name}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {typeof provider.healthy_keys === 'number' ? (
                              provider.healthy_keys > 0 ? (
                                <span className="text-success">{provider.healthy_keys}</span>
                              ) : (
                                <span className="text-destructive">{provider.healthy_keys}</span>
                              )
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [provider.name]: !open }))
                              }
                            >
                              {keyStats.length} 条
                              <span className={cn('transition-transform', open && 'rotate-180')}>
                                ▾
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <PermissionGate permission="agent:monitor:operate">
                                <button
                                  type="button"
                                  disabled={!isFailoverActive}
                                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10 disabled:opacity-40"
                                  onClick={() => setPending({ provider: provider.name })}
                                >
                                  <Zap className="h-3 w-3" />
                                  重置熔断
                                </button>
                              </PermissionGate>
                            </div>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="bg-muted/20">
                            <td colSpan={4} className="px-3 py-2">
                              {keyStats.length === 0 ? (
                                <p className="px-2 py-2 text-xs text-muted-foreground">
                                  该提供方暂无 Key 统计
                                </p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full border-separate border-spacing-0 text-left text-xs">
                                    <thead className="text-muted-foreground">
                                      <tr>
                                        <th className="px-2 py-1.5 font-bold">Label</th>
                                        <th className="px-2 py-1.5 font-bold">状态</th>
                                        <th className="px-2 py-1.5 font-bold">调用数</th>
                                        <th className="px-2 py-1.5 font-bold">错误率</th>
                                        <th className="px-2 py-1.5 font-bold">最后使用</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {keyStats.map((stat) => (
                                        <tr
                                          key={stat.label}
                                          className="border-t border-border/40"
                                        >
                                          <td className="px-2 py-1.5 font-mono" title={stat.label}>
                                            {stat.label}
                                          </td>
                                          <td className="px-2 py-1.5">
                                            {stat.is_healthy ? (
                                              <span className="text-success">健康</span>
                                            ) : stat.is_active ? (
                                              <span className="text-warning">活跃但异常</span>
                                            ) : (
                                              <span className="text-muted-foreground">未激活</span>
                                            )}
                                          </td>
                                          <td className="px-2 py-1.5 text-muted-foreground">
                                            {typeof stat.total_calls === 'number'
                                              ? stat.total_calls
                                              : '-'}
                                          </td>
                                          <td className="px-2 py-1.5 text-muted-foreground">
                                            {typeof stat.error_rate === 'number'
                                              ? `${(stat.error_rate * 100).toFixed(1)}%`
                                              : '-'}
                                          </td>
                                          <td className="px-2 py-1.5 text-muted-foreground">
                                            {formatTime(stat.last_used_at)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          数据更新于 {formatTime(loadedAt ? loadedAt.toISOString() : null)}
          {pollingEnabled ? ` · 每 ${pollingIntervalMs / 1000} 秒自动刷新` : ' · 自动刷新已关闭'}
        </p>
      </div>

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        danger
        title={pending?.provider ? '确认重置该提供方熔断' : '确认重置全部熔断'}
        confirmText="重置"
        description={
          pending ? (
            <>
              <p>
                目标：
                {pending.provider ? (
                  <span className="font-mono">{pending.provider}</span>
                ) : (
                  <span className="font-medium text-foreground">全部熔断中的提供方</span>
                )}
                。
              </p>
              <p>
                重置只是把熔断器强行拉回可用态，
                <span className="font-medium text-foreground">不会修复根因</span>。
                若下游仍不可用，流量会重新打进坏节点，把「快速失败」变成「大面积超时」，
                影响面比熔断时更大。
              </p>
              <p>建议确认下游已恢复（或已切换配置）后再执行。</p>
            </>
          ) : null
        }
        onConfirm={runReset}
      />
    </AgentPageShell>
  );
}
