import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, History, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { fetchHandledTasks, type TaskItem } from '@/lib/api/tasks';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

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

  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="我审批的" description="我处理过的历史记录" />

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-destructive">
            {error}
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <History className="h-6 w-6 opacity-40" />
            暂无审批记录
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const st = STATUS[item.status] ?? STATUS.APPROVED;
              const Icon = st.icon;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (item.metadata) {
                        try {
                          const m = JSON.parse(item.metadata) as { wfInstanceId?: number | string };
                          if (m.wfInstanceId != null) {
                            navigate(`/task/process/${m.wfInstanceId}`);
                            return;
                          }
                        } catch {
                          /* ignore */
                        }
                      }
                      navigate('/task/pending');
                    }}
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

export default TaskMyProcessedPage;