import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, History, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ListError, ListLoading } from '@/components/common/empty-state';
import { PaginationFooter } from '@/components/common/pagination-footer';
import { fetchHandledTasks, type TaskItem } from '@/lib/api/tasks';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { wfInstanceId } from '@/lib/api/wf-instance';
import { returnPath } from '@/lib/nav/return-path';

const STATUS: Record<string, { text: string; cls: string; icon: typeof CheckCircle2 }> = {
  APPROVED: { text: '已通过', cls: 'bg-success/10 text-success', icon: CheckCircle2 },
  REJECTED: { text: '已驳回', cls: 'bg-destructive/10 text-destructive', icon: XCircle },
};

/** 流程维度：我审批的（我处理过的历史记录）。 */
export function TaskMyProcessedPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  // 单租户阶段固定 tenantId=1；网关身份透传后改为从登录态取。
  const tenantId = '1';
  const userId = user?.id ?? '';

  const [items, setItems] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const size = 20;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchHandledTasks({ tenantId, assigneeId: userId, page, size });
      setItems(r.list);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total]);

  // P0-6：带上来源，详情页面包屑可回到「我审批的」
  const from = returnPath('/task/my-processed', '我审批的');

  function open(item: TaskItem) {
    const inst = wfInstanceId(item);
    if (inst) {
      navigate(`/task/process/${inst}`, { state: from });
      return;
    }
    navigate('/task/pending');
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="我审批的" description="我处理过的历史记录" />

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {loading ? (
          <ListLoading />
        ) : error ? (
          <ListError message={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<History className="h-6 w-6" />} title="暂无审批记录" />
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const st = STATUS[item.status] ?? STATUS.APPROVED;
              const Icon = st.icon;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => open(item)}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{item.bizTitle}</span>
                        <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px]', st.cls)}>
                          <Icon className="h-3 w-3" />
                          {st.text}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{item.taskType}</span>
                        <span>·</span>
                        <span>{item.bizType} / {item.bizRefId}</span>
                        {item.completedAt ? (
                          <>
                            <span>·</span>
                            <span>完成于 {item.completedAt.replace('T', ' ').slice(0, 16)}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </button>
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

export default TaskMyProcessedPage;