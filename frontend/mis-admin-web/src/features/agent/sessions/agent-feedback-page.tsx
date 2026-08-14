/**
 * 会话反馈运营页（路径 `/agent/feedback`，V43 菜单 92046，permission `agent:feedback:view`）。
 *
 * <p>两个页签：
 *   - **反馈列表**（CF-01 / CF-03）：分页 + 过滤 + 单条/批量标记处理 + 会话回放下钻；
 *   - **统计看板**（CF-05）：基础计数（总数/点赞/吐槽/点赞率/吐槽率/待处理）+
 *     按 Agent 维度 + 按日趋势。
 *
 * <p>数据全部来自 ai-platform ``agent_feedback`` 表（运营读侧权威），经 BFF
 * `/agent-ops/sessions/feedback/**` 透传。默认排序「吐槽且带说明优先，再按反馈时间
 * 倒序」由下游实现，本页不做客户端排序——与「表头排序仅作用于当前页」的会话列表
 * 不同，这里翻页后顺序仍全局一致。
 *
 * <p>**不把 error 交给 `AgentPageShell`**（与会话列表同款决策）：筛选器必须活着，
 * 只有表格/看板区用 `AgentContentState` 承载三态。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  MessageSquareWarning,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PermissionGate } from '@/components/auth/permission-gate';
import { StatCard } from '@/components/common/stat-card';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { AgentPageShell, AgentContentState } from '../components/agent-page-shell';
import { AgentSessionDetailDialog } from './agent-session-detail-dialog';
import {
  batchProcessAgentFeedback,
  getAgentFeedbackStats,
  listAgentFeedback,
  listAgents,
  processAgentFeedback,
} from '../api/agent-ops-api';
import { agentErrorMessage, FEEDBACK_STATUS_META, formatRate, formatTime } from '../types';
import type {
  AgentFeedbackItem,
  AgentFeedbackQuery,
  AgentFeedbackRating,
  AgentFeedbackStats,
  AgentFeedbackStatus,
  AgentSummary,
  Session,
  SessionChannel,
} from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const FEEDBACK_COLS: ResizableColumn[] = [
  { key: '__sel__', label: '选择' },
  { key: 'rating', label: '评价' },
  { key: 'answer_brief', label: '回答摘要' },
  { key: 'agent_name', label: 'Agent' },
  { key: 'user_name', label: '用户' },
  { key: 'status', label: '处理状态' },
  { key: 'handler_name', label: '处理人' },
  { key: 'created_at', label: '反馈时间' },
  { key: '__ops__', label: '操作', locked: true },
];

const PAGE_SIZE_OPTIONS = [20, 50, 100];

const EMPTY_FILTER = {
  agentId: '',
  channel: 'all' as SessionChannel | 'all',
  rating: '' as '' | AgentFeedbackRating,
  status: '' as '' | AgentFeedbackStatus,
  keyword: '',
  from: '',
  to: '',
};

/** 待确认的标记处理操作。 */
type ProcessTarget =
  | { kind: 'single'; item: AgentFeedbackItem }
  | { kind: 'batch'; ids: number[] };

/**
 * 本地日期输入（`yyyy-MM-dd`）→ ISO 8601 UTC（与会话列表页同款实现）。
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

/** 由反馈行拼一个最简 `Session` 兜底，供详情抽屉在元信息拉取失败时显示标题/用户。 */
function fallbackSessionOf(item: AgentFeedbackItem): Session {
  return {
    session_id: item.session_id,
    agent_id: item.agent_id,
    agent_name: item.agent_name ?? undefined,
    channel: 'unknown',
    user_id: item.user_id ?? undefined,
    user_name: item.user_name ?? undefined,
    title: item.answer_brief || item.session_id,
    message_count: 0,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

/**
 * 标记处理弹窗（单条 / 批量共用）。
 *
 * <p>状态机 pending → handled/ignored 单向终态由后端裁定；本弹窗只对
 * **待处理**行真正生效（批量时后端仅更新 pending 行，返回实际更新数）。
 */
function ProcessFeedbackDialog({
  target,
  onOpenChange,
  onDone,
}: {
  target: ProcessTarget | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<'handled' | 'ignored'>('handled');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 每次打开重置表单，避免上次的备注残留到下一次操作。
  useEffect(() => {
    if (target) {
      setStatus('handled');
      setNote('');
    }
  }, [target]);

  async function submit(): Promise<void> {
    if (!target) return;
    setSubmitting(true);
    try {
      if (target.kind === 'batch') {
        const res = await batchProcessAgentFeedback(target.ids, {
          status,
          note: note.trim() || undefined,
        });
        toast.success(`已处理 ${res.processed} 条反馈（共请求 ${res.requested} 条）`);
      } else {
        await processAgentFeedback(target.item.id, {
          status,
          note: note.trim() || undefined,
        });
        toast.success('反馈已标记');
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(agentErrorMessage(e, '标记反馈失败'));
    } finally {
      setSubmitting(false);
    }
  }

  const batchCount = target && target.kind === 'batch' ? target.ids.length : 0;
  const title = target?.kind === 'batch' ? `批量标记（${batchCount} 条）` : '标记反馈处理';

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            状态机 pending → handled / ignored 单向终态；已处理或已忽略的反馈不会回退。
            {batchCount > 0 ? ' 批量操作仅对待处理（pending）状态的反馈生效。' : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={status === 'handled' ? 'default' : 'outline'}
              onClick={() => setStatus('handled')}
            >
              <CheckCircle2 className="h-4 w-4" />
              标记已处理
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={status === 'ignored' ? 'border-destructive/40 text-destructive' : ''}
              onClick={() => setStatus('ignored')}
            >
              <XCircle className="h-4 w-4" />
              标记忽略
            </Button>
          </div>
          <div>
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">
              处理备注（可选）
            </label>
            <Textarea
              value={note}
              maxLength={500}
              placeholder="记录处理结论 / 跟进计划…"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || !target}>
            {submitting ? '提交中…' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentFeedbackPage() {
  const [tab, setTab] = useState('list');

  // ---- 反馈列表状态 ----
  const [rows, setRows] = useState<AgentFeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- 统计看板状态 ----
  const [stats, setStats] = useState<AgentFeedbackStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // ---- 筛选 / 操作 ----
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [applied, setApplied] = useState<AgentFeedbackQuery>({});
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [processTarget, setProcessTarget] = useState<ProcessTarget | null>(null);
  const [detailId, setDetailId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);

  const [agents, setAgents] = useState<AgentSummary[]>([]);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    FEEDBACK_COLS,
    'mis-agent-feedback-table-widths',
  );

  const loadList = useCallback(async (query: AgentFeedbackQuery) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAgentFeedback(query);
      setRows(result.items ?? []);
      setTotal(result.total ?? 0);
      setSelected(new Set());
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(agentErrorMessage(e, '获取会话反馈列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = useCallback(async (query: AgentFeedbackQuery) => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const data = await getAgentFeedbackStats({
        agent_id: query.agent_id,
        channel: query.channel,
        from: query.from,
        to: query.to,
      });
      setStats(data);
    } catch (e) {
      setStats(null);
      setStatsError(agentErrorMessage(e, '获取会话反馈统计失败'));
    } finally {
      setStatsLoading(false);
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
    void loadList({ ...applied, page, page_size: pageSize });
  }, [loadList, applied, page, pageSize]);

  // 切到看板页签时按当前已提交的筛选加载统计（不随列表翻页联动）
  useEffect(() => {
    if (tab !== 'stats') return;
    void loadStats(applied);
  }, [tab, applied, loadStats]);

  function applyFilter(): void {
    setApplied({
      agent_id: filter.agentId || undefined,
      channel: filter.channel === 'all' ? undefined : filter.channel,
      rating: filter.rating || undefined,
      comment_only: undefined,
      status: filter.status || undefined,
      keyword: filter.keyword.trim() || undefined,
      from: toIsoUtc(filter.from, false),
      to: toIsoUtc(filter.to, true),
    });
    setPage(1);
  }

  function onReset(): void {
    setFilter(EMPTY_FILTER);
    setApplied({});
    setPage(1);
  }

  function toggleAll(checked: boolean): void {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function toggleOne(id: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 标记处理 / 批量 / 单条完成后的统一刷新（留在当前页）。 */
  const onProcessDone = useCallback(() => {
    void loadList({ ...applied, page, page_size: pageSize });
    if (tab === 'stats') void loadStats(applied);
  }, [loadList, loadStats, applied, page, pageSize, tab]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const detailFallback: AgentFeedbackItem | null =
    rows.find((r) => r.session_id === detailId) ?? null;

  const headerActions = (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void loadList({ ...applied, page, page_size: pageSize });
          if (tab === 'stats') void loadStats(applied);
        }}
        disabled={loading || statsLoading}
      >
        <RefreshCw className={cn('h-4 w-4', (loading || statsLoading) && 'animate-spin')} />
        刷新
      </Button>
      <PermissionGate permission="agent:feedback:view">
        <Button
          size="sm"
          disabled={selected.size === 0}
          onClick={() => setProcessTarget({ kind: 'batch', ids: [...selected] })}
        >
          <MessageSquareWarning className="h-4 w-4" />
          批量标记{selected.size > 0 ? `（${selected.size}）` : ''}
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <AgentPageShell
      title="会话反馈"
      description="跨渠道 Copilot 会话反馈的跟进与统计。"
      permission="agent:feedback:view"
      actions={headerActions}
      loading={loading && rows.length === 0 && tab === 'list' && error === null}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* ---------------- 筛选区：永远可用，包括 error 态 ---------------- */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <div className="w-44">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">Agent</label>
            <select
              className={selectClass}
              value={filter.agentId}
              onChange={(e) => setFilter((f) => ({ ...f, agentId: e.target.value }))}
            >
              <option value="">全部 Agent</option>
              {agents.map((a) => (
                <option key={a.agent_id} value={a.agent_id}>
                  {a.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">渠道</label>
            <select
              className={selectClass}
              value={filter.channel}
              onChange={(e) =>
                setFilter((f) => ({ ...f, channel: e.target.value as SessionChannel | 'all' }))
              }
            >
              <option value="all">全部渠道</option>
              <option value="web">网页</option>
              <option value="wecom">企业微信</option>
              <option value="api">API</option>
              <option value="unknown">未知</option>
            </select>
          </div>
          <div className="w-32">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">评价</label>
            <select
              className={selectClass}
              value={filter.rating}
              onChange={(e) =>
                setFilter((f) => ({ ...f, rating: e.target.value as '' | AgentFeedbackRating }))
              }
            >
              <option value="">全部评价</option>
              <option value="up">点赞</option>
              <option value="down">吐槽</option>
            </select>
          </div>
          <div className="w-36">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">处理状态</label>
            <select
              className={selectClass}
              value={filter.status}
              onChange={(e) =>
                setFilter((f) => ({ ...f, status: e.target.value as '' | AgentFeedbackStatus }))
              }
            >
              <option value="">全部状态</option>
              <option value="pending">待处理</option>
              <option value="handled">已处理</option>
              <option value="ignored">已忽略</option>
            </select>
          </div>
          <div className="min-w-[12rem] flex-1">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
            <Input
              placeholder="搜索吐槽说明"
              value={filter.keyword}
              onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilter();
              }}
            />
          </div>
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">起始日期</label>
            <Input
              type="date"
              value={filter.from}
              onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">结束日期</label>
            <Input
              type="date"
              value={filter.to}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <Button size="sm" onClick={applyFilter}>
            查询
          </Button>
          <Button size="sm" variant="ghost" onClick={onReset}>
            重置
          </Button>
        </div>

        {/* ---------------- 页签 ---------------- */}
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="w-fit">
            <TabsTrigger value="list">反馈列表</TabsTrigger>
            <TabsTrigger value="stats">统计看板</TabsTrigger>
          </TabsList>

          {/* ============ Tab 1：反馈列表 ============ */}
          <TabsContent value="list" className="flex min-h-0 flex-1 flex-col">
            <AgentContentState
              loading={loading && rows.length === 0}
              error={error}
              onRetry={() => void loadList({ ...applied, page, page_size: pageSize })}
              empty={!loading && !error && rows.length === 0}
              emptyText="没有匹配的反馈"
              emptyHint="试试放宽筛选条件，或确认用户确实提交过反馈。"
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
                      {FEEDBACK_COLS.map((c, ci) => {
                        const isSel = c.key === '__sel__';
                        return (
                          <th
                            key={c.key}
                            style={{ width: isSel ? 44 : widthOf(c.key) }}
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
                                  checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                                  disabled={rows.length === 0}
                                  onChange={(e) => toggleAll(e.target.checked)}
                                />
                              </span>
                            ) : c.locked ? (
                              <span className="block px-3 py-2">{c.label}</span>
                            ) : (
                              <span className="block px-3 py-2">{c.label}</span>
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
                    {rows.map((item) => {
                      const statusMeta = FEEDBACK_STATUS_META[item.status] ?? FEEDBACK_STATUS_META.pending;
                      const pending = item.status === 'pending';
                      return (
                        <tr
                          key={item.id}
                          className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                        >
                          <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`选择反馈 ${item.id}`}
                              className="h-3.5 w-3.5 cursor-pointer accent-primary"
                              checked={selected.has(item.id)}
                              onChange={() => toggleOne(item.id)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            {item.rating === 'down' ? (
                              <Badge variant="destructive">
                                <ThumbsDown className="h-3 w-3" />
                                吐槽
                              </Badge>
                            ) : (
                              <Badge variant="success">
                                <ThumbsUp className="h-3 w-3" />
                                点赞
                              </Badge>
                            )}
                          </td>
                          <td className="max-w-[22rem] px-3 py-2">
                            <div className="truncate text-xs" title={item.answer_brief || ''}>
                              {item.answer_brief || '（无回答摘要）'}
                            </div>
                            {item.comment ? (
                              <div
                                className="mt-0.5 truncate text-xs text-destructive/80"
                                title={item.comment}
                              >
                                说明：{item.comment}
                              </div>
                            ) : null}
                          </td>
                          <td className="truncate px-3 py-2 text-xs">
                            {item.agent_name || item.agent_id}
                          </td>
                          <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                            {item.user_name || item.user_id || '-'}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                          </td>
                          <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                            {item.handler_name || item.handler_id || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {formatTime(item.created_at)}
                          </td>
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                                onClick={() => {
                                  setDetailId(item.session_id);
                                  setDetailOpen(true);
                                }}
                              >
                                <Eye className="h-3 w-3" />
                                查看会话
                              </button>
                              <PermissionGate permission="agent:feedback:view">
                                {pending ? (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-foreground hover:bg-accent"
                                    onClick={() => setProcessTarget({ kind: 'single', item })}
                                  >
                                    <MessageSquareWarning className="h-3 w-3" />
                                    处理
                                  </button>
                                ) : (
                                  <span className="px-1.5 py-0.5 text-[0.7rem] text-muted-foreground/60">
                                    已终态
                                  </span>
                                )}
                              </PermissionGate>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </AgentContentState>

            {/* 分页（服务端，与筛选共用） */}
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
              <span>
                共 {total} 条 · 第 {page} / {totalPages} 页
              </span>
              <span className="text-muted-foreground/70">
                （默认吐槽且带说明优先，按反馈时间倒序）
              </span>
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
          </TabsContent>

          {/* ============ Tab 2：统计看板 ============ */}
          <TabsContent value="stats" className="flex min-h-0 flex-1 flex-col">
            <AgentContentState
              loading={statsLoading && stats === null}
              error={statsError}
              onRetry={() => void loadStats(applied)}
              empty={!statsLoading && !statsError && stats !== null && stats.total === 0}
              emptyText="暂无反馈数据"
              emptyHint="用户提交反馈后，这里会展示统计结果。"
            >
              {stats ? (
                <div className="flex flex-col gap-4">
                  {/* 基础计数卡片 */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <StatCard label="反馈总数" value={stats.total} icon={MessageSquareWarning} />
                    <StatCard label="点赞" value={stats.up} icon={ThumbsUp} />
                    <StatCard label="吐槽" value={stats.down} icon={ThumbsDown} />
                    <StatCard label="点赞率" value={formatRate(stats.up_rate)} icon={ThumbsUp} />
                    <StatCard label="吐槽率" value={formatRate(stats.down_rate)} icon={ThumbsDown} />
                    <StatCard
                      label="待处理"
                      value={stats.pending}
                      icon={CheckCircle2}
                      description="status=pending"
                    />
                  </div>

                  <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-2">
                    {/* 按 Agent 维度 */}
                    <div className="flex min-h-0 flex-col rounded-lg border bg-card">
                      <h3 className="border-b px-3 py-2 text-sm font-medium">按 Agent</h3>
                      <div className="min-h-0 flex-1 overflow-auto">
                        <table className="w-full border-separate border-spacing-0 text-left text-xs">
                          <thead className="sticky top-0 bg-card text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-bold">Agent</th>
                              <th className="px-3 py-2 text-right font-bold">反馈数</th>
                              <th className="px-3 py-2 text-right font-bold">点赞</th>
                              <th className="px-3 py-2 text-right font-bold">吐槽</th>
                              <th className="px-3 py-2 text-right font-bold">点赞率</th>
                              <th className="px-3 py-2 text-right font-bold">吐槽率</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(stats.by_agent)
                              .sort((a, b) => b[1].total - a[1].total)
                              .map(([agentId, s]) => (
                                <tr key={agentId} className="border-t border-border/50">
                                  <td className="truncate px-3 py-2 font-medium">{agentId}</td>
                                  <td className="px-3 py-2 text-right">{s.total}</td>
                                  <td className="px-3 py-2 text-right text-success">{s.up}</td>
                                  <td className="px-3 py-2 text-right text-destructive">{s.down}</td>
                                  <td className="px-3 py-2 text-right">{formatRate(s.up_rate)}</td>
                                  <td className="px-3 py-2 text-right">{formatRate(s.down_rate)}</td>
                                </tr>
                              ))}
                            {Object.keys(stats.by_agent).length === 0 ? (
                              <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                                  暂无数据
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 按日趋势 */}
                    <div className="flex min-h-0 flex-col rounded-lg border bg-card">
                      <h3 className="border-b px-3 py-2 text-sm font-medium">按日趋势（UTC）</h3>
                      <div className="min-h-0 flex-1 overflow-auto">
                        <table className="w-full border-separate border-spacing-0 text-left text-xs">
                          <thead className="sticky top-0 bg-card text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-bold">日期</th>
                              <th className="px-3 py-2 text-right font-bold">点赞</th>
                              <th className="px-3 py-2 text-right font-bold">吐槽</th>
                              <th className="px-3 py-2 text-right font-bold">带说明吐槽</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(stats.by_day)
                              .sort((a, b) => (a[0] < b[0] ? 1 : -1))
                              .map(([day, s]) => (
                                <tr key={day} className="border-t border-border/50">
                                  <td className="px-3 py-2 font-mono">{day}</td>
                                  <td className="px-3 py-2 text-right text-success">{s.up}</td>
                                  <td className="px-3 py-2 text-right text-destructive">{s.down}</td>
                                  <td className="px-3 py-2 text-right">{s.comment}</td>
                                </tr>
                              ))}
                            {Object.keys(stats.by_day).length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                                  暂无数据
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </AgentContentState>
          </TabsContent>
        </Tabs>
      </div>

      {/* 会话回放下钻（CF-04）：复用既有详情抽屉，无需后端改动 */}
      <AgentSessionDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        sessionId={detailId}
        fallbackSession={detailFallback ? fallbackSessionOf(detailFallback) : null}
      />

      <ProcessFeedbackDialog
        target={processTarget}
        onOpenChange={(open) => {
          if (!open) setProcessTarget(null);
        }}
        onDone={onProcessDone}
      />
    </AgentPageShell>
  );
}

export default AgentFeedbackPage;
