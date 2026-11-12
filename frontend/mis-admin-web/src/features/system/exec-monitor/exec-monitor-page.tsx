import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import {
  fetchExecTasks,
  forceArchiveExecTask,
  retryExecTask,
  type ExecutionTask,
} from '@/lib/api/exec-monitor';
import { cn } from '@/lib/utils';

const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'WAITING', label: '等待中' },
  { key: 'SUCCESS', label: '成功' },
  { key: 'FAILED', label: '失败' },
  { key: 'MANUAL_FIX', label: '需人工' },
];

const STATUS_STYLE: Record<string, { text: string; cls: string }> = {
  WAITING: { text: '等待执行', cls: 'bg-info/10 text-info' },
  SUCCESS: { text: '执行成功', cls: 'bg-success/10 text-success' },
  FAILED: { text: '执行失败', cls: 'bg-warning/10 text-warning' },
  MANUAL_FIX: { text: '需人工处理', cls: 'bg-destructive/10 text-destructive' },
};

/**
 * 系统管理 · 执行监控中心（P6）。
 *
 * <p>展示「审批通过后执行业务」的闭环状态；失败任务可手动重试或强制归档。
 */
export function ExecMonitorPage() {
  // 单租户阶段固定 tenantId=1；网关身份透传后改为从登录态取。
  const tenantId = '1';

  const [items, setItems] = useState<ExecutionTask[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const size = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchExecTasks(tenantId, status || undefined, page, size);
      setItems(result.list);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRetry(item: ExecutionTask) {
    setActing(item.id);
    try {
      await retryExecTask(item.id, tenantId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重试失败');
    } finally {
      setActing(null);
    }
  }

  async function onForceArchive(item: ExecutionTask) {
    setActing(item.id);
    try {
      await forceArchiveExecTask(item.id, tenantId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '强制归档失败');
    } finally {
      setActing(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / size));

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="执行监控" description="审批通过后执行业务的闭环状态与人工兜底" />

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key || 'all'}
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
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无执行任务</div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const st = STATUS_STYLE[item.txStatus] ?? STATUS_STYLE.WAITING;
              const needFix = item.txStatus === 'FAILED' || item.txStatus === 'MANUAL_FIX';
              return (
                <li key={item.id} className="flex items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{item.actionType}</span>
                      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', st.cls)}>{st.text}</span>
                      {item.retryCount > 0 ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground">已重试 {item.retryCount} 次</span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{item.bizType ?? '-'} / {item.bizRefId ?? '-'}</span>
                      <span>·</span>
                      <span>{item.updatedAt?.replace('T', ' ').slice(0, 16)}</span>
                    </div>
                    {item.errorMsg ? (
                      <p className="mt-1 truncate text-[11px] text-destructive" title={item.errorMsg}>
                        {item.errorMsg}
                      </p>
                    ) : null}
                  </div>
                  {needFix ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="outline" disabled={acting === item.id} onClick={() => void onRetry(item)}>
                        手动重试
                      </Button>
                      <Button size="sm" disabled={acting === item.id} onClick={() => void onForceArchive(item)}>
                        强制归档
                      </Button>
                    </div>
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

export default ExecMonitorPage;