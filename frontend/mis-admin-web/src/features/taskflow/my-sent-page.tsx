import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ListError, ListLoading } from '@/components/common/empty-state';
import { PaginationFooter } from '@/components/common/pagination-footer';
import { fetchMyProcesses, type WfInstance } from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { returnPath } from '@/lib/nav/return-path';

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  RUNNING: { text: '进行中', cls: 'bg-info/10 text-info' },
  COMPLETED: { text: '已完成', cls: 'bg-success/10 text-success' },
  TERMINATED: { text: '已终止', cls: 'bg-destructive/10 text-destructive' },
  SUSPENDED: { text: '已挂起', cls: 'bg-warning/10 text-warning' },
};

/** 流程维度：我发起的（P5 接入真实流程实例）。 */
export function TaskMySentPage() {
  const user = useAuthStore((s) => s.user);
  const tenantId = '1';
  const initiatorId = user?.id ?? '';
  const navigate = useNavigate();

  const [items, setItems] = useState<WfInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const size = 20;

  const load = useCallback(async () => {
    if (!initiatorId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMyProcesses(tenantId, initiatorId, undefined, page, size);
      setItems(result.list);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, initiatorId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total]);

  // P0-6：带上来源，详情页面包屑可回到「我发起的」
  const from = returnPath('/task/my-sent', '我发起的');

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="我发起的" description="我提交单据的流转进度" />

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {loading ? (
          <ListLoading />
        ) : error ? (
          <ListError message={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <EmptyState title="暂无发起的流程" />
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const st = STATUS_LABEL[item.status] ?? STATUS_LABEL.RUNNING;
              return (
                <li
                key={item.id}
                className="flex cursor-pointer items-center gap-4 px-4 py-3 transition hover:bg-muted/40"
                onClick={() => navigate(`/task/process/${item.id}`, { state: from })}
              >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {item.businessType} / {item.businessId}
                      </span>
                      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', st.cls)}>{st.text}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{item.definitionCode}</span>
                      <span>·</span>
                      <span>表单 {item.startedFormCode ?? '-'}</span>
                      <span>·</span>
                      <span>{item.createdAt?.replace('T', ' ').slice(0, 16)}</span>
                    </div>
                  </div>
                  {item.status === 'COMPLETED' ? (
                    <span className="text-xs text-muted-foreground">
                      {item.postProcessStatus === 'SUCCESS' ? '业务已归档' : '待归档'}
                    </span>
                  ) : null}
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

export default TaskMySentPage;