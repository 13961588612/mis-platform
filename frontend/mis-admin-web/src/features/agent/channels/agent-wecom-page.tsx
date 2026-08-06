/**
 * 企微机器人页（UI#3，路径 `/agent/channels/wecom`，V19 菜单 `92040`）。
 *
 * <p>覆盖 §4.3 #48 列表 / #49 新增 / #50 编辑 / #51 删除 / #52 启用 / #53 停用 / #54 健康探测。
 * 表单在 {@link AgentWecomBotDialog}（secret 只写不读的护栏全在那里）。
 *
 * <p>**整块后端当前是 pending（BFF 返回 501）**，且 Gateway 仍是单 Bot 架构（T04 才改造）。
 * 因此这里有两处刻意的降级设计：
 *
 * <p>① **501 不白屏、不锁死操作**：不把 `error` 交给 `AgentPageShell`
 * （那会让整页连筛选区和「新增」按钮一起被红卡替换），只让**表格区**走
 * `AgentContentState`。运营在后端未就绪时依然能打开表单看清字段形态，
 * 后端上线后点「重试」即可，无需刷新浏览器。这与会话页 #27 的处理一致。
 *
 * <p>② **常驻「保存后需重启 Gateway 生效」提示条**：当前 Gateway 启动时一次性装载单 Bot 配置，
 * 没有热更新通道。配置写库成功 ≠ 线上生效，如果不说明，运营会在改完后盯着
 * "健康：离线"反复怀疑自己填错了。这是策略降级，T04 改造 Gateway 后再撤掉这条。
 *
 * <p>**为什么不做健康轮询**：`pollingEnabled` 默认 false 且本组端点整体 501，
 * 轮询一个必然失败的接口只会刷屏 toast。改为「健康探测」按钮手动触发，
 * 与 MCP 页同一交互。T04 后端就绪后再评估是否接 react-query 轮询。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Info, Pencil, Plus, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PermissionGate } from '@/components/auth/permission-gate';
import { StatCard } from '@/components/common/stat-card';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { AgentPageShell, AgentContentState } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { AgentWecomBotDialog } from './agent-wecom-bot-dialog';
import {
  deleteWecomBot,
  disableWecomBot,
  enableWecomBot,
  getWecomBotsHealth,
  listAgents,
  listWecomBots,
} from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { AgentSummary, WecomBot } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const BOT_COLS: ResizableColumn[] = [
  { key: 'name', label: '名称' },
  { key: 'bot_id', label: 'Bot ID' },
  { key: 'ws_url', label: 'WS 地址' },
  { key: 'bound_agent_id', label: '绑定 Agent' },
  { key: 'health', label: '连接健康' },
  { key: 'enabled', label: '启用状态' },
  { key: '__ops__', label: '操作', locked: true },
];

/** 待确认的写操作（启用 / 停用 / 删除）。 */
type PendingBotAction =
  | { kind: 'enable'; bot: WecomBot }
  | { kind: 'disable'; bot: WecomBot }
  | { kind: 'delete'; bot: WecomBot };

export function AgentWecomPage() {
  const [bots, setBots] = useState<WecomBot[]>([]);
  /** #54 实时探测结果，键为 bot_id；探测失败时为空对象。 */
  const [health, setHealth] = useState<Record<string, WecomBot['health']>>({});
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  /** Agent 候选（#13 已就绪），供表单绑定下拉；失败只让下拉退化为手填。 */
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WecomBot | null>(null);
  const [pending, setPending] = useState<PendingBotAction | null>(null);
  /** 正在执行行内操作的 bot_id，用于禁用该行按钮防重复提交。 */
  const [busy, setBusy] = useState<string | null>(null);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    BOT_COLS,
    'mis-agent-wecom-table-widths',
  );

  /** #48 列表 + #54 探活；探活失败只降级健康列，不影响列表。 */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, probe] = await Promise.allSettled([listWecomBots(), getWecomBotsHealth()]);
      if (list.status === 'rejected') throw list.reason;
      setBots(list.value);
      if (probe.status === 'fulfilled') {
        setHealth(probe.value);
        setHealthLoaded(true);
      } else {
        setHealth({});
        setHealthLoaded(false);
      }
    } catch (e) {
      setBots([]);
      setError(agentErrorMessage(e, '获取企微机器人列表失败'));
    } finally {
      setLoading(false);
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
    void load();
  }, [load]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  /** #54 单独重探活：链路抖动时不需要把整张表重新拉一遍。 */
  async function refreshHealth(): Promise<void> {
    setProbing(true);
    try {
      setHealth(await getWecomBotsHealth());
      setHealthLoaded(true);
      toast.success('连接健康已刷新');
    } catch (e) {
      setHealthLoaded(false);
      toast.error(agentErrorMessage(e, '获取企微机器人健康状态失败'));
    } finally {
      setProbing(false);
    }
  }

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(bot: WecomBot): void {
    setEditing(bot);
    setFormOpen(true);
  }

  /** 执行待确认的写操作：成功关弹窗 + 刷新；失败保持打开让用户看清 toast。 */
  async function runPending(): Promise<void> {
    if (!pending) return;
    const { kind, bot } = pending;
    setBusy(bot.bot_id);
    try {
      if (kind === 'enable') {
        await enableWecomBot(bot.bot_id);
        toast.success(`Bot「${bot.name}」已启用，重启 Gateway 后生效`);
      } else if (kind === 'disable') {
        await disableWecomBot(bot.bot_id);
        toast.success(`Bot「${bot.name}」已停用，重启 Gateway 后生效`);
      } else {
        await deleteWecomBot(bot.bot_id);
        toast.success(`Bot「${bot.name}」已删除`);
      }
      setPending(null);
      await load();
    } catch (e) {
      const fallback =
        kind === 'enable' ? '启用企微机器人失败' : kind === 'disable' ? '停用企微机器人失败' : '删除企微机器人失败';
      toast.error(agentErrorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return bots.filter((b) => {
      if (enabledFilter === 'enabled' && !b.enabled) return false;
      if (enabledFilter === 'disabled' && b.enabled) return false;
      if (!kw) return true;
      return (
        b.name.toLowerCase().includes(kw) ||
        b.bot_id.toLowerCase().includes(kw) ||
        b.ws_url.toLowerCase().includes(kw)
      );
    });
  }, [bots, keyword, enabledFilter]);

  /** 健康列排序：离线(0) < 未知(1) < 在线(2)，让离线项集中在一端。 */
  const getSortValue = useCallback(
    (row: WecomBot, key: string) => {
      if (key === 'health') {
        const value = health[row.bot_id] ?? row.health;
        if (value === 'connected') return 2;
        if (value === 'unknown') return 1;
        return 0;
      }
      return row[key as keyof WecomBot] as unknown;
    },
    [health],
  );
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(filtered, getSortValue);

  const enabledCount = useMemo(() => bots.filter((b) => b.enabled).length, [bots]);
  const onlineCount = useMemo(
    () => bots.filter((b) => (health[b.bot_id] ?? b.health) === 'connected').length,
    [bots, health],
  );

  const headerActions = (
    <>
      <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        刷新
      </Button>
      <Button size="sm" variant="outline" onClick={() => void refreshHealth()} disabled={probing}>
        <Activity className={cn('h-4 w-4', probing && 'animate-pulse')} />
        健康探测
      </Button>
      <PermissionGate permission="agent:wecom:manage">
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          新增 Bot
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <AgentPageShell
      title="企微机器人"
      description="企业微信渠道的多实例接入与启停。"
      permission="agent:wecom:list"
      actions={headerActions}
      /*
        刻意不传 error / empty：整页三态会把筛选区与「新增 Bot」一起吞掉。
        列表区三态在下方用 AgentContentState 单独承载（#48 当前 501）。
      */
      loading={loading && bots.length === 0 && error === null}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* ---------------- 常驻策略提示：写库 ≠ 线上生效 ---------------- */}
        <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
          <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="leading-relaxed">
            <span className="font-medium text-foreground">保存后需重启 Gateway 生效。</span>{' '}
            当前 Gateway 在启动时一次性装载机器人配置，没有热更新通道 ——
            新增 / 编辑 / 启停在此页保存成功后
            <span className="font-medium text-foreground">不会</span>
            立即作用于线上连接，需要运维重启 Gateway 进程。
            重启前「连接健康」列仍会显示旧连接的状态。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Bot 总数" value={bots.length} icon={Bot} />
          <StatCard label="已启用" value={enabledCount} icon={Power} />
          <StatCard label="连接在线" value={healthLoaded ? onlineCount : '-'} icon={Activity} />
        </div>

        {/* ---------------- 筛选区：永远可用，包括 error 态 ---------------- */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <div className="min-w-[14rem] flex-1">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
            <Input
              placeholder="搜索名称 / Bot ID / WS 地址"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">启用状态</label>
            <select
              className={selectClass}
              value={enabledFilter}
              onChange={(e) => setEnabledFilter(e.target.value as 'all' | 'enabled' | 'disabled')}
            >
              <option value="all">全部</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已停用</option>
            </select>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setKeyword('');
              setEnabledFilter('all');
            }}
          >
            重置
          </Button>
          <span className="ml-auto pb-1.5 text-xs text-muted-foreground">
            共 {filtered.length} / {bots.length} 条
          </span>
        </div>

        {/* ---------------- 表格区：独立三态（#48 pending 时只有这里变红） ---------------- */}
        <div className="flex min-h-0 flex-1 flex-col">
          <AgentContentState
            loading={loading && bots.length === 0}
            error={error}
            onRetry={() => void load()}
            empty={!loading && !error && bots.length === 0}
            emptyText="尚未接入任何企微机器人"
            emptyHint="点击右上角「新增 Bot」登记第一个实例；保存后需重启 Gateway 才会建立连接。"
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
                    {BOT_COLS.map((c, ci) => {
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
                        colSpan={BOT_COLS.length}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        没有匹配当前筛选条件的机器人
                      </td>
                    </tr>
                  ) : (
                    sorted.map((bot) => {
                      const rowBusy = busy === bot.bot_id;
                      const liveHealth = health[bot.bot_id] ?? bot.health;
                      const boundAgent = agents.find((a) => a.agent_id === bot.bound_agent_id);
                      return (
                        <tr
                          key={bot.bot_id}
                          className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                        >
                          <td className="truncate px-3 py-2 font-medium" title={bot.name}>
                            {bot.name}
                          </td>
                          <td className="truncate px-3 py-2 font-mono text-xs" title={bot.bot_id}>
                            {bot.bot_id}
                          </td>
                          <td
                            className="truncate px-3 py-2 font-mono text-xs text-muted-foreground"
                            title={bot.ws_url}
                          >
                            {bot.ws_url}
                          </td>
                          <td className="truncate px-3 py-2 text-xs">
                            {bot.bound_agent_id
                              ? (boundAgent?.display_name ?? bot.bound_agent_id)
                              : <span className="text-muted-foreground">默认路由</span>}
                          </td>
                          <td className="px-3 py-2">
                            <AgentStatusBadge kind="wecomHealth" value={liveHealth} />
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {bot.enabled ? (
                              <span className="text-success">已启用</span>
                            ) : (
                              <span className="text-muted-foreground">已停用</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <PermissionGate permission="agent:wecom:manage">
                                <button
                                  type="button"
                                  disabled={rowBusy}
                                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10 disabled:opacity-50"
                                  onClick={() => openEdit(bot)}
                                >
                                  <Pencil className="h-3 w-3" />
                                  编辑
                                </button>
                              </PermissionGate>
                              <PermissionGate permission="agent:wecom:manage">
                                {bot.enabled ? (
                                  <button
                                    type="button"
                                    disabled={rowBusy}
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-warning hover:bg-warning/10 disabled:opacity-50"
                                    onClick={() => setPending({ kind: 'disable', bot })}
                                  >
                                    <PowerOff className="h-3 w-3" />
                                    停用
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={rowBusy}
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-success hover:bg-success/10 disabled:opacity-50"
                                    onClick={() => setPending({ kind: 'enable', bot })}
                                  >
                                    <Power className="h-3 w-3" />
                                    启用
                                  </button>
                                )}
                              </PermissionGate>
                              <PermissionGate permission="agent:wecom:manage">
                                <button
                                  type="button"
                                  disabled={rowBusy}
                                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                  onClick={() => setPending({ kind: 'delete', bot })}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  删除
                                </button>
                              </PermissionGate>
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

      <AgentWecomBotDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        bot={editing}
        agents={agents}
        onSaved={() => void load()}
      />

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        danger={pending?.kind !== 'enable'}
        title={
          pending?.kind === 'enable'
            ? '确认启用机器人'
            : pending?.kind === 'disable'
              ? '确认停用机器人'
              : '确认删除机器人'
        }
        confirmText={
          pending?.kind === 'enable' ? '启用' : pending?.kind === 'disable' ? '停用' : '删除'
        }
        /* 删除不可逆且会连带丢失绑定关系，要求逐字输入名称强确认 */
        confirmKeyword={pending?.kind === 'delete' ? pending.bot.name : undefined}
        description={
          pending ? (
            <>
              <p>
                目标 Bot：「{pending.bot.name}」（
                <span className="font-mono">{pending.bot.bot_id}</span>）。
              </p>
              {pending.kind === 'enable' ? (
                <p>启用后该 Bot 会在下次 Gateway 启动时建立连接并接收企微消息。</p>
              ) : pending.kind === 'disable' ? (
                <p>停用后该 Bot 不再接收企微消息；已建立的连接会在 Gateway 重启后断开。</p>
              ) : (
                <p>删除会同时移除该 Bot 的接入配置与 Agent 绑定关系，且不可撤销。</p>
              )}
              <p className="text-warning">该变更需重启 Gateway 后才在线上生效。</p>
            </>
          ) : null
        }
        onConfirm={runPending}
      />
    </AgentPageShell>
  );
}
