/**
 * 流程完整性校验（P7）。
 *
 * <p>对齐设计文档 §8：发布前必须通过校验。返回 errors（阻止发布）与 warnings（可忽略）。
 */
import type { WfFlowNode, WfFlowEdge } from '../types';

export interface ValidationIssue {
  nodeId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function validateWorkflow(nodes: WfFlowNode[], edges: WfFlowEdge[]): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const starts = nodes.filter((n) => n.data.kind === 'START');
  const ends = nodes.filter((n) => n.data.kind === 'END');
  if (starts.length === 0) {
    errors.push({ message: '缺少开始节点' });
  } else if (starts.length > 1) {
    errors.push({ message: `存在多个开始节点（${starts.length} 个）` });
  }
  if (ends.length === 0) {
    errors.push({ message: '缺少结束节点' });
  }

  // 可达性（从 START BFS）
  if (starts.length > 0) {
    const reachable = new Set<string>();
    const queue: string[] = starts.map((s) => s.id);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      edges.filter((e) => e.source === cur).forEach((e) => queue.push(e.target));
    }
    nodes.forEach((n) => {
      if (!reachable.has(n.id)) {
        errors.push({ nodeId: n.id, message: `节点「${n.data.nodeName}」无法从开始节点到达` });
      }
    });
  }

  // 审批节点必须有审批人规则
  nodes.filter((n) => n.data.kind === 'APPROVAL').forEach((n) => {
    const rule = (n.data.assigneeRule ?? '').trim();
    if (!rule || rule === '{}') {
      errors.push({ nodeId: n.id, message: `审批节点「${n.data.nodeName}」未配置审批人规则` });
    }
  });

  // 孤立节点（无进出边）
  nodes.forEach((n) => {
    if (n.data.kind === 'START' || n.data.kind === 'END') return;
    const hasIn = edges.some((e) => e.target === n.id);
    const hasOut = edges.some((e) => e.source === n.id);
    if (!hasIn || !hasOut) {
      warnings.push({ nodeId: n.id, message: `节点「${n.data.nodeName}」存在未连接的端口` });
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}
