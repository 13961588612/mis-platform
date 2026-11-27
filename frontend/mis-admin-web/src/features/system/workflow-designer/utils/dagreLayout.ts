/**
 * Dagre 自动布局（P7）—— 复用项目已装的 @dagrejs/dagre。
 */
import dagre from '@dagrejs/dagre';
import type { WfFlowNode, WfFlowEdge } from '../types';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

/** 自左向右分层排列（与节点 Handle 左右一致），返回带新坐标的节点副本。 */
export function applyDagreLayout(nodes: WfFlowNode[], edges: WfFlowEdge[]): WfFlowNode[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  // LR：ranksep=层间距（横向），nodesep=同层节点间距（纵向）
  g.setGraph({ rankdir: 'LR', ranksep: 100, nodesep: 50 });
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
