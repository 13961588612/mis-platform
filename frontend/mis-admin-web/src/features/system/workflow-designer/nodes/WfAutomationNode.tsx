import { memo } from 'react';
import { Settings } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import { renderBaseNode } from './WfBaseNode';
import type { WfNodeData } from '../types';

/** AUTOMATION 节点（P7）。 */
function WfAutomationNodeInner(props: NodeProps<Node<WfNodeData>>) {
  return renderBaseNode(props, { theme: 'gray', icon: <Settings size={14} /> });
}

export const WfAutomationNode = memo(WfAutomationNodeInner);
export default WfAutomationNode;
