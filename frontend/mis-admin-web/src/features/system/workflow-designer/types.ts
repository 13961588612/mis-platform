/**
 * 流程设计器类型与常量（P7）。
 */
import type { Node, Edge } from '@xyflow/react';

export type WfNodeKind =
  | 'START'
  | 'APPROVAL'
  | 'CONDITIONAL'
  | 'ROUTING'
  | 'AUTOMATION'
  | 'END';

export const WF_NODE_TYPES: Record<string, string> = {
  START: 'wfStart',
  APPROVAL: 'wfApproval',
  CONDITIONAL: 'wfConditional',
  ROUTING: 'wfRouting',
  AUTOMATION: 'wfAutomation',
  END: 'wfEnd',
};

export const NODE_LABELS: Record<WfNodeKind, string> = {
  START: '开始',
  APPROVAL: '审批',
  CONDITIONAL: '条件分支',
  ROUTING: '会签/路由',
  AUTOMATION: '自动化',
  END: '结束',
};

export interface WfNodeData extends Record<string, unknown> {
  kind: WfNodeKind;
  nodeCode: string;
  nodeName: string;
  assigneeRule: string;
  conditionExpr?: string;
  timeoutHours?: number | null;
  /** ROUTING 节点会签策略：ALL_PASS(会签) / ANY_PASS(或签)。 */
  routingStrategy?: 'ALL_PASS' | 'ANY_PASS';
}

export type WfFlowNode = Node<WfNodeData>;

export interface WfFlowEdgeData extends Record<string, unknown> {
  label?: string;
}

export type WfFlowEdge = Edge<WfFlowEdgeData>;

/** 序列化为后端 CreateDefinitionRequest.nodes 的结构。 */
export interface WfNodePayload {
  nodeCode: string;
  nodeName: string;
  nodeType: WfNodeKind;
  sortOrder: number;
  canvasX: number | null;
  canvasY: number | null;
  conditionExpr: string | null;
  assigneeRule: string;
  timeoutHours: number | null;
  config: string;
}

/** 默认审批人规则：发起人本人。 */
export const DEFAULT_ASSIGNEE_RULE = '{"type":"SELF"}';

/** 按 kind 生成默认节点数据。 */
export function defaultNodeData(kind: WfNodeKind): WfNodeData {
  return {
    kind,
    nodeCode: `${kind.toLowerCase()}_${Date.now().toString(36)}`,
    nodeName: NODE_LABELS[kind],
    assigneeRule: kind === 'APPROVAL' || kind === 'ROUTING' ? DEFAULT_ASSIGNEE_RULE : '{}',
    conditionExpr: kind === 'CONDITIONAL' ? '${amount > 50000}' : undefined,
    timeoutHours: kind === 'APPROVAL' ? 24 : null,
    routingStrategy: kind === 'ROUTING' ? 'ALL_PASS' : undefined,
  };
}
