/**
 * ProcessShell 流程外壳（P7；T03b 新增 embedded 变体）。
 *
 * <p>职责分离：外壳管「流转」——顶部进度条、底部动态审批栏；表单管「渲染」——只读展示业务数据。
 * 审批按钮不写死在表单里，由外壳根据当前用户是否为处理人动态注入。
 *
 * <p><b>两种变体</b>（设计 §2.1）：
 * <ul>
 *   <li>{@code page}（默认）：整页形态（`/task/process/{id}`）——`PageHeader` + 面包屑 +
 *       `lg:grid-cols-3` 网格（表单左 2/3 + 历史右 1/3）+ P7 队列自动续办。**与改造前逐字一致（零回归）**。</li>
 *   <li>{@code embedded}：嵌入抽屉的形态——去掉 `PageHeader`/面包屑、去掉 `h-full` 与中部
 *       `overflow-auto`（由抽屉 SheetContent 内容体做唯一滚动容器）、三区竖向堆叠
 *       （①审批进度 → ②只读表单 → ③审批历史）、关闭 P7 队列、动作成功后回调
 *       {@code onActionDone}（由父组件关抽屉 + 刷新列表）、底部动作栏在同意/驳回外**增加转办**。</li>
 * </ul>
 *
 * <p>数据来自 `GET /api/v1/workflow/instances/{id}`（含 instance/tasks/history）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { FormShell } from '@/features/biz/forms/form-shell';
import { ReadOnlyField, ReadOnlyText } from './readonly-field';
import {
  fetchProcessDetail,
  type ProcessDetail,
  type WfInstance,
  type WfTask,
} from '@/lib/api/workflow';
import { fetchMyTasks, transferTask } from '@/lib/api/tasks';
import { wfInstanceId } from '@/lib/api/wf-instance';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { useReturnPath } from '@/lib/nav/return-path';
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

const TENANT_ID = '1';

export interface ProcessShellProps {
  instanceId: string;
  /**
   * 渲染变体：`page`（默认，整页）｜`embedded`（嵌入抽屉）。见类注释与设计 §2.1。
   */
  variant?: 'page' | 'embedded';
  /**
   * `embedded` 变体下动作（同意/驳回/转办）**成功后**的回调——由父组件负责关抽屉 + 刷新列表。
   * `page` 变体忽略此回调（沿用 P7 队列续办）。
   */
  onActionDone?: () => void;
  /**
   * 详情加载成功后回调（把 `instance` 交给父组件——抽屉用它渲染 SheetHeader 的
   * 业务单号 + 状态徽标）。用 ref 承接，避免把易变的回调放进 `load` 依赖造成重复请求。
   */
  onLoaded?: (instance: WfInstance) => void;
}

export function ProcessShell({
  instanceId,
  variant = 'page',
  onActionDone,
  onLoaded,
}: ProcessShellProps) {
  const isEmbedded = variant === 'embedded';
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? '';
  // P0-6：面包屑首级取「跳转来源」，直接输 URL 时回落 /task/pending（仅 page 变体用）
  const returnPathState = useReturnPath();

  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  /**
   * P0-7 队列：进入本页时待处理的其他流程实例 ID。
   * 数据来源是 `/tasks/my`（本页已有的待办接口），本轮不新增后端队列接口；
   * 用户在本页批完一条后自动跳下一条，队列耗尽则留在原地给出去向。
   * ⚠️ 仅 `page` 变体启用；`embedded`（抽屉）关闭队列，不做跨条跳转（设计 §2.1）。
   */
  const [queue, setQueue] = useState<string[]>([]);
  const navigate = useNavigate();
  /** 已处理条数，用于「已连续处理 N 条」文案（仅 page 变体）。 */
  const [doneCount, setDoneCount] = useState(0);

  // 转办内联输入（仅 embedded）：本轮降级为「输入工号/用户 ID」（设计 §2.2 / §11.1）。
  const [transferOpen, setTransferOpen] = useState(false);
  const [newAssigneeId, setNewAssigneeId] = useState('');
  const [newAssigneeName, setNewAssigneeName] = useState('');
  const [transferring, setTransferring] = useState(false);

  // onLoaded 用 ref 承接：避免父组件回调身份变化导致 load 重建、重复拉取。
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchProcessDetail(instanceId, TENANT_ID);
      setDetail(d);
      onLoadedRef.current?.(d.instance);
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
   * 载入待处理队列（用于「批完自动续下一条」）——**仅 page 变体**。
   * embedded（抽屉）关闭队列：抽屉内不做跨条跳转，动作完成交由父组件处理（设计 §2.1）。
   * 只取有流程实例的 PENDING 待办；失败静默降级为「无队列」，不影响本页正常处理。
   */
  useEffect(() => {
    if (isEmbedded || !userId) return;
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
  }, [isEmbedded, userId, instanceId]);

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
        // 动作分派纪律（红线）：同意/驳回一律走 **wfTask** 端点，绝不用 /tasks/{id}/handle。
        const res = await api.post<ApiResult<null>>(
          `/workflow/tasks/${myPendingTask.id}/complete`,
          { action, comment: action === 'APPROVE' ? '同意' : '驳回' },
          { params: { tenantId: TENANT_ID, operatorId: userId } },
        );
        if (res.data.code !== 0) throw new Error(res.data.message || '处理失败');
        if (isEmbedded) {
          // embedded：不自动刷新、不跳队列，交由父组件关抽屉 + 刷新列表。
          toast.success(action === 'APPROVE' ? '已同意' : '已驳回');
          onActionDone?.();
          return;
        }
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
    [isEmbedded, myPendingTask, userId, load, queue, doneCount, navigate, returnPathState, onActionDone],
  );

  /**
   * 转办（仅 embedded）：改处理人 + 置回 PENDING + 补发通知。
   *
   * <p><b>动作分派纪律（红线，勿混用）</b>：转办走 **sysTask** 端点
   * `POST /tasks/{sysTaskId}/transfer`（wfTask 无 transfer）；同意/驳回走 wfTask 端点（见上方 `handle`）。
   * `sysTaskId` 缺失时按钮置灰、绝不发请求（降级，不报错）。
   */
  const transfer = useCallback(async () => {
    const sysTaskId = myPendingTask?.sysTaskId;
    if (!sysTaskId) return;
    const assignee = newAssigneeId.trim();
    if (!assignee) return;
    setTransferring(true);
    try {
      await transferTask(sysTaskId, TENANT_ID, userId, assignee, newAssigneeName.trim() || undefined);
      toast.success('已转办');
      onActionDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转办失败');
    } finally {
      setTransferring(false);
      setTransferOpen(false);
    }
  }, [myPendingTask, newAssigneeId, newAssigneeName, userId, onActionDone]);

  if (loading && !detail) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载流程…</div>;
  }
  if (error && !detail) {
    return <div className="flex h-40 items-center justify-center text-sm text-destructive">{error}</div>;
  }
  if (!detail) return null;

  const { instance, tasks, history } = detail;

  return (
    <div className={cn('flex flex-col gap-4', !isEmbedded && 'h-full')}>
      {!isEmbedded ? (
        <PageHeader
          title={instance.businessId}
          description={`${instance.definitionCode} · 表单 ${instance.startedFormCode ?? '-'}`}
          breadcrumbs={[
            { label: returnPathState.fromLabel, to: returnPathState.from },
            { label: '流程详情' },
          ]}
        />
      ) : null}

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

      {/*
        中部：业务表单（套壳）+ 审批历史。
        page 变体：`lg:grid-cols-3` 网格，本容器是**唯一滚动容器**（`overflow-auto`）。
        embedded 变体：竖向堆叠、**无 overflow-auto**（由抽屉 SheetContent 内容体做唯一滚动）。
        ⚠️布局约束（方案 §3.1）：套壳内部**不能再加滚动容器**，否则嵌套滚动、滚轮滚不动。
      */}
      <div
        className={cn(
          // 两变体都是单列竖向堆叠（grid-cols-1）；差异只在 page 额外启用三列栅格 + 本容器滚动。
          'grid grid-cols-1 gap-4',
          ...(isEmbedded ? [] : ['min-h-0 flex-1 overflow-auto lg:grid-cols-3']),
        )}
      >
        <div className={cn('flex flex-col gap-3 rounded-md border bg-card p-4', !isEmbedded && 'lg:col-span-2')}>
          {/*
            4 个流程元信息收进`<details>` **默认收起**（方案 §3.1）。
            收而不删：它们是流程元信息不是业务数据，且业务单号已在 header、
            发起人已在顶部任务条，直接删是信息丢失、顶替是语义混乱。
          */}
          <details className="rounded border border-border/60 px-3 py-2" data-testid="process-meta">
            <summary className="cursor-pointer text-[12px] text-muted-foreground">
              查看流程信息（业务类型 / 单号 / 发起人 / 当前节点）
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="process-meta-fields">
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
          </details>

          {/*
            ⚠️ 审批栏在**本组件之外**（见下方），所以这里无论抛错、降级还是加载中，
            同意/驳回都依然可点——这是方案 §3.3 的硬要求。
          */}
          <FormShell
            formCode={instance.startedFormCode}
            formData={detail.formData}
            onRetry={load}
          />
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
        <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
          <div className="flex items-center justify-end gap-3">
            <span className="mr-auto text-[12px] text-muted-foreground">
              当前待办：{myPendingTask.nodeName}
              {!isEmbedded && doneCount > 0 ? ` · 已连续处理 ${doneCount} 条` : ''}
            </span>
            <Button variant="destructive" size="sm" disabled={acting} onClick={() => void handle('REJECT')}>
              驳回
            </Button>
            <Button size="sm" disabled={acting} onClick={() => void handle('APPROVE')}>
              同意
            </Button>
            {isEmbedded ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!myPendingTask.sysTaskId || transferring || acting}
                title={!myPendingTask.sysTaskId ? '该待办无关联 sys_task，暂不支持转办' : undefined}
                onClick={() => setTransferOpen((v) => !v)}
              >
                转办
              </Button>
            ) : null}
          </div>
          {/* 转办内联输入（仅 embedded，且仅在 sysTaskId 存在时展开）——本轮降级为输入工号/用户 ID */}
          {isEmbedded && transferOpen && myPendingTask.sysTaskId ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <Input
                value={newAssigneeId}
                onChange={(e) => setNewAssigneeId(e.target.value)}
                placeholder="新处理人工号（必填）"
                aria-label="新处理人工号"
                className="h-8 w-44"
              />
              <Input
                value={newAssigneeName}
                onChange={(e) => setNewAssigneeName(e.target.value)}
                placeholder="姓名（可选）"
                aria-label="新处理人姓名"
                className="h-8 w-36"
              />
              <Button size="sm" disabled={!newAssigneeId.trim() || transferring} onClick={() => void transfer()}>
                提交转办
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTransferOpen(false)}>
                取消
              </Button>
            </div>
          ) : null}
        </div>
      ) : !isEmbedded && doneCount > 0 && queue.length === 0 ? (
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
