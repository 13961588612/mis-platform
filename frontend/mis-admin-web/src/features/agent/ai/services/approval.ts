/**
 * approval.ts — 审批中心服务（T10，从 旧版独立前端 ApprovalCenterPage + approvalStore 迁移）。
 *
 * <p>后端端点（ai-platform push.py）：
 * - GET  /api/v1/push/approvals           — 审批列表（可选 status 过滤）
 * - GET  /api/v1/push/approvals/stats      — 审批统计
 * - POST /api/v1/push/approvals/{id}/respond — 审批决策（写操作）
 *
 * <p>写操作（respond）**必须走 bff-actions**（02 文档 §3.2「写操作不绕过 BFF」）：
 * actionApiMap 绑定 → BFF REST 调用，由 ApiPermissionInterceptor 校验
 * `approval:decide`；403 结构化错误由 PermissionErrorBanner 内联常驻。
 */

import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';
import { callBffAction } from '@/components/a2ui/bff-actions';
import type { A2uiActionApiBinding, BffActionResult } from '@/lib/a2ui/types';

// ============================================================================
// 类型（后端 snake_case → 前端 camelCase，口径见 02 文档 §4）
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

// ============================================================================
// API
// ============================================================================

/** 获取审批列表（可选状态过滤；后端返回数组）。 */
export async function listApprovals(status?: ApprovalStatus): Promise<ApprovalRecord[]> {
  const query = status ? `?status=${status}` : '';
  const res = await api.get<ApiResult<unknown[]>>(`/push/approvals${query}`);
  if (res.data.code !== 0) {
    throw new Error(res.data.message || '获取审批列表失败');
  }
  const rows = res.data.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => toApprovalRecord((row ?? {}) as Record<string, unknown>));
}

/** 获取审批统计（失败返回全零，不阻塞 UI）。 */
export async function fetchApprovalStats(): Promise<ApprovalStats> {
  try {
    const res = await api.get<ApiResult<Record<string, number>>>(`/push/approvals/stats`);
    const data = res.data.data ?? {};
    return {
      total: data.total ?? 0,
      pending: data.pending ?? 0,
      approved: data.approved ?? 0,
      rejected: data.rejected ?? 0,
      timeout: data.timeout ?? 0,
    };
  } catch {
    return { total: 0, pending: 0, approved: 0, rejected: 0, timeout: 0 };
  }
}

/**
 * 审批决策绑定（bff-actions 消费）：BFF 写操作端点 + 权限码。
 * 每次按审批 id 构造（路径含动态 id）。
 */
export function respondApprovalBinding(approvalId: string): A2uiActionApiBinding {
  return {
    method: 'POST',
    path: `/api/v1/push/approvals/${encodeURIComponent(approvalId)}/respond`,
    permissionCode: 'approval:decide',
  };
}

/**
 * 提交审批决策（写操作 → bff-actions → BFF，403 结构化错误）。
 *
 * @param approvalId - 审批 ID
 * @param decision - approved / rejected
 * @param comment - 可选备注
 */
export async function respondApproval(
  approvalId: string,
  decision: 'approved' | 'rejected',
  comment = '',
): Promise<BffActionResult<unknown>> {
  return callBffAction(respondApprovalBinding(approvalId), {
    decision,
    comment,
  });
}
