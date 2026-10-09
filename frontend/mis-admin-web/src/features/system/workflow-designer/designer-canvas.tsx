/**
 * 流程设计器画布（P7）。
 *
 * <p>基于 @xyflow/react：左侧 Palette 拖拽建节点、画布连线、右侧属性面板编辑。
 * 保存时序列化为后端 `CreateDefinitionRequest` 的 nodes/edges 结构。
 *
 * <p>参考实现：features/agent/iqd/components/modeling/ModelCanvas.tsx。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '@/lib/utils';
import {
  WF_NODE_TYPES,
  type WfFlowEdge,
  type WfFlowNode,
  type WfNodeKind,
} from './types';
import { WfStartNode } from './nodes/WfStartNode';
import { WfApprovalNode } from './nodes/WfApprovalNode';
import { WfConditionalNode } from './nodes/WfConditionalNode';
import { WfRoutingNode } from './nodes/WfRoutingNode';
import { WfAutomationNode } from './nodes/WfAutomationNode';
import { WfEndNode } from './nodes/WfEndNode';

const NODE_TYPES = {
  wfStart: WfStartNode,
  wfApproval: WfApprovalNode,
  wfConditional: WfConditionalNode,
  wfRouting: WfRoutingNode,
  wfAutomation: WfAutomationNode,
  wfEnd: WfEndNode,
};

const DEFAULT_EDGE_STYLE = { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1.5 };

export interface DesignerCanvasProps {
  nodes: WfFlowNode[];
  edges: WfFlowEdge[];
  selectedNodeId: string | null;
  onNodesChange: (nodes: WfFlowNode[]) => void;
  onEdgesChange: (edges: WfFlowEdge[]) => void;
  onSelectNode: (id: string | null) => void;
}

function CanvasInner({
  nodes,
  edges,
  selectedNodeId,
  onNodesChange,
  onEdgesChange,
  onSelectNode,
}: DesignerCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [rf, setRf] = useState<{ screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } } | null>(null);

  const decoratedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [nodes, selectedNodeId],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<WfFlowNode>[]) => {
      onNodesChange(applyNodeChanges(changes, nodes) as WfFlowNode[]);
    },
    [nodes, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<WfFlowEdge>[]) => {
      onEdgesChange(applyEdgeChanges(changes, edges) as WfFlowEdge[]);
    },
    [edges, onEdgesChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      onEdgesChange(
        addEdge(
          { ...connection, id: `e_${connection.source}_${connection.target}_${Date.now().toString(36)}`, style: DEFAULT_EDGE_STYLE },
          edges,
        ) as WfFlowEdge[],
      );
    },
    [edges, onEdgesChange],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData('application/wf-node-kind') as WfNodeKind;
      if (!kind || !WF_NODE_TYPES[kind] || !rf) return;
      const position = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const newNode: WfFlowNode = {
        id: `n_${Date.now().toString(36)}`,
        type: WF_NODE_TYPES[kind],
        position,
        data: {
          kind,
          nodeCode: `${kind.toLowerCase()}_${Date.now().toString(36)}`,
          nodeName: { START: '开始', APPROVAL: '审批', CONDITIONAL: '条件分支', ROUTING: '会签/路由', AUTOMATION: '自动化', END: '结束' }[kind],
          assigneeRule: kind === 'APPROVAL' || kind === 'ROUTING' ? '{"type":"SELF"}' : '{}',
          conditionExpr: kind === 'CONDITIONAL' ? '${amount > 50000}' : undefined,
          timeoutHours: kind === 'APPROVAL' ? 24 : null,
        },
      };
      onNodesChange([...nodes, newNode]);
      onSelectNode(newNode.id);
    },
    [rf, nodes, onNodesChange, onSelectNode],
  );

  return (
    <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow
        nodes={decoratedNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onInit={(instance) => setRf(instance)}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className={cn('bg-muted/20')}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <MiniMap pannable zoomable bgColor="#ffffff" maskColor="rgb(240,240,240,0.6)" className="!rounded-md !border !border-dashed !border-black !bg-white" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function DesignerCanvas(props: DesignerCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default DesignerCanvas;
