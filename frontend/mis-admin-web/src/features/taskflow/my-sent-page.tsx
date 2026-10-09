import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { fetchMyProcesses, type WfInstance } from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

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

  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="我发起的" description="我提交单据的流转进度" />

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center text-sm text-destructive">{error}</div>
        ) : items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无发起的流程</div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const st = STATUS_LABEL[item.status] ?? STATUS_LABEL.RUNNING;
              return (
                <li
                key={item.id}
                className="flex cursor-pointer items-center gap-4 px-4 py-3 transition hover:bg-muted/40"
                onClick={() => navigate(`/task/process/${item.id}`)}
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

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          共 <b className="text-foreground">{total}</b> 条 · 第 {page}/{totalPages} 页
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TaskMySentPage;