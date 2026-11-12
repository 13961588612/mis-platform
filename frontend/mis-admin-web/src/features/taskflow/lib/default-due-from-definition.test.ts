import { describe, expect, it } from 'vitest';
import { defaultDueFromDefinition } from './default-due-from-definition';
import type { WfDefinition } from '@/lib/api/workflow';

function def(nodes: WfDefinition['nodes']): WfDefinition {
  return {
    id: '1',
    tenantId: '1',
    code: 'D',
    name: 'n',
    category: '',
    categoryId: null,
    description: null,
    version: 1,
    status: 'ACTIVE',
    supportedFormCodes: ['PUR_FORM'],
    formSchema: null,
    config: '{}',
    nodes,
    edges: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('defaultDueFromDefinition', () => {
  it('取首个带 timeoutHours 的审批节点', () => {
    const before = Date.now();
    const d = defaultDueFromDefinition(
      def([
        { nodeCode: 's', nodeName: '开始', nodeType: 'START', sortOrder: 0, canvasX: null, canvasY: null, conditionExpr: null, assigneeRule: '{}', timeoutHours: null, config: '{}' },
        { nodeCode: 'a', nodeName: '审批', nodeType: 'APPROVAL', sortOrder: 1, canvasX: null, canvasY: null, conditionExpr: null, assigneeRule: '{}', timeoutHours: 24, config: '{}' },
      ]),
    );
    expect(d).toBeTruthy();
    expect(d!.getTime()).toBeGreaterThanOrEqual(before + 23 * 3600_000);
  });

  it('无时限 → null', () => {
    expect(
      defaultDueFromDefinition(
        def([
          { nodeCode: 's', nodeName: '开始', nodeType: 'START', sortOrder: 0, canvasX: null, canvasY: null, conditionExpr: null, assigneeRule: '{}', timeoutHours: null, config: '{}' },
        ]),
      ),
    ).toBeNull();
  });
});
