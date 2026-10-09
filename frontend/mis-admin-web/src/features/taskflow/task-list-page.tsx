import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState, ListError, ListLoading } from '@/components/common/empty-state';
import { PaginationFooter } from '@/components/common/pagination-footer';
import { PriorityBadge } from '@/components/common/priority-badge';
import {
  fetchMyTasks,
  fetchTaskStats,
  handleTask,
  type TaskItem,
  type TaskStats,
} from '@/lib/api/tasks';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { wfInstanceId } from '@/lib/api/wf-instance';
import { returnPath } from '@/lib/nav/return-path';

const STATUS_TABS = [
  { key: '', label: '待我处理' },
  { key: 'PENDING', label: '待处理' },
  { key: 'APPROVING', label: '审批中' },
  { key: 'APPROVED', label: '已通过' },
  { key: 'REJECTED', label: '已驳回' },
];

/**
 * 流程维度：我的待办（P3）。
 *
 * <p>P7 接入后点击待办进入 ProcessShell（顶部进度条 + 只读表单 + 底部动态审批栏）。
 *
 * <p>P0-7：处理完一条后自动续下一条 —— 页内维护「本页待办队列」，
 * 成功后若队列里还有 PENDING 就地继续；队列空则展示完成态 + 去工作台/看已办的出口。
 * 队列数据来自当前列表（本页已加载的待办），本轮不新增后端队列接口。
 */
export function TaskListPage() {
  const user = useAuthStore((s) => s.user);
  // 单租户阶段固定 tenantId=1；P3 网关身份透传后改为从登录态取。
  const tenantId = '1';
  const userId = user?.id ?? '';
  const navigate = useNavigate();

  // P0-6：待办详情带来源，面包屑可回到本页
  const from = returnPath('/task/pending', '我的待办');

  const [items, setItems] = useState<TaskItem[]>([]);
  const [stats, setStats] = useState<TaskStats>({ pending: 0, urgent: 0, overdue: 0 });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const size = 20;
  /** 本轮已处理完的条数，用于完成态文案（「已连续处理 N 条」）。 */
  const [doneCount, setDoneCount] = useState(0);

  /** 拉取列表与统计；返回本次拉到的列表，供处理成功后就地决定「下一条」。 */
  const load = useCallback(async (): Promise<TaskItem[]> => {
    if (!userId) return [];
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMyTasks({ tenantId, assigneeId: userId, status: status || undefined, page, size });
      setItems(result.list);
      setTotal(result.total);
      setStats(await fetchTaskStats(tenantId, userId));
      return result.list;
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      return [];
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // 切筛选/翻页时重置「已处理计数」
  const resetKey = `${status}|${page}`;
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      setDoneCount(0);
    }
  }, [resetKey]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total]);

  /**
   * 处理成功后挑下一条待处理项（队列 = 当前页已加载的待办，本轮不新增后端队列接口）。
   * 队列耗尽时返回 null，页面转为完成态 + 出口。
   */
  function pickNext(remaining: TaskItem[]): TaskItem | null {
    return remaining.find((t) => t.status === 'PENDING' || t.status === 'APPROVING') ?? null;
  }

  async function onHandle(item: TaskItem, action: 'APPROVE' | 'REJECT') {
    if (!userId) return;
    // 流程驱动的待办：交由 ProcessShell 统一处理（顶部进度 + 只读表单 + 审批栏）。
    const instId = wfInstanceId(item);
    if (instId && action === 'APPROVE') {
      navigate(`/task/process/${instId}`, { state: from });
      return;
    }
    setActing(item.id);
    try {
      await handleTask(item.id, tenantId, userId, action, action === 'APPROVE' ? '同意' : '驳回');
      // 以服务端返回的列表为准（唯一权威源），再据此决定「下一条」还是「队列清空」
      const fresh = await load();
      const next = pickNext(fresh);
      setDoneCount((n) => n + 1);
      if (next) {
        toast.success(action === 'APPROVE' ? '已同意' : '已驳回', {
          description: `继续处理：${next.bizTitle}`,
        });
      } else {
        toast.success(action === 'APPROVE' ? '已同意' : '已驳回', { description: '本页待办已处理完' });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '处理失败');
      toast.error(e instanceof Error ? e.message : '处理失败');
    } finally {
      setActing(null);
    }
  }

  /** 队列已空且本轮确实处理过东西 —— 展示完成态出口，而不是干巴巴的「暂无待办」。 */
  const queueDrained = doneCount > 0 && items.length === 0 && !loading && !error;

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
          <ListLoading />
        ) : error ? (
          <ListError message={error} onRetry={() => void load()} />
        ) : queueDrained ? (
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6" />}
            title={`已连续处理 ${doneCount} 条，本页待办已清空`}
            description="可以回到工作台继续查看，或者查看已处理记录。"
            action={
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate('/portal')}>
                  返回工作台
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate('/task/my-processed')}>
                  查看已办
                </Button>
              </div>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="暂无待办" />
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const isOpen = item.status === 'PENDING' || item.status === 'APPROVING';
              const overdue = item.dueDate && isOpen && new Date(item.dueDate) < new Date();
              return (
                <li key={item.id} className="flex items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{item.bizTitle}</span>
                      <PriorityBadge priority={item.priority} />
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

      <PaginationFooter total={total} page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

export default TaskListPage;