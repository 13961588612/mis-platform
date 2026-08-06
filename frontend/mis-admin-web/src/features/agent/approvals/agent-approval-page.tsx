/**
 * 审批中心页（路径 `/agent/approvals`，V19 菜单 `92042`，权限 `agent:approval:list`）。
 *
 * <p>覆盖 §4.3 #57 `listApprovals()` / #58 `decideApproval()`（操作码 `agent:approval:handle`）。
 *
 * <p>**就绪度：P2、上游能力不明**。ai-platform 侧的 HITL（human-in-the-loop）中断点
 * 目前没有确定形态 —— 是"工具调用前挂起等审批"还是"事后补审"尚未拍板（impl-plan §11）。
 * 因此本页按**普通审批列表**实现（列表 + 通过 / 驳回 + 501 容错），
 * 刻意**不投入**深度交互（如挂起会话的实时接管、审批超时自动放行、
 * 审批意见模板等）—— 在上游语义确定前做这些，八成要推倒重来。
 *
 * <p>形态一旦明确，需要补的大概率是：
 *   ① `detail` 的结构化渲染（当前按纯文本展示）；
 *   ② 决策附言（`ApprovalDecisionPayload.comment` 已在类型里预留，当前不传）；
 *   ③ 与会话页的双向跳转（`session_id` 已在列里展示，尚未做深链）。
 *
 * <p>**默认只看待审批**：审批中心的第一诉求是"有没有事等我处理"，
 * 默认拉全量会让待办淹没在历史记录里。故 `status` 初值为 `pending`。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Clock, RefreshCw, XCircle } from 'lucide-react';
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
import { decideApproval, listApprovals } from '../api/agent-ops-api';
import { agentErrorMessage, approvalDetailText, formatTime } from '../types';
import type { Approval, ApprovalStatus } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const APPROVAL_COLS: ResizableColumn[] = [
  { key: 'createdAt', label: '申请时间' },
  { key: '__title__', label: '操作类型' },
  { key: 'agentId', label: 'Agent' },
  { key: 'sessionId', label: '会话' },
  { key: 'status', label: '状态' },
  { key: 'userId', label: '处理人' },
  { key: '__detail__', label: '内容摘要' },
  { key: '__ops__', label: '操作', locked: true },
];

/** 待确认的审批决策。 */
interface PendingDecision {
  approved: boolean;
  approval: Approval;
}

export function AgentApprovalsPage() {
  const [rows, setRows] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 服务端筛选（#57 支持 status 入参）；默认只看待审批。 */
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'all'>('pending');
  /** 客户端关键字筛选：#57 未提供 keyword 入参，故只在已加载数据内过滤。 */
  const [keyword, setKeyword] = useState('');

  const [pending, setPending] = useState<PendingDecision | null>(null);
  /** 正在提交决策的审批 id，用于禁用该行按钮防重复提交。 */
  const [busy, setBusy] = useState<string | null>(null);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    APPROVAL_COLS,
    'mis-agent-approval-table-widths',
  );

  const load = useCallback(async (status: ApprovalStatus | 'all') => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listApprovals(status === 'all' ? undefined : status));
    } catch (e) {
      setRows([]);
      setError(agentErrorMessage(e, '获取审批列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(statusFilter);
  }, [load, statusFilter]);

  /** #58 提交决策：成功关弹窗 + 刷新；失败保持打开让用户看清 toast。 */
  async function runDecision(): Promise<void> {
    if (!pending) return;
    const { approved, approval } = pending;
    setBusy(approval.approvalId);
    try {
      await decideApproval(approval.approvalId, { approved });
      toast.success(approved ? '已通过该审批' : '已驳回该审批');
      setPending(null);
      await load(statusFilter);
    } catch (e) {
      toast.error(agentErrorMessage(e, '提交审批决策失败'));
    } finally {
      setBusy(null);
    }
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(
      (r) =>
        (r.agentId ?? '').toLowerCase().includes(kw) ||
        (r.sessionId ?? '').toLowerCase().includes(kw) ||
        (r.userId ?? '').toLowerCase().includes(kw) ||
        approvalDetailText(r.detail, 'title').toLowerCase().includes(kw) ||
        approvalDetailText(r.detail, 'description').toLowerCase().includes(kw),
    );
  }, [rows, keyword]);

  const getSortValue = useCallback(
    (row: Approval, key: string) => row[key as keyof Approval] as unknown,
    [],
  );
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(filtered, getSortValue);

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'pending').length, [rows]);
  const approvedCount = useMemo(() => rows.filter((r) => r.status === 'approved').length, [rows]);
  const rejectedCount = useMemo(() => rows.filter((r) => r.status === 'rejected').length, [rows]);

  const headerActions = (
    <Button
      size="sm"
      variant="outline"
      onClick={() => void load(statusFilter)}
      disabled={loading}
    >
      <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
      刷新
    </Button>
  );

  return (
    <AgentPageShell
      title="审批中心"
      description="需要人工确认的高风险操作。"
      permission="agent:approval:list"
      actions={headerActions}
      /* 刻意不传 error：筛选区在 #57 未就绪时仍需可用，表格区自带三态 */
      loading={loading && rows.length === 0 && error === null}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="待审批" value={pendingCount} icon={Clock} />
          <StatCard label="已通过" value={approvedCount} icon={CheckCircle2} />
          <StatCard label="已驳回" value={rejectedCount} icon={XCircle} />
        </div>

        {/* ---------------- 筛选区：永远可用，包括 error 态 ---------------- */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">状态</label>
            <select
              className={selectClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ApprovalStatus | 'all')}
            >
              <option value="pending">待审批</option>
              <option value="approved">已通过</option>
              <option value="rejected">已驳回</option>
              <option value="all">全部</option>
            </select>
          </div>
          <div className="min-w-[14rem] flex-1">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
            <Input
              placeholder="搜索操作 / Agent / 会话 / 摘要（仅过滤已加载数据）"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setKeyword('');
              setStatusFilter('pending');
            }}
          >
            重置
          </Button>
          <span className="ml-auto pb-1.5 text-xs text-muted-foreground">
            共 {filtered.length} / {rows.length} 条
          </span>
        </div>

        {/* ---------------- 表格区：独立三态（#57 未就绪时只有这里变红） ---------------- */}
        <div className="flex min-h-0 flex-1 flex-col">
          <AgentContentState
            loading={loading && rows.length === 0}
            error={error}
            onRetry={() => void load(statusFilter)}
            empty={!loading && !error && rows.length === 0}
            emptyText={statusFilter === 'pending' ? '当前没有待审批事项' : '没有匹配的审批记录'}
            emptyHint="高风险操作触发人工确认时会出现在这里。"
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
                    {APPROVAL_COLS.map((c, ci) => {
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
                        colSpan={APPROVAL_COLS.length}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        没有匹配当前筛选条件的审批
                      </td>
                    </tr>
                  ) : (
                    sorted.map((approval) => {
                      const rowBusy = busy === approval.approvalId;
                      const decidable = approval.status === 'pending';
                      return (
                        <tr
                          key={approval.approvalId}
                          className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                        >
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                            {formatTime(approval.createdAt)}
                          </td>
                          <td
                            className="truncate px-3 py-2 font-medium"
                            title={approvalDetailText(approval.detail, 'title')}
                          >
                            {approvalDetailText(approval.detail, 'title')}
                          </td>
                          <td
                            className="truncate px-3 py-2 text-xs"
                            title={approval.agentId ?? ''}
                          >
                            {approval.agentId || '-'}
                          </td>
                          <td
                            className="truncate px-3 py-2 font-mono text-xs text-muted-foreground"
                            title={approval.sessionId ?? ''}
                          >
                            {approval.sessionId || '-'}
                          </td>
                          <td className="px-3 py-2">
                            <AgentStatusBadge kind="approval" value={approval.status} />
                          </td>
                          <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                            {approval.userId ? (
                              <>
                                {approval.userId}
                                <span className="ml-1">{formatTime(approval.resolvedAt)}</span>
                              </>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td
                            className="truncate px-3 py-2 text-xs text-muted-foreground"
                            title={approvalDetailText(approval.detail, 'description')}
                          >
                            {approvalDetailText(approval.detail, 'description')}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              {decidable ? (
                                <PermissionGate permission="agent:approval:handle">
                                  <button
                                    type="button"
                                    disabled={rowBusy}
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-success hover:bg-success/10 disabled:opacity-50"
                                    onClick={() => setPending({ approved: true, approval })}
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                    通过
                                  </button>
                                  <button
                                    type="button"
                                    disabled={rowBusy}
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                    onClick={() => setPending({ approved: false, approval })}
                                  >
                                    <XCircle className="h-3 w-3" />
                                    驳回
                                  </button>
                                </PermissionGate>
                              ) : (
                                <span className="text-xs text-muted-foreground">已处理</span>
                              )}
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

        <p className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
          <ClipboardCheck className="h-3.5 w-3.5" />
          审批（HITL）能力的上游形态待定：当前按普通列表实现，决策附言与会话深链待上游语义明确后补齐。
        </p>
      </div>

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        danger={pending?.approved === false}
        title={pending?.approved ? '确认通过该审批' : '确认驳回该审批'}
        confirmText={pending?.approved ? '通过' : '驳回'}
        description={
          pending ? (
            <>
              <p>
                操作：「{approvalDetailText(pending.approval.detail, 'title')}」
                {pending.approval.agentId ? (
                  <>
                    ，来自 Agent <span className="font-mono">{pending.approval.agentId}</span>
                  </>
                ) : null}
                。
              </p>
              {approvalDetailText(pending.approval.detail, 'description') !== '-' ? (
                <p className="break-words">
                  内容摘要：{approvalDetailText(pending.approval.detail, 'description')}
                </p>
              ) : null}
              <p>
                {pending.approved
                  ? '通过后该操作将被放行执行，执行结果不再经过人工确认。'
                  : '驳回后该操作不会执行，发起方会收到拒绝结果。'}
              </p>
            </>
          ) : null
        }
        onConfirm={runDecision}
      />
    </AgentPageShell>
  );
}
