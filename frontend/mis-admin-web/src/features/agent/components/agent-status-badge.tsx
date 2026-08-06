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
  McpConnectionState,
  SkillStatus,
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

const MCP_STATE_MAP: Record<McpConnectionState, BadgeSpec> = {
  connected: { label: '已连接', variant: 'success' },
  disconnected: { label: '未连接', variant: 'secondary' },
  error: { label: '连接失败', variant: 'destructive' },
  unknown: { label: '未知', variant: 'outline' },
};

const APPROVAL_STATUS_MAP: Record<ApprovalStatus, BadgeSpec> = {
  pending: { label: '待审批', variant: 'warning' },
  approved: { label: '已通过', variant: 'success' },
  rejected: { label: '已驳回', variant: 'destructive' },
};

/** 徽章类别；决定用哪张映射表。 */
export type AgentBadgeKind = 'agentState' | 'agentRole' | 'skillStatus' | 'mcpState' | 'approval';

const MAPS: Record<AgentBadgeKind, Record<string, BadgeSpec>> = {
  agentState: AGENT_STATE_MAP,
  agentRole: AGENT_ROLE_MAP,
  skillStatus: SKILL_STATUS_MAP,
  mcpState: MCP_STATE_MAP,
  approval: APPROVAL_STATUS_MAP,
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
