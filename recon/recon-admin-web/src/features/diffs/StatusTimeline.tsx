import { HandleHistoryRow, StatusHistoryRow } from '@/types/api';
import { STATUS_REASON_LABEL } from './constants';

/** 时间线节点（合并状态历史 + 处理历史后按时间排序） */
interface TimelineNode {
  time: string;
  title: string;
  desc: string;
  color: string;
}

function mergeTimeline(
  statusHistory: StatusHistoryRow[],
  handleHistory: HandleHistoryRow[],
): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  for (const h of statusHistory) {
    const from = h.from_value ?? '（新建）';
    const reasonTxt = (h.reason && STATUS_REASON_LABEL[h.reason]) || h.reason || '';
    nodes.push({
      time: h.created_at,
      title: `状态 ${from} → ${h.to_value}`,
      desc: reasonTxt + (h.operator ? ` · 操作人：${h.operator}` : ''),
      color: statusColor(h.to_value),
    });
  }
  for (const h of handleHistory) {
    const labelMap: Record<string, string> = {
      unhandled: '未处理',
      handled: '已处理',
      ignored: '已忽略',
      false_positive: '误报',
    };
    nodes.push({
      time: h.handled_at,
      title: `人工判定：${labelMap[h.handle_status] ?? h.handle_status}`,
      desc:
        (h.operator ? `操作人：${h.operator}` : '') +
        (h.remark ? ` · 备注：${h.remark}` : ''),
      color: handleColor(h.handle_status),
    });
  }
  return nodes.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

function statusColor(to: string): string {
  if (to === 'pending') return 'bg-blue-500';
  if (to === 'confirmed') return 'bg-orange-500';
  if (to === 'resolved') return 'bg-green-500';
  if (to === 'deferred') return 'bg-gray-400';
  return 'bg-gray-400';
}

function handleColor(s: string): string {
  if (s === 'handled') return 'bg-purple-500';
  if (s === 'unhandled') return 'bg-gray-400';
  return 'bg-gray-500';
}

/** 状态流转时间线（V4 详情页用）。 */
export function StatusTimeline({
  statusHistory,
  handleHistory,
}: {
  statusHistory: StatusHistoryRow[];
  handleHistory: HandleHistoryRow[];
}) {
  const nodes = mergeTimeline(statusHistory, handleHistory);
  if (nodes.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">暂无流转历史。</div>;
  }
  return (
    <div className="space-y-3 py-2">
      {nodes.map((n, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={`w-2.5 h-2.5 rounded-full ${n.color} mt-1.5`} />
            {i < nodes.length - 1 && <span className="w-px flex-1 bg-border my-1" />}
          </div>
          <div className="flex-1 pb-3">
            <div className="text-xs text-muted-foreground">{n.time}</div>
            <div className="text-sm font-medium mt-0.5">{n.title}</div>
            {n.desc && <div className="text-xs text-muted-foreground mt-1">{n.desc}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
