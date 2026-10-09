import { memo } from 'react';
import { Flag } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import { renderBaseNode } from './WfBaseNode';
import type { WfNodeData } from '../types';

/** END 节点（P7）。 */
function WfEndNodeInner(props: NodeProps<Node<WfNodeData>>) {
  return renderBaseNode(props, { theme: 'red', icon: <Flag size={14} />, hasSource: false });
}

export const WfEndNode = memo(WfEndNodeInner);
export default WfEndNode;
