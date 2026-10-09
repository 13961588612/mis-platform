/**
 * ProcessShell 流程外壳（P7）。
 *
 * <p>职责分离：外壳管「流转」——顶部进度条、底部动态审批栏；表单管「渲染」——只读展示业务数据。
 * 审批按钮不写死在表单里，由外壳根据当前用户是否为处理人动态注入。
 *
 * <p>数据来自 `GET /api/v1/workflow/instances/{id}`（含 instance/tasks/history）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { ReadOnlyField, ReadOnlyText } from './readonly-field';
import {
  fetchProcessDetail,
  type ProcessDetail,
  type WfTask,
} from '@/lib/api/workflow';
import { fetchMyTasks } from '@/lib/api/tasks';
import { wfInstanceId } from '@/lib/api/wf-instance';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { useReturnPath } from '@/lib/nav/return-path';
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

const TENANT_ID = '1';

export interface ProcessShellProps {
  instanceId: string;
}

export function ProcessShell({ instanceId }: ProcessShellProps) {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? '';
  // P0-6：面包屑首级取「跳转来源」，直接输 URL 时回落 /task/pending
  const returnPathState = useReturnPath();

  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  /**
   * P0-7 队列：进入本页时待处理的其他流程实例 ID。
   * 数据来源是 `/tasks/my`（本页已有的待办接口），本轮不新增后端队列接口；
   * 用户在本页批完一条后自动跳下一条，队列耗尽则留在原地给出去向。
   */
  const [queue, setQueue] = useState<string[]>([]);
  const navigate = useNavigate();
  /** 已处理条数，用于「已连续处理 N 条」文案。 */
  const [doneCount, setDoneCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchProcessDetail(instanceId, TENANT_ID));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 载入待处理队列（用于「批完自动续下一条」）。
   * 只取有流程实例的 PENDING 待办；失败静默降级为「无队列」，不影响本页正常处理。
   */
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchMyTasks({ tenantId: TENANT_ID, assigneeId: userId, status: 'PENDING', page: 1, size: 20 })
      .then((r) => {
        if (cancelled) return;
        const ids = r.list
          .map((t) => wfInstanceId(t))
          .filter((id): id is string => id != null && id !== instanceId);
        setQueue(Array.from(new Set(ids)));
      })
      .catch(() => {
        if (!cancelled) setQueue([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, instanceId]);

  /** 我的待处理流程任务（用于判断是否注入审批栏）。 */
  const myPendingTask = useMemo<WfTask | null>(() => {
    if (!detail || !userId) return null;
    return (
      detail.tasks.find((t) => t.status === 'PENDING' && t.assigneeId === userId) ?? null
    );
  }, [detail, userId]);

  const handle = useCallback(
    async (action: 'APPROVE' | 'REJECT') => {
      if (!myPendingTask) return;
      setActing(true);
      try {
        const res = await api.post<ApiResult<null>>(
          `/workflow/tasks/${myPendingTask.id}/complete`,
          { action, comment: action === 'APPROVE' ? '同意' : '驳回' },
          { params: { tenantId: TENANT_ID, operatorId: userId } },
        );
        if (res.data.code !== 0) throw new Error(res.data.message || '处理失败');
        const next = queue[0] ?? null;
        if (next) {
          // P0-7：队列里还有下一条 → 就地跳过去继续批，并带上 return path
          const rest = queue.slice(1);
          setQueue(rest);
          setDoneCount((n) => n + 1);
          toast.success(action === 'APPROVE' ? '已同意' : '已驳回', {
            description: `继续处理第 ${queue.length + doneCount + 1} 条`,
          });
          navigate(`/task/process/${next}`, { state: returnPathState });
        } else {
          setDoneCount((n) => n + 1);
          toast.success(action === 'APPROVE' ? '已同意' : '已驳回', { description: '待处理队列已清空' });
          await load();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '处理失败');
        toast.error(e instanceof Error ? e.message : '处理失败');
      } finally {
        setActing(false);
      }
    },
    [myPendingTask, userId, load, queue, doneCount, navigate, returnPathState],
  );

  if (loading && !detail) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载流程…</div>;
  }
  if (error && !detail) {
    return <div className="flex h-40 items-center justify-center text-sm text-destructive">{error}</div>;
  }
  if (!detail) return null;

  const { instance, tasks, history } = detail;

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title={instance.businessId}
        description={`${instance.definitionCode} · 表单 ${instance.startedFormCode ?? '-'}`}
        breadcrumbs={[
          { label: returnPathState.fromLabel, to: returnPathState.from },
          { label: '流程详情' },
        ]}
      />

      {/* 顶部：流程进度与参与人 */}
      <div className="rounded-md border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {tasks.map((t, idx) => {
            const done = t.status === 'COMPLETED';
            const active = t.status === 'PENDING';
            return (
              <div key={t.id} className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px]',
                    done && 'bg-success/10 text-success',
                    active && 'bg-info/10 text-info',
                    !done && !active && 'bg-muted text-muted-foreground',
                  )}
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                  <span>{t.nodeName}</span>
                  <span className="text-[11px] opacity-80">· {t.assigneeName ?? t.assigneeId}</span>
                </div>
                {idx < tasks.length - 1 ? <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
              </div>
            );
          })}
          {tasks.length === 0 ? <span className="text-[12px] text-muted-foreground">暂无节点任务</span> : null}
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> 状态 {instance.status}</span>
          {instance.completedAt ? <span>完成于 {instance.completedAt.replace('T', ' ').slice(0, 16)}</span> : null}
          <span>后处理 {instance.postProcessStatus}</span>
        </div>
      </div>

      {/* 中部：只读表单区 + 审批历史 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto lg:grid-cols-3">
        <div className="rounded-md border bg-card p-4 lg:col-span-2">
          <h3 className="mb-3 text-[13px] font-semibold">业务数据（只读）</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ReadOnlyField label="业务类型">
              <ReadOnlyText value={instance.businessType} />
            </ReadOnlyField>
            <ReadOnlyField label="业务单号">
              <ReadOnlyText value={instance.businessId} />
            </ReadOnlyField>
            <ReadOnlyField label="发起人">
              <ReadOnlyText value={instance.initiatorName ?? instance.initiatorId} />
            </ReadOnlyField>
            <ReadOnlyField label="当前节点">
              <ReadOnlyText value={instance.currentNodeCode} />
            </ReadOnlyField>
          </div>
        </div>

        <div className="rounded-md border bg-card p-4">
          <h3 className="mb-3 text-[13px] font-semibold">审批历史</h3>
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="border-l-2 border-border pl-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{h.operation}</span>
                  <span className="text-muted-foreground">{h.nodeCode}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {h.operatorName ?? h.operatorId ?? '系统'} · {h.createdAt?.replace('T', ' ').slice(0, 16)}
                </div>
                {h.comment ? <div className="text-[11px]">{h.comment}</div> : null}
              </li>
            ))}
            {history.length === 0 ? <li className="text-[12px] text-muted-foreground">暂无历史</li> : null}
          </ul>
        </div>
      </div>

      {/* 底部：动态审批栏（只有处理人才看到） */}
      {myPendingTask ? (
        <div className="flex items-center justify-end gap-3 rounded-md border bg-card p-3">
          <span className="mr-auto text-[12px] text-muted-foreground">
            当前待办：{myPendingTask.nodeName}
            {doneCount > 0 ? ` · 已连续处理 ${doneCount} 条` : ''}
          </span>
          <Button variant="destructive" size="sm" disabled={acting} onClick={() => void handle('REJECT')}>
            驳回
          </Button>
          <Button size="sm" disabled={acting} onClick={() => void handle('APPROVE')}>
            同意
          </Button>
        </div>
      ) : doneCount > 0 && queue.length === 0 ? (
        /* P0-7：队列耗尽 + 本轮处理过东西 → 给出去向，而不是一句「流程已结束」 */
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-md border bg-card p-3">
          <span className="mr-auto text-[12px] text-muted-foreground">
            已连续处理 {doneCount} 条，待处理队列已清空
          </span>
          <Button size="sm" variant="outline" onClick={() => navigate(returnPathState.from)}>
            返回{returnPathState.fromLabel}
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/task/my-processed')}>
            查看已办
          </Button>
        </div>
      ) : (
        <div className="rounded-md border bg-muted/20 p-3 text-center text-[12px] text-muted-foreground">
          {instance.status === 'RUNNING' ? '当前节点由他人处理' : '流程已结束'}
        </div>
      )}
    </div>
  );
}

export default ProcessShell;
