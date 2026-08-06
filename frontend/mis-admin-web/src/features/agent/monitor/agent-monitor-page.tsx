/**
 * 系统监控页（路径 `/agent/monitor`，V19 菜单 `92041`，权限 `agent:monitor:view`）。
 *
 * <p>覆盖 §4.3 #55 `getMonitorOverview()`（运行指标，**已就绪**）与
 * #56 `resetFailover()`（熔断重置，操作码 `agent:monitor:operate`）。
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
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CirclePlay,
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
import type { MonitorOverview } from '../types';

const selectClass =
  'h-9 rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/** Proxy 状态 → 中文 + 语义色（`AgentStatusBadge` 无此类别，仅此一处使用）。 */
const PROXY_STATUS_TEXT: Record<MonitorOverview['proxy_status'], { label: string; cls: string }> = {
  up: { label: '正常', cls: 'text-success' },
  degraded: { label: '降级', cls: 'text-warning' },
  down: { label: '不可用', cls: 'text-destructive' },
};

const POLLING_OPTIONS = [5_000, 15_000, 30_000, 60_000];

/** 待确认的熔断重置目标；`provider === null` 表示重置全部。 */
interface PendingReset {
  provider: string | null;
}

export function AgentMonitorPage() {
  const pollingEnabled = useAgentStore((s) => s.pollingEnabled);
  const setPollingEnabled = useAgentStore((s) => s.setPollingEnabled);
  const pollingIntervalMs = useAgentStore((s) => s.pollingIntervalMs);
  const setPollingIntervalMs = useAgentStore((s) => s.setPollingIntervalMs);

  const [pending, setPending] = useState<PendingReset | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['agent-ops', 'monitor', 'overview'],
    queryFn: getMonitorOverview,
    refetchInterval: pollingEnabled ? pollingIntervalMs : false,
  });

  const providers = data?.llm_providers ?? [];
  const healthyCount = providers.filter((p) => p.healthy).length;
  const trippedCount = providers.filter((p) => p.tripped).length;
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
          disabled={trippedCount === 0}
          onClick={() => setPending({ provider: null })}
        >
          <Zap className="h-4 w-4" />
          重置全部熔断{trippedCount > 0 ? `（${trippedCount}）` : ''}
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Proxy 状态"
            value={data ? PROXY_STATUS_TEXT[data.proxy_status].label : '-'}
            icon={ServerCog}
          />
          <StatCard
            label="运行中 / 已登记 Agent"
            value={data ? `${data.agents_running} / ${data.agents_total}` : '-'}
            icon={CirclePlay}
          />
          <StatCard
            label="提供方健康"
            value={data ? `${healthyCount} / ${providers.length}` : '-'}
            icon={Cpu}
          />
          <StatCard
            label="熔断中"
            value={data ? trippedCount : '-'}
            icon={ShieldAlert}
            description={trippedCount > 0 ? '排障后再重置，否则会重新打爆下游' : undefined}
          />
        </div>

        {/* ---------------- LLM 提供方明细（原生 table） ---------------- */}
        <div className="flex min-h-0 flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">
            模型提供方
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              共 {providers.length} 个
            </span>
          </h2>
          <div className="overflow-auto rounded-lg border bg-table-surface">
            <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm">
              <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-bold">提供方</th>
                  <th className="whitespace-nowrap border-l border-border/60 px-3 py-2 font-bold">
                    健康
                  </th>
                  <th className="whitespace-nowrap border-l border-border/60 px-3 py-2 font-bold">
                    熔断
                  </th>
                  <th className="whitespace-nowrap border-l border-border/60 px-3 py-2 font-bold">
                    延迟
                  </th>
                  <th className="whitespace-nowrap border-l border-border/60 px-3 py-2 text-right font-bold">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {providers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                      暂无模型提供方数据
                    </td>
                  </tr>
                ) : (
                  providers.map((provider) => (
                    <tr
                      key={provider.name}
                      className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                    >
                      <td className="truncate px-3 py-2 font-mono text-xs" title={provider.name}>
                        {provider.name}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {provider.healthy ? (
                          <span className="text-success">健康</span>
                        ) : (
                          <span className="text-destructive">异常</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {provider.tripped ? (
                          <span className="text-warning">熔断中</span>
                        ) : (
                          <span className="text-muted-foreground">正常</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {typeof provider.latency_ms === 'number' ? `${provider.latency_ms} ms` : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <PermissionGate permission="agent:monitor:operate">
                            <button
                              type="button"
                              disabled={!provider.tripped}
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          数据更新于 {formatTime(data?.updated_at)}
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
