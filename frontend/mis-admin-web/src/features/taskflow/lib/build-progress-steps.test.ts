import { describe, expect, it } from 'vitest';
import { buildProgressSteps } from './build-progress-steps';
import type { WfHistory, WfNode, WfTask } from '@/lib/api/workflow';

const nodes: WfNode[] = [
  {
    nodeCode: 'start',
    nodeName: '开始',
    nodeType: 'START',
    sortOrder: 0,
    canvasX: null,
    canvasY: null,
    conditionExpr: null,
    assigneeRule: '{}',
    timeoutHours: null,
    config: '{}',
  },
  {
    nodeCode: 'approve',
    nodeName: '主管审批',
    nodeType: 'APPROVAL',
    sortOrder: 1,
    canvasX: null,
    canvasY: null,
    conditionExpr: null,
    assigneeRule: '{"type":"USER_LIST","value":[1]}',
    timeoutHours: 24,
    config: '{}',
  },
  {
    nodeCode: 'mgr',
    nodeName: '经理审批',
    nodeType: 'APPROVAL',
    sortOrder: 2,
    canvasX: null,
    canvasY: null,
    conditionExpr: null,
    assigneeRule: '{"type":"SUPERVISOR"}',
    timeoutHours: null,
    config: '{}',
  },
  {
    nodeCode: 'end',
    nodeName: '结束',
    nodeType: 'END',
    sortOrder: 3,
    canvasX: null,
    canvasY: null,
    conditionExpr: null,
    assigneeRule: '{}',
    timeoutHours: null,
    config: '{}',
  },
];

describe('buildProgressSteps', () => {
  it('已审 / 当前 / 后续：人员、操作、规则分档正确', () => {
    const tasks: WfTask[] = [
      {
        id: '1',
        instanceId: '128',
        nodeCode: 'approve',
        nodeName: '主管审批',
        taskType: 'APPROVE',
        sysTaskId: '9',
        assigneeId: '700001',
        assigneeName: '主管甲',
        status: 'PENDING',
        dueDate: null,
        createdAt: '2026-10-12T10:00:00',
        completedAt: null,
      },
    ];
    const history: WfHistory[] = [
      {
        id: 'h1',
        nodeCode: 'start',
        operatorId: '100',
        operatorName: '发起人',
        operation: 'SUBMIT',
        fromNode: null,
        toNode: 'start',
        comment: null,
        createdAt: '2026-10-12T09:00:00',
      },
    ];
    const steps = buildProgressSteps({
      nodes,
      tasks,
      history,
      instance: {
        currentNodeCode: 'approve',
        initiatorId: '100',
        initiatorName: '发起人',
        status: 'RUNNING',
      },
    });
    expect(steps.map((s) => s.phase)).toEqual(['done', 'current', 'future', 'future']);
    expect(steps[0].actions[0].operationLabel).toBe('提交');
    expect(steps[0].people.some((p) => p.name === '发起人')).toBe(true);
    expect(steps[1].people[0]).toMatchObject({ name: '主管甲', statusLabel: '待处理' });
    // 待办 / 后续节点均带审批规则（供悬停 popup）
    expect(steps[1].ruleLabel).toBe('指定人员列表');
    expect(steps[2].ruleLabel).toBe('上级主管');
  });
});
