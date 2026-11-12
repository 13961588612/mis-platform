import { memo } from 'react';
import { Users } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import { renderBaseNode } from './WfBaseNode';
import type { WfNodeData } from '../types';

/** ROUTING 节点（P7）。 */
function WfRoutingNodeInner(props: NodeProps<Node<WfNodeData>>) {
  return renderBaseNode(props, { theme: 'purple', icon: <Users size={14} /> });
}

export const WfRoutingNode = memo(WfRoutingNodeInner);
export default WfRoutingNode;
