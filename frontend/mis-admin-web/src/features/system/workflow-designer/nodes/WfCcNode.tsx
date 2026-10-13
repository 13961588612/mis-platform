import { memo } from 'react';
import { Mail } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import { renderBaseNode } from './WfBaseNode';
import type { WfNodeData } from '../types';

/** CC 抄送节点：到达即分发，不阻塞流程。 */
function WfCcNodeInner(props: NodeProps<Node<WfNodeData>>) {
  return renderBaseNode(props, { theme: 'teal', icon: <Mail size={14} /> });
}

export const WfCcNode = memo(WfCcNodeInner);
export default WfCcNode;
