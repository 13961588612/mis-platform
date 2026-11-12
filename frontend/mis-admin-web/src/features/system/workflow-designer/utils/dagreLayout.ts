/**
 * Dagre 自动布局（P7）—— 复用项目已装的 @dagrejs/dagre。
 */
import dagre from '@dagrejs/dagre';
import type { WfFlowNode, WfFlowEdge } from '../types';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

/** 自上而下分层排列，返回带新坐标的节点副本。 */
export function applyDagreLayout(nodes: WfFlowNode[], edges: WfFlowEdge[]): WfFlowNode[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', ranksep: 90, nodesep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}
