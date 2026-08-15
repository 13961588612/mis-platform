/**
 * 智能体运营控制台的状态徽章。
 *
 * <p>把 `AgentState` / `AgentRole` / `SkillStatus` / MCP 连接态 / 审批状态这些枚举
 * 统一映射到 `Badge` 的 variant 与中文文案，避免每个页面各写一套 switch
 * 导致同一状态在不同页面颜色不一致（运营看颜色判断，颜色不一致比没颜色更糟）。
 *
 * <p>枚举取值来源见 `../types.ts`；新增枚举值必须同步补映射表，
 * 否则会走到 `fallback` 显示原始英文串（不报错，但很难看）。
 */
import { Badge } from '@/components/ui/badge';
import type { BadgeProps } from '@/components/ui/badge';
import type {
  AgentRole,
  AgentState,
  ApprovalStatus,
  DispatchTraceStatus,
  SkillStatus,
  WecomBot,
} from '../types';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

interface BadgeSpec {
  label: string;
  variant: BadgeVariant;
}

const AGENT_STATE_MAP: Record<AgentState, BadgeSpec> = {
  running: { label: '运行中', variant: 'success' },
  paused: { label: '已暂停', variant: 'warning' },
  stopped: { label: '已停止', variant: 'secondary' },
  error: { label: '异常', variant: 'destructive' },
};

const AGENT_ROLE_MAP: Record<AgentRole, BadgeSpec> = {
  coordinator: { label: '协调者', variant: 'info' },
  worker: { label: '执行者', variant: 'outline' },
};

const SKILL_STATUS_MAP: Record<SkillStatus, BadgeSpec> = {
  active: { label: '已启用', variant: 'success' },
  disabled: { label: '已停用', variant: 'secondary' },
};

/**
 * 技能执行形态：可执行（有 handler）/ 文档型（无 handler，仅检索与上下文注入）。
 *
 * <p>取值由前端按 `handler` 是否为空推导（`executable` / `document`），
 * 不直接来自 wire（wire 仅给出 handler 字符串）。
 */
const SKILL_KIND_MAP: Record<string, BadgeSpec> = {
  executable: { label: '可执行', variant: 'success' },
  document: { label: '文档型', variant: 'secondary' },
};

/**
 * 审批状态文案表。
 *
 * <p>必须覆盖 `ApprovalStatus` 的**全部 5 档** —— 后端
 * `src/hitl/store.py#ApprovalStatus` 除了 pending/approved/rejected，
 * 还有超时清理任务写入的 `timeout` 与 `expired`。少一档就是
 * `APPROVAL_STATUS_MAP[status].label` 读 `undefined.label` 白屏。
 */
const APPROVAL_STATUS_MAP: Record<ApprovalStatus, BadgeSpec> = {
  pending: { label: '待审批', variant: 'warning' },
  approved: { label: '已通过', variant: 'success' },
  rejected: { label: '已驳回', variant: 'destructive' },
  timeout: { label: '已超时', variant: 'secondary' },
  expired: { label: '已失效', variant: 'secondary' },
};

/**
 * 企微 Bot 健康态（UI#3）。
 *
 * <p>取值与 MCP 探测结果相似但**刻意分表**：Bot 没有 `error` 态（WS 断开就是
 * `disconnected`），共用一张表会让「某处新增了一个态」悄悄污染 Bot 页的文案。
 */
const WECOM_HEALTH_MAP: Record<WecomBot['health'], BadgeSpec> = {
  connected: { label: '在线', variant: 'success' },
  disconnected: { label: '离线', variant: 'secondary' },
  unknown: { label: '未知', variant: 'outline' },
};

/** 委派轨迹执行结果（调度观测页；未登记的状态由 fallback 原样显示）。 */
const DISPATCH_STATUS_MAP: Record<DispatchTraceStatus, BadgeSpec> = {
  completed: { label: '成功', variant: 'success' },
  rejected: { label: '已拒绝', variant: 'warning' },
  failed: { label: '失败', variant: 'destructive' },
  killed: { label: '已终止', variant: 'destructive' },
  timeout: { label: '超时', variant: 'warning' },
  running: { label: '执行中', variant: 'info' },
};

/** 调度观测：自动路由 vs 协调委派 vs 指定路由。 */
const DISPATCH_KIND_MAP: Record<string, BadgeSpec> = {
  agent_router: { label: '自动路由', variant: 'outline' },
  coordinator: { label: '协调委派', variant: 'info' },
  specified: { label: '指定路由', variant: 'secondary' },
};

/** 徽章类别；决定用哪张映射表。 */
export type AgentBadgeKind =
  | 'agentState'
  | 'agentRole'
  | 'skillStatus'
  | 'skillKind'
  | 'approval'
  | 'wecomHealth'
  | 'dispatchStatus'
  | 'dispatchKind';

const MAPS: Record<AgentBadgeKind, Record<string, BadgeSpec>> = {
  agentState: AGENT_STATE_MAP,
  agentRole: AGENT_ROLE_MAP,
  skillStatus: SKILL_STATUS_MAP,
  skillKind: SKILL_KIND_MAP,
  approval: APPROVAL_STATUS_MAP,
  wecomHealth: WECOM_HEALTH_MAP,
  dispatchStatus: DISPATCH_STATUS_MAP,
  dispatchKind: DISPATCH_KIND_MAP,
};

export interface AgentStatusBadgeProps {
  kind: AgentBadgeKind;
  /** 枚举原始值；未登记的值原样显示为 outline 徽章。 */
  value: string;
  className?: string;
}

export function AgentStatusBadge({ kind, value, className }: AgentStatusBadgeProps) {
  const spec: BadgeSpec = MAPS[kind][value] ?? { label: value, variant: 'outline' };
  return (
    <Badge variant={spec.variant} className={className}>
      {spec.label}
    </Badge>
  );
}
