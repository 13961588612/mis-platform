/**
 * skill-admin.ts — Skill 管理服务（T10，从 agent/frontend SkillManagePage + types/skill.ts 迁移）。
 *
 * <p>后端端点（ai-platform skill.py）：
 * - GET    /api/v1/skills            — 技能列表（分页 + category/status 过滤）
 * - GET    /api/v1/skills/stats      — 技能统计
 * - POST   /api/v1/skills/{id}/enable   — 启用（写操作）
 * - POST   /api/v1/skills/{id}/disable  — 停用（写操作）
 * - DELETE /api/v1/skills/{id}       — 删除（写操作）
 *
 * <p>写操作（启停/删除）经 bff-actions → BFF REST，由 ApiPermissionInterceptor 校验
 * `agent:skill:manage`（03-permission-design.md §3.2「写操作不绕过 BFF」）；
 * 403 结构化错误由 PermissionErrorBanner 内联常驻。
 */

import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';
import { callBffAction } from '@/components/a2ui/bff-actions';
import type { A2uiActionApiBinding, BffActionResult } from '@/lib/a2ui/types';

// ============================================================================
// 类型（对齐后端 src/skills/models.py，snake_case → camelCase）
// ============================================================================

/** 技能来源。 */
export type SkillSource = 'custom' | 'mcp' | 'builtin';

/** 技能生命周期状态。 */
export type SkillStatus = 'active' | 'inactive' | 'deprecated';

/** 顶级技能分类（对齐业务系统）。 */
export type SkillCategory =
  | 'finance'
  | 'retail'
  | 'department_store'
  | 'hr'
  | 'property'
  | 'crm'
  | 'valuecard'
  | 'built_in';

/** 单个技能参数定义（JSON-Schema 风格）。 */
export interface SkillParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default: unknown;
  enum: unknown[] | null;
}

/** 技能。 */
export interface Skill {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  parameters: Record<string, unknown>;
  requiredPermissions: string[];
  handler: string;
  timeout: number;
  version: string;
  status: SkillStatus;
  source: SkillSource;
  priority: number;
  requiresApproval: boolean;
  mcpServer: string | null;
  callCount: number;
  lastCalledAt: string | null;
}

/** 分页技能列表响应。 */
export interface SkillListResponse {
  items: Skill[];
  total: number;
  page: number;
  pageSize: number;
}

/** 技能统计。 */
export interface SkillStats {
  total: number;
  active: number;
  inactive: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
}

/** 技能分类中文标签。 */
export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  finance: '财务',
  retail: '零售',
  department_store: '百货',
  hr: '人力',
  property: '物业',
  crm: '客户关系',
  valuecard: '预付卡',
  built_in: '内置',
};

/** 技能状态中文标签。 */
export const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  active: '启用',
  inactive: '停用',
  deprecated: '已废弃',
};

// ============================================================================
// 数据映射
// ============================================================================

function toSkill(item: Record<string, unknown>): Skill {
  return {
    skillId: (item.skill_id as string) ?? (item.skillId as string) ?? '',
    name: (item.name as string) ?? '',
    description: (item.description as string) ?? '',
    category: (item.category as SkillCategory) ?? 'built_in',
    tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
    parameters:
      (item.parameters as Record<string, unknown>) ?? (item.params as Record<string, unknown>) ?? {},
    requiredPermissions: Array.isArray(item.required_permissions)
      ? (item.required_permissions as string[])
      : Array.isArray(item.requiredPermissions)
        ? (item.requiredPermissions as string[])
        : [],
    handler: (item.handler as string) ?? '',
    timeout: (item.timeout as number) ?? 60,
    version: (item.version as string) ?? '',
    status: (item.status as SkillStatus) ?? 'inactive',
    source: (item.source as SkillSource) ?? 'custom',
    priority: (item.priority as number) ?? 0,
    requiresApproval: Boolean(item.requires_approval ?? item.requiresApproval ?? false),
    mcpServer:
      (item.mcp_server as string | null) ?? (item.mcpServer as string | null) ?? null,
    callCount: (item.call_count as number) ?? (item.callCount as number) ?? 0,
    lastCalledAt:
      (item.last_called_at as string | null) ??
      (item.lastCalledAt as string | null) ??
      null,
  };
}

// ============================================================================
// API
// ============================================================================

export interface SkillListQuery {
  page?: number;
  pageSize?: number;
  category?: SkillCategory | '';
  status?: SkillStatus | '';
}

/** 获取技能列表（分页 + 过滤）。 */
export async function listSkills(query: SkillListQuery = {}): Promise<SkillListResponse> {
  const params = new URLSearchParams();
  params.set('page', String(query.page ?? 1));
  params.set('page_size', String(query.pageSize ?? 20));
  if (query.category) params.set('category', query.category);
  if (query.status) params.set('status', query.status);
  const res = await api.get<ApiResult<Record<string, unknown>>>(`/skills?${params.toString()}`);
  if (res.data.code !== 0) {
    throw new Error(res.data.message || '获取 Skill 列表失败');
  }
  const data = res.data.data ?? {};
  const items = Array.isArray(data.items)
    ? data.items.map((row) => toSkill((row ?? {}) as Record<string, unknown>))
    : Array.isArray(data)
      ? (data as unknown as Record<string, unknown>[]).map((row) => toSkill(row))
      : [];
  return {
    items,
    total: (data.total as number) ?? items.length,
    page: (data.page as number) ?? (query.page ?? 1),
    pageSize: (data.page_size as number) ?? (data.pageSize as number) ?? (query.pageSize ?? 20),
  };
}

/** 获取技能统计（失败返回全零，不阻塞 UI）。 */
export async function fetchSkillStats(): Promise<SkillStats> {
  try {
    const res = await api.get<ApiResult<Record<string, unknown>>>(`/skills/stats`);
    const data = res.data.data ?? {};
    const byCategory =
      (data.by_category as Record<string, number>) ?? (data.byCategory as Record<string, number>) ?? {};
    const bySource =
      (data.by_source as Record<string, number>) ?? (data.bySource as Record<string, number>) ?? {};
    return {
      total: (data.total as number) ?? 0,
      active: (data.active as number) ?? 0,
      inactive: (data.inactive as number) ?? 0,
      byCategory,
      bySource,
    };
  } catch {
    return { total: 0, active: 0, inactive: 0, byCategory: {}, bySource: {} };
  }
}

/** 启停/删除的 BFF 绑定（写操作经 bff-actions 校验 agent:skill:manage）。 */
export function skillWriteBinding(
  method: 'POST' | 'DELETE',
  path: string,
): A2uiActionApiBinding {
  return {
    method,
    path,
    permissionCode: 'agent:skill:manage',
  };
}

/** 启用技能（写操作）。 */
export async function enableSkill(skillId: string): Promise<BffActionResult<unknown>> {
  return callBffAction(
    skillWriteBinding('POST', `/api/v1/skills/${encodeURIComponent(skillId)}/enable`),
    {},
  );
}

/** 停用技能（写操作）。 */
export async function disableSkill(skillId: string): Promise<BffActionResult<unknown>> {
  return callBffAction(
    skillWriteBinding('POST', `/api/v1/skills/${encodeURIComponent(skillId)}/disable`),
    {},
  );
}

/** 删除技能（写操作）。 */
export async function deleteSkill(skillId: string): Promise<BffActionResult<unknown>> {
  return callBffAction(
    skillWriteBinding('DELETE', `/api/v1/skills/${encodeURIComponent(skillId)}`),
    {},
  );
}
