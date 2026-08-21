/**
 * approval-center-page.tsx — 审批中心页（T10，从 agent/frontend ApprovalCenterPage 迁移）。
 *
 * <p>功能等价迁移（push.py 后端端点）+ 消费 A2UI `approval-card`：
 * - 统计卡（总/待/已同意/已拒绝/已超时）
 * - 列表 + 状态筛选 + 行内审批（写操作经 bff-actions → BFF，403 内联 PermissionErrorBanner）
 * - 详情弹窗消费 `approval-card`（嵌套 A2uiProvider 自定义 executeBffAction 路由到
 *   `/api/v1/push/approvals/{id}/respond`，与迁移端点一致）
 *
 * <p>UI 规范：表格吸顶单层滚动、圆角 4px、表头 13px、无内层 padding。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Clock, CheckCircle2, RefreshCw, XCircle, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { StatCard } from '@/components/common/stat-card';
import { PermissionErrorBanner } from '@/components/a2ui/PermissionErrorBanner';
import { A2uiProvider } from '@/components/a2ui/A2uiProvider';
import { ApprovalCard } from '@/components/a2ui/components/ApprovalCard';
import { A2UI_ERROR_CODES, type A2uiClientAction, type BffActionError, type BffActionResult } from '@/lib/a2ui/types';
import {
  fetchApprovalStats,
  listApprovals,
  respondApproval,
  type ApprovalRecord,
  type ApprovalStatus,
} from './services/approval';

const selectClass =
  'h-9 w-full rounded border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

/** 状态中文标签。 */
const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: '待审批',
  approved: '已同意',
  rejected: '已拒绝',
  timeout: '已超时',
  expired: '已过期',
};

/** 状态徽标变体。 */
function statusVariant(status: ApprovalStatus): 'warning' | 'success' | 'destructive' | 'secondary' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'destructive';
    default:
      return 'secondary';
  }
}

/** 相对时间（秒 → 中文）。 */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/** 详情字段（approval-card fields 消费）。 */
function toCardFields(record: ApprovalRecord): Array<{ label: string; value: unknown }> {
  const fields: Array<{ label: string; value: unknown }> = [];
  const detail = record.detail ?? {};
  if (detail.description) fields.push({ label: '说明', value: detail.description });
  if (record.skillId) fields.push({ label: 'Skill', value: record.skillId });
  if (record.agentId) fields.push({ label: 'Agent', value: record.agentId });
  if (record.sessionId) fields.push({ label: '会话', value: record.sessionId });
  fields.push({ label: '发起人', value: record.userId || '—' });
  fields.push({ label: '超时', value: `${record.timeoutSeconds ?? 300}s` });
  return fields;
}

export function ApprovalCenterPage() {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0, timeout: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bffError, setBffError] = useState<BffActionError | null>(null);
  const [filterStatus, setFilterStatus] = useState<'' | ApprovalStatus>('');
  const [comment, setComment] = useState<Record<string, string>>({});
  const [responding, setResponding] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApprovalRecord | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await listApprovals(filterStatus === '' ? undefined : filterStatus);
      setApprovals(rows);
    } catch (err) {
      setApprovals([]);
      setError(err instanceof Error ? err.message : '获取审批列表失败');
    } finally {
      setIsLoading(false);
    }
  }, [filterStatus]);

  const loadStats = useCallback(async (): Promise<void> => {
    setStats(await fetchApprovalStats());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const displayApprovals = useMemo(() => approvals, [approvals]);

  /** 行内审批（写操作 → bff-actions，403 内联展示）。 */
  const handleRespond = useCallback(
    async (approvalId: string, decision: 'approved' | 'rejected'): Promise<void> => {
      setResponding(approvalId);
      setBffError(null);
      const result = await respondApproval(approvalId, decision, comment[approvalId] ?? '');
      setResponding(null);
      if (result.ok) {
        setComment((prev) => {
          const next = { ...prev };
          delete next[approvalId];
          return next;
        });
        await load();
        await loadStats();
        if (detail?.approvalId === approvalId) setDetail(null);
      } else {
        setBffError(result.error ?? null);
      }
    },
    [comment, detail?.approvalId, load, loadStats],
  );

  /** 详情弹窗内 approval-card 的写操作执行器：路由到迁移端点 /respond。 */
  const detailExecuteBffAction = useCallback(
    async (
      componentName: string,
      action: string,
      payload: Record<string, unknown>,
    ): Promise<BffActionResult<unknown>> => {
      if (componentName === 'approval-card' && detail) {
        const decision = action === 'approve' ? 'approved' : 'rejected';
        const result = await respondApproval(
          detail.approvalId,
          decision,
          String(payload?.comment ?? ''),
        );
        if (result.ok) {
          await load();
          await loadStats();
          setDetail((prev) => (prev ? { ...prev, status: decision, resolvedAt: new Date().toISOString() } : prev));
          return { ok: true, data: result.data };
        }
        return { ok: false, error: result.error };
      }
      return {
        ok: false,
        error: {
          code: A2UI_ERROR_CODES.POLICY_UNMAPPED,
          message: `组件 ${componentName} 的操作 ${action} 未映射`,
          missingPermissions: [],
          permissionDenied: true,
        },
      };
    },
    [detail, load, loadStats],
  );

  const noopDispatch = useCallback((_action: A2uiClientAction) => undefined, []);

  const headerActions = (
    <Button size="sm" variant="outline" onClick={() => void load()} disabled={isLoading}>
      <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
      刷新
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="审批中心"
        description="需要人工确认的高风险操作（HITL 审批）。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '审批中心' })}
        actions={headerActions}
      />

      {/* 统计卡 */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="总审批数" value={stats.total} icon={ClipboardCheck} />
        <StatCard label="待审批" value={stats.pending} icon={Clock} />
        <StatCard label="已同意" value={stats.approved} icon={CheckCircle2} />
        <StatCard label="已拒绝" value={stats.rejected} icon={XCircle} />
        <StatCard label="已超时" value={stats.timeout} icon={Timer} />
      </div>

      {/* 筛选区 */}
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded border bg-card p-3">
        <div className="w-40">
          <label className="mb-[0.4rem] block text-xs text-muted-foreground">状态</label>
          <select
            className={selectClass}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as '' | ApprovalStatus)}
          >
            <option value="">全部状态</option>
            <option value="pending">待审批</option>
            <option value="approved">已同意</option>
            <option value="rejected">已拒绝</option>
            <option value="timeout">已超时</option>
          </select>
        </div>
        <span className="pb-1.5 text-xs text-muted-foreground">共 {displayApprovals.length} 条</span>
      </div>

      {/* 权限错误内联条（写操作 403，常驻非 toast） */}
      <div className="mb-3">
        <PermissionErrorBanner error={bffError} />
      </div>

      {/* 错误条 */}
      {error ? (
        <div className="mb-3 flex items-center justify-between rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" className="text-xs text-red-600 hover:text-red-700" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      ) : null}

      {/* 审批列表：表格吸顶单层滚动 */}
      <div className="min-h-0 flex-1 overflow-auto rounded border bg-card">
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-table-header text-[13px] text-muted-foreground">
            <tr>
              {['审批 ID', '标题', 'Skill', '状态', '创建时间', '解决时间', '操作'].map((label, i) => (
                <th
                  key={label}
                  className={cn(
                    'whitespace-nowrap border-b border-border px-2.5 py-2 font-medium',
                    i > 0 && 'border-l border-border/60',
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && displayApprovals.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2.5 py-10 text-center text-sm text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : displayApprovals.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2.5 py-10 text-center text-sm text-muted-foreground">
                  暂无审批记录
                </td>
              </tr>
            ) : (
              displayApprovals.map((approval) => {
                const rowBusy = responding === approval.approvalId;
                const decidable = approval.status === 'pending';
                return (
                  <tr key={approval.approvalId} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap border-b border-border/40 px-2.5 py-2">
                      <button
                        type="button"
                        className="font-mono text-xs text-primary hover:underline"
                        onClick={() => setDetail(approval)}
                      >
                        {approval.approvalId.slice(0, 12)}…
                      </button>
                    </td>
                    <td className="max-w-[16rem] truncate px-2.5 py-2" title={approval.detail?.title ?? ''}>
                      {approval.detail?.title || '—'}
                    </td>
                    <td className="truncate px-2.5 py-2 text-xs text-muted-foreground">
                      {approval.skillId || '—'}
                    </td>
                    <td className="px-2.5 py-2">
                      <Badge variant={statusVariant(approval.status)}>{STATUS_LABELS[approval.status]}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-xs text-muted-foreground">
                      {formatRelativeTime(approval.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-xs text-muted-foreground">
                      {approval.resolvedAt ? new Date(approval.resolvedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-2.5 py-2">
                      {decidable ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={comment[approval.approvalId] ?? ''}
                            onChange={(e) =>
                              setComment((prev) => ({ ...prev, [approval.approvalId]: e.target.value }))
                            }
                            placeholder="备注（可选）"
                            className="h-7 w-28 rounded px-2 py-1 text-xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 rounded bg-emerald-600 px-2 text-xs hover:bg-emerald-700"
                            disabled={rowBusy}
                            onClick={() => void handleRespond(approval.approvalId, 'approved')}
                          >
                            同意
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 rounded px-2 text-xs text-destructive hover:bg-destructive/10"
                            disabled={rowBusy}
                            onClick={() => void handleRespond(approval.approvalId, 'rejected')}
                          >
                            驳回
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{approval.comment || '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 详情弹窗：消费 A2UI approval-card（写操作路由到 /respond） */}
      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-auto rounded bg-card p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">审批详情</h3>
              <button
                type="button"
                aria-label="关闭"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setDetail(null)}
              >
                ×
              </button>
            </div>
            <A2uiProvider dispatchAction={noopDispatch} executeBffAction={detailExecuteBffAction}>
              <ApprovalCard
                component="approval-card"
                props={{
                  approvalId: detail.approvalId,
                  title: detail.detail?.title || '操作审批请求',
                  description: detail.detail?.description || '',
                  fields: toCardFields(detail),
                }}
              />
            </A2uiProvider>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ApprovalCenterPage;
