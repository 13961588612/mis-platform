/**
 * 流程详情页（P7）：包裹 ProcessShell，路由 /task/process/:id。
 */
import { useParams } from 'react-router-dom';
import { ProcessShell } from './process-shell';

export function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">缺少流程实例 ID</div>;
  }
  return <ProcessShell instanceId={id} />;
}

export default ProcessDetailPage;
