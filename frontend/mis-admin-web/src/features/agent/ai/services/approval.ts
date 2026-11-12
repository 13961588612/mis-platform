/**
 * approval.ts — 审批中心服务（T10，从 旧版独立前端 ApprovalCenterPage + approvalStore 迁移）。
 *
 * <p>经 BFF 已登记端点（deny-unmapped fail-closed；勿直打 `/api/v1/push/approvals*`）：
 * - GET  /api/v1/agent-ops/approvals
 * - POST /api/v1/agent-ops/approvals/{id}/decision
 *
 * <p>写操作经 bff-actions → BFF，校验 `agent:approval:handle`。
 * 统计无独立 BFF 登记端点，由列表结果客户端汇总。
 */

import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';
import { callBffAction } from '@/components/a2ui/bff-actions';
import type { A2uiActionApiBinding, BffActionResult } from '@/lib/a2ui/types';

// ============================================================================
// 类型（后端 camelCase wire / snake_case 兼容）
// ============================================================================

/** 审批状态生命周期。 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout' | 'expired';

/** 审批详情（技能触发审批时的结构化描述）。 */
export interface ApprovalDetail {
  title?: string;
  description?: string;
  skillId?: string;
  approvalId?: string;
  [key: string]: unknown;
}

/** 单条审批记录。 */
export interface ApprovalRecord {
  approvalId: string;
  sessionId: string;
  agentId: string;
  skillId: string;
  detail: ApprovalDetail;
  userId: string;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt: string | null;
  comment: string | null;
  timeoutSeconds: number;
}

/** 审批统计。 */
export interface ApprovalStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  timeout: number;
}

// ============================================================================
// 数据映射
// ============================================================================

function toApprovalRecord(item: Record<string, unknown>): ApprovalRecord {
  const detail = (item.detail as ApprovalDetail) ?? {};
  return {
    approvalId: (item.approval_id as string) ?? (item.approvalId as string) ?? '',
    sessionId: (item.session_id as string) ?? (item.sessionId as string) ?? '',
    agentId: (item.agent_id as string) ?? (item.agentId as string) ?? '',
    skillId: (item.skill_id as string) ?? (item.skillId as string) ?? '',
    detail,
    userId: (item.user_id as string) ?? (item.userId as string) ?? '',
    status: (item.status as ApprovalStatus) ?? 'pending',
    createdAt: (item.created_at as string) ?? (item.createdAt as string) ?? '',
    resolvedAt:
      (item.resolved_at as string | null) ?? (item.resolvedAt as string | null) ?? null,
    comment: (item.comment as string | null) ?? null,
    timeoutSeconds: (item.timeout_seconds as number) ?? 300,
  };
}

function summarizeStats(rows: ApprovalRecord[]): ApprovalStats {
  const stats: ApprovalStats = {
    total: rows.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    timeout: 0,
  };
  for (const row of rows) {
    if (row.status === 'pending') stats.pending += 1;
    else if (row.status === 'approved') stats.approved += 1;
    else if (row.status === 'rejected') stats.rejected += 1;
    else if (row.status === 'timeout' || row.status === 'expired') stats.timeout += 1;
  }
  return stats;
}

// ============================================================================
// API
// ============================================================================

/** 获取审批列表（可选状态过滤；后端返回数组）。 */
export async function listApprovals(status?: ApprovalStatus): Promise<ApprovalRecord[]> {
  const res = await api.get<ApiResult<unknown>>('/agent-ops/approvals', {
    params: status ? { status } : undefined,
  });
  if (res.data.code !== 0) {
    throw new Error(res.data.message || '获取审批列表失败');
  }
  const data = res.data.data;
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
      ? ((data as { items: unknown[] }).items)
      : [];
  return rows.map((row) => toApprovalRecord((row ?? {}) as Record<string, unknown>));
}

/**
 * 获取审批统计。
 *
 * <p>BFF 未登记 `/push/approvals/stats`（deny-unmapped 会 40300），改为拉全量列表后汇总。
 */
export async function fetchApprovalStats(): Promise<ApprovalStats> {
  try {
    const rows = await listApprovals();
    return summarizeStats(rows);
  } catch {
    return { total: 0, pending: 0, approved: 0, rejected: 0, timeout: 0 };
  }
}

/**
 * 审批决策绑定（bff-actions）：挂已登记的 agent-ops decision 端点。
 */
export function respondApprovalBinding(approvalId: string): A2uiActionApiBinding {
  return {
    method: 'POST',
    path: `/api/v1/agent-ops/approvals/${encodeURIComponent(approvalId)}/decision`,
    permissionCode: 'agent:approval:handle',
  };
}

/**
 * 提交审批决策（写操作 → bff-actions → BFF）。
 *
 * <p>BFF 契约为 `{approved, comment}`，再转下游 `{decision, comment}`。
 */
export async function respondApproval(
  approvalId: string,
  decision: 'approved' | 'rejected',
  comment = '',
): Promise<BffActionResult<unknown>> {
  return callBffAction(respondApprovalBinding(approvalId), {
    approved: decision === 'approved',
    comment,
  });
}
