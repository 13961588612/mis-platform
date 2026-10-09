/**
 * 流程校验器单测（P7）。
 */
import { describe, expect, it } from 'vitest';
import { validateWorkflow } from './validator';
import type { WfFlowEdge, WfFlowNode } from '../types';

function node(id: string, kind: WfFlowNode['data']['kind'], extra?: Partial<WfFlowNode['data']>): WfFlowNode {
  return {
    id,
    type: 'x',
    position: { x: 0, y: 0 },
    data: { kind, nodeCode: id, nodeName: id, assigneeRule: '{}', ...extra },
  };
}

function edge(source: string, target: string): WfFlowEdge {
  return { id: `${source}-${target}`, source, target };
}

describe('validateWorkflow', () => {
  it('缺少开始节点报错', () => {
    const r = validateWorkflow([node('end', 'END')], []);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes('开始节点'))).toBe(true);
  });

  it('多个开始节点报错', () => {
    const r = validateWorkflow([node('s1', 'START'), node('s2', 'START'), node('e', 'END')], [edge('s1', 'e')]);
    expect(r.errors.some((e) => e.message.includes('多个开始节点'))).toBe(true);
  });

  it('审批节点未配置审批人规则报错', () => {
    const r = validateWorkflow(
      [node('s', 'START'), node('a', 'APPROVAL'), node('e', 'END')],
      [edge('s', 'a'), edge('a', 'e')],
    );
    expect(r.errors.some((e) => e.message.includes('未配置审批人规则'))).toBe(true);
  });

  it('不可达节点报错', () => {
    const r = validateWorkflow(
      [node('s', 'START'), node('a', 'APPROVAL', { assigneeRule: '{"type":"SELF"}' }), node('e', 'END'), node('orphan', 'APPROVAL', { assigneeRule: '{"type":"SELF"}' })],
      [edge('s', 'a'), edge('a', 'e')],
    );
    expect(r.errors.some((e) => e.message.includes('无法从开始节点到达'))).toBe(true);
  });

  it('完整流程校验通过', () => {
    const r = validateWorkflow(
      [node('s', 'START'), node('a', 'APPROVAL', { assigneeRule: '{"type":"FIXED","value":1}' }), node('e', 'END')],
      [edge('s', 'a'), edge('a', 'e')],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
});