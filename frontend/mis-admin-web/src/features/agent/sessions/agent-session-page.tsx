/**
 * 会话管理页（UI#4，路径 `/agent/sessions`，V19 菜单 `92033`）。
 *
 * <p>覆盖 §4.3 #27 列表（后端 T04 未实现 ⇒ **501**）/ #28 #29 详情回放（**已就绪**）
 * / #30 单删（**已就绪**）/ #31 批量删（pending）。
 *
 * <p>**501 容错的关键：筛选器必须活着**。
 * 这里**不把 error 交给 `AgentPageShell`** —— 那会让整页（含筛选区）被红卡替换，
 * 用户想"换个条件再试"都做不到，只能刷新浏览器。
 * 正确做法是页头 + 筛选区常驻，只有**表格区**用 `AgentContentState` 承载三态。
 * 这也是批 3 把 `AgentContentState` 从 `AgentPageShell` 里抽出来的直接动因。
 *
 * <p>**分页是服务端分页**（`SessionQuery.page` / `page_size`，响应 `AgentPage<Session>`），
 * 但**排序是客户端排序**（`useClientSort`）—— 后端未提供排序参数，
 * 所以排序只作用于**当前页**。这一点在表头旁用文案说明，避免运营误以为是全量排序。
 *
 * <p>导出名 `AgentSessionPage`（单数，与文件名一致）；`pages.ts` 用
 * `as AgentSessionsPage` 桥接回 `keep-alive-outlet` 依赖的符号名。
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PermissionGate } from '@/components/auth/permission-gate';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { AgentPageShell, AgentContentState } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { AgentSessionDetailDialog } from './agent-session-detail-dialog';
import { batchDeleteSessions, deleteSession, listAgents, listSessions } from '../api/agent-ops-api';
import { useAgentStore } from '../stores/use-agent-store';
import { agentErrorMessage, formatTime } from '../types';
import type { AgentSummary, Session, SessionChannel, SessionQuery } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const SESSION_COLS: ResizableColumn[] = [
  { key: '__sel__', label: '选择' },
  { key: 'title', label: '会话' },
  { key: 'agent_name', label: 'Agent' },
  { key: 'channel', label: '渠道' },
  { key: 'user_name', label: '用户' },
  { key: 'message_count', label: '消息数' },
  { key: 'updated_at', label: '更新时间' },
  { key: '__ops__', label: '操作', locked: true },
];

const CHANNEL_LABELS: Record<SessionChannel, string> = {
  web: '网页',
  wecom: '企业微信',
  api: 'API',
  unknown: '未知',
};

const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 待确认的删除操作。 */
type PendingDelete =
  | { kind: 'single'; session: Session }
  | { kind: 'batch'; ids: string[] };

/**
 * 本地日期输入（`yyyy-MM-dd`）→ ISO 8601 UTC。
 *
 * <p>impl-plan §10.5：时间一律以 ISO UTC 传输。`<input type="date">` 给的是本地日期，
 * 直接当字符串发过去会让"今天"在东八区少算 8 小时。
 * `to` 补到当天 23:59:59.999，否则"截至今天"会把今天的数据全漏掉。
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

export function AgentSessionPage() {
  const [rows, setRows] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [detailId, setDetailId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);

  /** Agent 下拉候选（#13 ready）。失败只让下拉为空，不影响主列表。 */
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  const sessionFilter = useAgentStore((s) => s.sessionFilter);
  const setSessionFilter = useAgentStore((s) => s.setSessionFilter);
  const resetSessionFilter = useAgentStore((s) => s.resetSessionFilter);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    SESSION_COLS,
    'mis-agent-session-table-widths',
  );

  /**
   * 已提交的查询条件。
   *
   * <p>刻意与 `sessionFilter`（输入态）分开：否则在关键字输入框里每敲一个字符
   * 都会打一次后端。用户点「查询」或翻页时才同步过来。
   */
  const [applied, setApplied] = useState<SessionQuery>({});

  const load = useCallback(
    async (query: SessionQuery) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listSessions(query);
        setRows(result.items ?? []);
        setTotal(result.total ?? 0);
        // 翻页后清空跨页选择：批量删除只应作用于用户看得见的这一页
        setSelected(new Set());
      } catch (e) {
        setRows([]);
        setTotal(0);
        setError(agentErrorMessage(e, '获取会话列表失败'));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

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
    void load({ ...applied, page, page_size: pageSize });
  }, [load, applied, page, pageSize]);

  /** 点「查询」：把输入态固化成查询条件并回到第一页。 */
  function applyFilter(): void {
    setApplied({
      agent_id: sessionFilter.agentId || undefined,
      channel: sessionFilter.channel === 'all' ? undefined : sessionFilter.channel,
      keyword: sessionFilter.keyword.trim() || undefined,
      from: toIsoUtc(sessionFilter.from, false),
      to: toIsoUtc(sessionFilter.to, true),
    });
    setPage(1);
  }

  function onReset(): void {
    resetSessionFilter();
    setApplied({});
    setPage(1);
  }

  const getSortValue = useCallback(
    (row: Session, key: string) => row[key as keyof Session] as unknown,
    [],
  );
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(rows, getSortValue);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.session_id));

  function toggleAll(checked: boolean): void {
    setSelected(checked ? new Set(rows.map((r) => r.session_id)) : new Set());
  }

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runPending(): Promise<void> {
    if (!pending) return;
    try {
      if (pending.kind === 'single') {
        await deleteSession(pending.session.session_id);
        toast.success('会话已删除');
      } else {
        await batchDeleteSessions(pending.ids);
        toast.success(`已删除 ${pending.ids.length} 个会话`);
      }
      setPending(null);
      await load({ ...applied, page, page_size: pageSize });
    } catch (e) {
      toast.error(agentErrorMessage(e, '删除会话失败'));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const headerActions = (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void load({ ...applied, page, page_size: pageSize })}
        disabled={loading}
      >
        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        刷新
      </Button>
      <PermissionGate permission="agent:session:delete">
        <Button
          size="sm"
          variant="destructive"
          disabled={selected.size === 0}
          onClick={() => setPending({ kind: 'batch', ids: [...selected] })}
        >
          <Trash2 className="h-4 w-4" />
          批量删除{selected.size > 0 ? `（${selected.size}）` : ''}
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <AgentPageShell
      title="会话管理"
      description="跨渠道会话的检索与回放。"
      permission="agent:session:list"
      actions={headerActions}
      /*
        刻意不传 error / empty：整页三态会连筛选器一起吞掉。
        列表区的三态在下方用 AgentContentState 单独承载。
      */
      loading={loading && rows.length === 0 && error === null}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* ---------------- 筛选区：永远可用，包括 error 态 ---------------- */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <div className="w-48">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">Agent</label>
            <select
              className={selectClass}
              value={sessionFilter.agentId}
              onChange={(e) => setSessionFilter({ agentId: e.target.value })}
            >
              <option value="">全部 Agent</option>
              {agents.map((a) => (
                <option key={a.agent_id} value={a.agent_id}>
                  {a.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">渠道</label>
            <select
              className={selectClass}
              value={sessionFilter.channel}
              onChange={(e) =>
                setSessionFilter({ channel: e.target.value as SessionChannel | 'all' })
              }
            >
              <option value="all">全部渠道</option>
              <option value="web">网页</option>
              <option value="wecom">企业微信</option>
              <option value="api">API</option>
              <option value="unknown">未知</option>
            </select>
          </div>
          <div className="min-w-[12rem] flex-1">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
            <Input
              placeholder="搜索标题 / 用户"
              value={sessionFilter.keyword}
              onChange={(e) => setSessionFilter({ keyword: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilter();
              }}
            />
          </div>
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">起始日期</label>
            <Input
              type="date"
              value={sessionFilter.from}
              onChange={(e) => setSessionFilter({ from: e.target.value })}
            />
          </div>
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">结束日期</label>
            <Input
              type="date"
              value={sessionFilter.to}
              onChange={(e) => setSessionFilter({ to: e.target.value })}
            />
          </div>
          <Button size="sm" onClick={applyFilter}>
            查询
          </Button>
          <Button size="sm" variant="ghost" onClick={onReset}>
            重置
          </Button>
        </div>

        {/* ---------------- 表格区：独立三态（#27 pending 时只有这里变红） ---------------- */}
        <div className="flex min-h-0 flex-1 flex-col">
          <AgentContentState
            loading={loading && rows.length === 0}
            error={error}
            onRetry={() => void load({ ...applied, page, page_size: pageSize })}
            empty={!loading && !error && rows.length === 0}
            emptyText="没有匹配的会话"
            emptyHint="试试放宽筛选条件，或确认所选时间范围内确有会话产生。"
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
                    {SESSION_COLS.map((c, ci) => {
                      const active = sortKey === c.key;
                      const isSel = c.key === '__sel__';
                      return (
                        <th
                          key={c.key}
                          style={{ width: isSel ? 44 : widthOf(c.key) }}
                          aria-sort={
                            active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
                          className={cn(
                            'relative overflow-hidden whitespace-nowrap px-0 py-0 font-bold',
                            ci > 0 && 'border-l border-border/60',
                            c.locked && 'text-right',
                          )}
                        >
                          {isSel ? (
                            <span className="flex items-center justify-center px-2 py-2">
                              <input
                                type="checkbox"
                                aria-label="全选本页"
                                className="h-3.5 w-3.5 cursor-pointer accent-primary"
                                checked={allChecked}
                                disabled={rows.length === 0}
                                onChange={(e) => toggleAll(e.target.checked)}
                              />
                            </span>
                          ) : c.locked ? (
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
                          {!c.locked && !isSel ? (
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
                  {sorted.map((session) => (
                    <tr
                      key={session.session_id}
                      onClick={() => {
                        setDetailId(session.session_id);
                        setDetailOpen(true);
                      }}
                      className="cursor-pointer border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                    >
                      <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`选择会话 ${session.session_id}`}
                          className="h-3.5 w-3.5 cursor-pointer accent-primary"
                          checked={selected.has(session.session_id)}
                          onChange={() => toggleOne(session.session_id)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div
                          className="truncate font-medium"
                          title={session.title || session.session_id}
                        >
                          {session.title || '（无标题）'}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {session.session_id}
                        </div>
                      </td>
                      <td className="truncate px-3 py-2 text-xs">
                        {session.agent_name || session.agent_id}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {CHANNEL_LABELS[session.channel] ?? session.channel}
                      </td>
                      <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                        {session.user_name || session.user_id || '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {session.message_count ?? 0}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {formatTime(session.updated_at)}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => {
                              setDetailId(session.session_id);
                              setDetailOpen(true);
                            }}
                          >
                            <Eye className="h-3 w-3" />
                            查看
                          </button>
                          <PermissionGate permission="agent:session:delete">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                              onClick={() => setPending({ kind: 'single', session })}
                            >
                              <Trash2 className="h-3 w-3" />
                              删除
                            </button>
                          </PermissionGate>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AgentContentState>
        </div>

        {/* ---------------- 分页（服务端） ---------------- */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span>
            共 {total} 条 · 第 {page} / {totalPages} 页
          </span>
          <span className="text-muted-foreground/70">（表头排序仅作用于当前页）</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1">
              每页
              <select
                className="h-7 rounded-md border border-input bg-card px-1.5 text-xs"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number.parseInt(e.target.value, 10));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <AgentSessionDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        sessionId={detailId}
        fallbackSession={rows.find((r) => r.session_id === detailId) ?? null}
      />

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        danger
        title={pending?.kind === 'batch' ? '批量删除会话' : '删除会话'}
        confirmText="删除"
        /* 批量删除影响面大，要求逐字输入条数强确认；单删普通确认即可 */
        confirmKeyword={pending?.kind === 'batch' ? String(pending.ids.length) : undefined}
        description={
          pending?.kind === 'batch' ? (
            <>
              <p>
                将删除本页选中的 <span className="font-medium text-foreground">{pending.ids.length}</span>{' '}
                个会话及其全部消息记录。
              </p>
              <p>此操作不可撤销，删除后无法回放这些会话。</p>
            </>
          ) : pending ? (
            <>
              <p>
                将删除会话「{pending.session.title || pending.session.session_id}」（
                <span className="font-mono">{pending.session.session_id}</span>）及其
                {pending.session.message_count ?? 0} 条消息。
              </p>
              <p>此操作不可撤销。</p>
            </>
          ) : null
        }
        onConfirm={runPending}
      />
    </AgentPageShell>
  );
}
