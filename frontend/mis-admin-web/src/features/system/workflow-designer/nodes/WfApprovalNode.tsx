import { memo } from 'react';
import { CheckSquare } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import { renderBaseNode } from './WfBaseNode';
import type { WfNodeData } from '../types';

/** APPROVAL 节点（P7）。 */
function WfApprovalNodeInner(props: NodeProps<Node<WfNodeData>>) {
  return renderBaseNode(props, { theme: 'blue', icon: <CheckSquare size={14} /> });
}

export const WfApprovalNode = memo(WfApprovalNodeInner);
export default WfApprovalNode;
