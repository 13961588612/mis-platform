/**
 * 将流程定义节点 + 实例任务/历史合并为进度看板步骤（纯函数，便于单测）。
 */
import type { WfHistory, WfInstance, WfNode, WfTask } from '@/lib/api/workflow';
import { assigneeRuleLabel } from '@/features/system/workflow-designer/assignee-rule';

export type ProgressStepPhase = 'done' | 'current' | 'future';

export interface ProgressStepAction {
  operation: string;
  operationLabel: string;
  operatorName: string;
  comment: string | null;
  at: string | null;
}

export interface ProgressStepPerson {
  id: string;
  name: string;
  /** PENDING / COMPLETED / … */
  status: string;
  statusLabel: string;
}

export interface ProgressStep {
  nodeCode: string;
  nodeName: string;
  nodeType: string;
  phase: ProgressStepPhase;
  /** 已发生的审批/提交等操作（按时间）。 */
  actions: ProgressStepAction[];
  /** 当前/历史任务上的人员。 */
  people: ProgressStepPerson[];
  /** 后续节点：定义上的审批规则文案。 */
  ruleLabel: string | null;
}

const OP_LABEL: Record<string, string> = {
  SUBMIT: '提交',
  APPROVE: '同意',
  REJECT: '驳回',
  FORWARD: '转办',
  SKIP: '跳过',
  CC_DISPATCH: '抄送',
  COMMENT: '评论',
};

const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: '待处理',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  TRANSFERRED: '已转办',
};

function fmtAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.replace('T', ' ').slice(0, 16);
}

function opLabel(op: string): string {
  return OP_LABEL[op] ?? op;
}

function taskStatusLabel(s: string): string {
  return TASK_STATUS_LABEL[s] ?? s;
}

/**
 * @param nodes 定义节点（已按 sortOrder 排序更佳；本函数会再排一次）
 */
export function buildProgressSteps(input: {
  nodes: WfNode[];
  tasks: WfTask[];
  history: WfHistory[];
  instance: Pick<WfInstance, 'currentNodeCode' | 'initiatorId' | 'initiatorName' | 'status'>;
}): ProgressStep[] {
  const nodes = [...input.nodes].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const currentCode = input.instance.currentNodeCode;
  const instanceDone =
    input.instance.status === 'COMPLETED' ||
    input.instance.status === 'TERMINATED';

  // 当前节点在定义中的下标；找不到则全部按 history/tasks 推断
  const currentIdx = currentCode
    ? nodes.findIndex((n) => n.nodeCode === currentCode)
    : -1;

  return nodes.map((node, idx) => {
    const nodeTasks = input.tasks.filter((t) => t.nodeCode === node.nodeCode);
    const nodeHistory = input.history
      .filter((h) => h.nodeCode === node.nodeCode)
      .slice()
      .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

    const hasDoneTask = nodeTasks.some((t) => t.status === 'COMPLETED');
    const hasPending = nodeTasks.some((t) => t.status === 'PENDING');
    const hasReject = nodeHistory.some((h) => h.operation === 'REJECT');
    const hasApproveOrSubmit = nodeHistory.some(
      (h) => h.operation === 'APPROVE' || h.operation === 'SUBMIT',
    );

    let phase: ProgressStepPhase;
    if (instanceDone) {
      phase = 'done';
    } else if (currentIdx >= 0) {
      if (idx < currentIdx) phase = 'done';
      else if (idx === currentIdx || hasPending) phase = 'current';
      else phase = 'future';
    } else if (hasPending) {
      phase = 'current';
    } else if (hasDoneTask || hasReject || hasApproveOrSubmit) {
      phase = 'done';
    } else {
      phase = 'future';
    }

    const actions: ProgressStepAction[] = nodeHistory.map((h) => ({
      operation: h.operation,
      operationLabel: opLabel(h.operation),
      operatorName: h.operatorName ?? h.operatorId ?? '系统',
      comment: h.comment,
      at: fmtAt(h.createdAt),
    }));

    const peopleMap = new Map<string, ProgressStepPerson>();
    for (const t of nodeTasks) {
      const id = String(t.assigneeId);
      peopleMap.set(id, {
        id,
        name: t.assigneeName ?? id,
        status: t.status,
        statusLabel: taskStatusLabel(t.status),
      });
    }
    // START：补充发起人
    if (node.nodeType === 'START' && input.instance.initiatorId) {
      const id = String(input.instance.initiatorId);
      if (!peopleMap.has(id)) {
        peopleMap.set(id, {
          id,
          name: input.instance.initiatorName ?? id,
          status: phase === 'done' ? 'COMPLETED' : 'PENDING',
          statusLabel: phase === 'done' ? '已发起' : '发起人',
        });
      }
    }

    const isApprovalLike =
      node.nodeType === 'APPROVAL' ||
      node.nodeType === 'ROUTING' ||
      node.nodeType === 'CC';

    // 规则文案始终保留（待办/后续悬停 popup 用；已完成节点也可查看配置）
    let ruleLabel: string | null = null;
    if (isApprovalLike) {
      ruleLabel = assigneeRuleLabel(node.assigneeRule);
    } else if (node.nodeType === 'START') {
      ruleLabel = '发起人本人';
    }

    return {
      nodeCode: node.nodeCode,
      nodeName: node.nodeName || node.nodeCode,
      nodeType: node.nodeType,
      phase,
      actions,
      people: [...peopleMap.values()],
      ruleLabel,
    };
  });
}
