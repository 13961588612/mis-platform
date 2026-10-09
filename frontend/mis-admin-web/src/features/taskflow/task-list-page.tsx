import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Flame } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import {
  fetchMyTasks,
  fetchTaskStats,
  handleTask,
  type TaskItem,
  type TaskStats,
} from '@/lib/api/tasks';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

const STATUS_TABS = [
  { key: '', label: '待我处理' },
  { key: 'PENDING', label: '待处理' },
  { key: 'APPROVING', label: '审批中' },
  { key: 'APPROVED', label: '已通过' },
  { key: 'REJECTED', label: '已驳回' },
];

const PRIORITY_LABEL: Record<number, { text: string; cls: string }> = {
  4: { text: '紧急', cls: 'bg-destructive/10 text-destructive' },
  3: { text: '高', cls: 'bg-warning/10 text-warning' },
  2: { text: '普通', cls: 'bg-info/10 text-info' },
  1: { text: '低', cls: 'bg-muted text-muted-foreground' },
};

/**
 * 流程维度：我的待办（P3）。
 *
 * <p>P7 接入后点击待办进入 ProcessShell（顶部进度条 + 只读表单 + 底部动态审批栏）。
 */
export function TaskListPage() {
  const user = useAuthStore((s) => s.user);
  // 单租户阶段固定 tenantId=1；P3 网关身份透传后改为从登录态取。
  const tenantId = '1';
  const userId = user?.id ?? '';
  const navigate = useNavigate();

  /** 从 sys_task.metadata 中解析关联的流程实例 ID（存在则进入 ProcessShell）。 */
  function wfInstanceId(item: TaskItem): string | null {
    if (!item.metadata) return null;
    try {
      const parsed = JSON.parse(item.metadata) as { wfInstanceId?: number | string };
      return parsed.wfInstanceId != null ? String(parsed.wfInstanceId) : null;
    } catch {
      return null;
    }
  }

  const [items, setItems] = useState<TaskItem[]>([]);
  const [stats, setStats] = useState<TaskStats>({ pending: 0, urgent: 0, overdue: 0 });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const size = 20;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMyTasks({ tenantId, assigneeId: userId, status: status || undefined, page, size });
      setItems(result.list);
      setTotal(result.total);
      setStats(await fetchTaskStats(tenantId, userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total]);

  async function onHandle(item: TaskItem, action: 'APPROVE' | 'REJECT') {
    if (!userId) return;
    // 流程驱动的待办：交由 ProcessShell 统一处理（顶部进度 + 只读表单 + 审批栏）。
    const instId = wfInstanceId(item);
    if (instId && action === 'APPROVE') {
      navigate(`/task/process/${instId}`);
      return;
    }
    setActing(item.id);
    try {
      await handleTask(item.id, tenantId, userId, action, action === 'APPROVE' ? '同意' : '驳回');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '处理失败');
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="我的待办"
        description="需要我处理的审批与任务"
        actions={
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-destructive">
              <Flame className="h-3.5 w-3.5" /> 紧急 {stats.urgent}
            </span>
            <span className="flex items-center gap-1 text-warning">
              <Clock className="h-3.5 w-3.5" /> 逾期 {stats.overdue}
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" /> 待处理 {stats.pending}
            </span>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key || 'open'}
            type="button"
            onClick={() => {
              setStatus(tab.key);
              setPage(1);
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition',
              status === tab.key
                ? 'bg-primary font-medium text-primary-foreground'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center text-sm text-destructive">{error}</div>
        ) : items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无待办</div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const pr = PRIORITY_LABEL[item.priority] ?? PRIORITY_LABEL[1];
              const isOpen = item.status === 'PENDING' || item.status === 'APPROVING';
              const overdue = item.dueDate && isOpen && new Date(item.dueDate) < new Date();
              return (
                <li key={item.id} className="flex items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{item.bizTitle}</span>
                      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', pr.cls)}>{pr.text}</span>
                      {overdue ? (
                        <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                          已逾期
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{item.taskType}</span>
                      <span>·</span>
                      <span>{item.bizType} / {item.bizRefId}</span>
                      {item.dueDate ? (
                        <>
                          <span>·</span>
                          <span>截止 {item.dueDate.replace('T', ' ').slice(0, 16)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isOpen ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acting === item.id}
                          onClick={() => void onHandle(item, 'REJECT')}
                        >
                          驳回
                        </Button>
                        <Button size="sm" disabled={acting === item.id} onClick={() => void onHandle(item, 'APPROVE')}>
                          同意
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{item.status}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          共 <b className="text-foreground">{total}</b> 条 · 第 {page}/{totalPages} 页
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TaskListPage;