import { memo } from 'react';
import { GitBranch } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import { renderBaseNode } from './WfBaseNode';
import type { WfNodeData } from '../types';

/** CONDITIONAL 节点（P7）。 */
function WfConditionalNodeInner(props: NodeProps<Node<WfNodeData>>) {
  return renderBaseNode(props, { theme: 'amber', icon: <GitBranch size={14} /> });
}

export const WfConditionalNode = memo(WfConditionalNodeInner);
export default WfConditionalNode;
