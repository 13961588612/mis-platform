import { memo } from 'react';
import { Play } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import { renderBaseNode } from './WfBaseNode';
import type { WfNodeData } from '../types';

/** START 节点（P7）。 */
function WfStartNodeInner(props: NodeProps<Node<WfNodeData>>) {
  return renderBaseNode(props, { theme: 'green', icon: <Play size={14} />, hasTarget: false });
}

export const WfStartNode = memo(WfStartNodeInner);
export default WfStartNode;
