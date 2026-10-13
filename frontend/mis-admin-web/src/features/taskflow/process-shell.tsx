/**
 * ProcessShell 流程外壳。
 *
 * <p><b>三种变体</b>：
 * <ul>
 *   <li>{@code embedded}（抽屉）：纵向——表单/流程信息（内含历史·待办⇄进度）→ 底部操作栏（含转办）。</li>
 *   <li>{@code page}：完整页壳内——PageHeader + 左栏（表单下纵向节点/历史）+ 右栏本次审批 + P7 队列。</li>
 *   <li>{@code bare}：无应用壳完整页——同 page 主区布局，无 PageHeader/队列，右栏可转办。</li>
 * </ul>
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, Clock, FileText, GitBranch, ListTree } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common/page-header';
import { FormShell } from '@/features/biz/forms/form-shell';
import { ReadOnlyField, ReadOnlyText } from './readonly-field';
import { ProcessProgressBoard } from './components/process-progress-board';
import { ProcessMetaUpcomingNodes } from './components/process-meta-upcoming-nodes';
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
   * `page`（默认，应用内整页）｜`embedded`（抽屉，原纵向布局）｜`bare`（无壳完整页，新布局）。
   */
  variant?: 'page' | 'embedded' | 'bare';
  /**
   * `embedded` / `bare` 下动作成功后的回调；`page` 沿用 P7 队列续办。
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
  const isBare = variant === 'bare';
  /** 完整页（page/bare）用左右分栏新布局；抽屉仍用原纵向布局。 */
  const useSplitLayout = !isEmbedded;
  const enableTransfer = isEmbedded || isBare;
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
  /** 审批建议（同意/驳回时写入历史 comment）。 */
  const [approveComment, setApproveComment] = useState('');
  /** 表单 ⇄ 流程信息。 */
  const [contentPanel, setContentPanel] = useState<'form' | 'info'>('form');
  /** 流程信息内：审批历史+待办 ⇄ 进度看板。 */
  const [infoSubView, setInfoSubView] = useState<'timeline' | 'progress'>('timeline');

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
   * 载入待处理队列——**仅 page 变体**。embedded / bare 关闭队列。
   */
  useEffect(() => {
    if (variant !== 'page' || !userId) return;
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
  }, [variant, userId, instanceId]);

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
        const comment = approveComment.trim() || (action === 'APPROVE' ? '同意' : '驳回');
        const res = await api.post<ApiResult<null>>(
          `/workflow/tasks/${myPendingTask.id}/complete`,
          { action, comment },
          { params: { tenantId: TENANT_ID, operatorId: userId } },
        );
        if (res.data.code !== 0) throw new Error(res.data.message || '处理失败');
        setApproveComment('');
        if (variant !== 'page') {
          // embedded / bare：不跳队列；抽屉由父组件关 + 刷新。
          toast.success(action === 'APPROVE' ? '已同意' : '已驳回');
          onActionDone?.();
          if (isBare) await load();
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
    [
      variant,
      isBare,
      myPendingTask,
      userId,
      approveComment,
      load,
      queue,
      doneCount,
      navigate,
      returnPathState,
      onActionDone,
    ],
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
  const canApprove = Boolean(myPendingTask);

  const historyList = (
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
  );

  /** 完整页独立卡片；抽屉内嵌在「流程信息」面板。 */
  const historyBlock = (
    <div className="rounded-md border bg-card p-4" data-testid="process-history">
      <h3 className="mb-3 text-[13px] font-semibold">审批历史</h3>
      {historyList}
    </div>
  );

  const processInfoPanel = (
    <div className="space-y-3" data-testid="process-meta">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="process-meta-fields">
        <ReadOnlyField label="业务类型">
          <ReadOnlyText value={instance.businessType} />
        </ReadOnlyField>
        <ReadOnlyField label="业务单号">
          <ReadOnlyText value={instance.businessId} />
        </ReadOnlyField>
        <ReadOnlyField label="流程编码">
          <ReadOnlyText value={instance.definitionCode} />
        </ReadOnlyField>
        <ReadOnlyField label="表单">
          <ReadOnlyText value={instance.startedFormCode ?? '—'} />
        </ReadOnlyField>
        <ReadOnlyField label="发起人（公司）">
          <ReadOnlyText
            value={
              instance.initiatorName
                ? instance.initiatorOrgName
                  ? `${instance.initiatorName}（${instance.initiatorOrgName}）`
                  : instance.initiatorName
                : (instance.initiatorId ?? '—')
            }
          />
        </ReadOnlyField>
        <ReadOnlyField label="当前节点">
          <ReadOnlyText value={instance.currentNodeCode} />
        </ReadOnlyField>
      </div>
      <div className="border-t pt-3" data-testid="process-info-subpanel">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[12px] font-medium">
            {infoSubView === 'timeline' ? '审批历史与待办' : '进度情况'}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={infoSubView === 'timeline' ? '切换到进度情况' : '切换到审批历史与待办'}
            title={infoSubView === 'timeline' ? '查看进度情况' : '查看审批历史与待办'}
            onClick={() =>
              setInfoSubView((v) => (v === 'timeline' ? 'progress' : 'timeline'))
            }
          >
            {infoSubView === 'timeline' ? (
              <GitBranch className="h-3.5 w-3.5" />
            ) : (
              <ListTree className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        {infoSubView === 'timeline' ? (
          <div className="space-y-3" data-testid="process-meta-timeline">
            <div data-testid="process-meta-history">
              <p className="mb-2 text-[12px] text-muted-foreground">审批历史</p>
              {historyList}
            </div>
            <ProcessMetaUpcomingNodes detail={detail} />
          </div>
        ) : (
          <ProcessProgressBoard detail={detail} />
        )}
      </div>
    </div>
  );

  const panelTitle = contentPanel === 'info' ? '流程信息' : null;

  /** 表单 ⇄ 流程信息（进度在信息面板内用图标切换）。 */
  const formOrProgressPanel = (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4" data-testid="process-content-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {panelTitle ? (
          <span className="text-[13px] font-semibold">{panelTitle}</span>
        ) : (
          <span className="text-[13px] font-semibold text-transparent select-none" aria-hidden>
            ·
          </span>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {contentPanel === 'form' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => {
                setInfoSubView('timeline');
                setContentPanel('info');
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              查看流程信息
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => setContentPanel('form')}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回表单
            </Button>
          )}
        </div>
      </div>
      {contentPanel === 'form' ? (
        <FormShell
          formCode={instance.startedFormCode}
          formData={detail.formData}
          onRetry={load}
        />
      ) : (
        processInfoPanel
      )}
    </div>
  );

  // —— 抽屉：纵向（表单/信息/进度 → 底部操作；审批历史在「流程信息」面板内）——
  if (!useSplitLayout) {
    return (
      <div className="flex flex-col gap-4">
        {formOrProgressPanel}
        {myPendingTask ? (
          <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
            <div className="space-y-1.5">
              <label htmlFor="approve-comment-embedded" className="text-[12px] font-medium">
                审批建议
              </label>
              <Textarea
                id="approve-comment-embedded"
                aria-label="审批建议"
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                placeholder="请输入审批建议（可选）"
                rows={3}
                className="min-h-[72px] resize-y text-sm"
                disabled={acting}
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <span className="mr-auto text-[12px] text-muted-foreground">
                当前待办：{myPendingTask.nodeName}
              </span>
              <Button variant="destructive" size="sm" disabled={acting} onClick={() => void handle('REJECT')}>
                驳回
              </Button>
              <Button size="sm" disabled={acting} onClick={() => void handle('APPROVE')}>
                同意
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!myPendingTask.sysTaskId || transferring || acting}
                title={!myPendingTask.sysTaskId ? '该待办无关联 sys_task，暂不支持转办' : undefined}
                onClick={() => setTransferOpen((v) => !v)}
              >
                转办
              </Button>
            </div>
            {transferOpen && myPendingTask.sysTaskId ? (
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
        ) : (
          <div className="rounded-md border bg-muted/20 p-3 text-center text-[12px] text-muted-foreground">
            {instance.status === 'RUNNING' ? '当前节点由他人处理' : '流程已结束'}
          </div>
        )}
      </div>
    );
  }

  const instanceTitle = instance.title?.trim() || instance.businessId;

  // —— 完整页（page / bare）：表单下纵向节点+历史，可审时右栏操作 ——
  return (
    <div className={cn('flex flex-col gap-4', variant === 'page' && 'h-full')}>
      {variant === 'page' ? (
        <PageHeader
          title={instanceTitle}
          breadcrumbs={[
            { label: returnPathState.fromLabel, to: returnPathState.from },
            { label: '流程详情' },
          ]}
        />
      ) : null}

      {/* bare 裸页无 App 壳 / PageHeader：顶部单独展示流程标题 */}
      {isBare ? (
        <header className="border-b pb-3" data-testid="process-bare-title">
          <h1 className="text-lg font-semibold leading-snug">{instanceTitle}</h1>
        </header>
      ) : null}

      <div
        className={cn(
          'grid grid-cols-1 items-start gap-4',
          canApprove && 'sm:grid-cols-[minmax(0,1fr)_240px]',
          variant === 'page' && 'min-h-0 flex-1 overflow-auto',
        )}
      >
        <div className="flex min-w-0 flex-col gap-4" data-testid="process-main-column">
          {formOrProgressPanel}

          <div className="rounded-md border bg-card p-4" data-testid="process-node-timeline">
            <h3 className="mb-3 text-[13px] font-semibold">节点处理</h3>
            <ol className="space-y-3">
              {tasks.map((t) => {
                const done = t.status === 'COMPLETED';
                const active = t.status === 'PENDING';
                return (
                  <li key={t.id} className="flex gap-3 border-l-2 border-border pl-3 text-[12px]">
                    <span className="mt-0.5 shrink-0">
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : active ? (
                        <Clock className="h-4 w-4 text-info" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t.nodeName}</span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px]',
                            done && 'bg-success/10 text-success',
                            active && 'bg-info/10 text-info',
                            !done && !active && 'bg-muted text-muted-foreground',
                          )}
                        >
                          {done ? '已处理' : active ? '处理中' : '待处理'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        处理人 {t.assigneeName ?? t.assigneeId}
                        {t.completedAt
                          ? ` · ${t.completedAt.replace('T', ' ').slice(0, 16)}`
                          : t.createdAt
                            ? ` · 到达 ${t.createdAt.replace('T', ' ').slice(0, 16)}`
                            : ''}
                      </div>
                    </div>
                  </li>
                );
              })}
              {tasks.length === 0 ? (
                <li className="text-[12px] text-muted-foreground">暂无节点任务</li>
              ) : null}
            </ol>
          </div>

          {/* 表单态保留独立审批历史；流程信息内已含历史+进度切换，避免重复 */}
          {contentPanel === 'form' ? historyBlock : null}

          {!canApprove && variant === 'page' && doneCount > 0 && queue.length === 0 ? (
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
          ) : null}

          {!canApprove && (variant !== 'page' || doneCount === 0 || queue.length > 0) ? (
            <div className="rounded-md border bg-muted/20 p-3 text-center text-[12px] text-muted-foreground">
              {instance.status === 'RUNNING' ? '当前节点由他人处理' : '流程已结束'}
            </div>
          ) : null}
        </div>

        {canApprove && myPendingTask ? (
          <aside
            className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:sticky sm:top-0"
            data-testid="process-approve-panel"
            aria-label="本次审批"
          >
            <div>
              <h3 className="text-[13px] font-semibold">本次审批</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                当前待办：{myPendingTask.nodeName}
                {variant === 'page' && doneCount > 0 ? ` · 已连续处理 ${doneCount} 条` : ''}
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="approve-comment-panel" className="text-[12px] font-medium">
                审批建议
              </label>
              <Textarea
                id="approve-comment-panel"
                aria-label="审批建议"
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                placeholder="请输入审批建议（可选）"
                rows={4}
                className="min-h-[88px] resize-y text-sm"
                disabled={acting}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button size="sm" disabled={acting} onClick={() => void handle('APPROVE')}>
                同意
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={acting}
                onClick={() => void handle('REJECT')}
              >
                驳回
              </Button>
              {enableTransfer ? (
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
            {enableTransfer && transferOpen && myPendingTask.sysTaskId ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                <Input
                  value={newAssigneeId}
                  onChange={(e) => setNewAssigneeId(e.target.value)}
                  placeholder="新处理人工号（必填）"
                  aria-label="新处理人工号"
                  className="h-8"
                />
                <Input
                  value={newAssigneeName}
                  onChange={(e) => setNewAssigneeName(e.target.value)}
                  placeholder="姓名（可选）"
                  aria-label="新处理人姓名"
                  className="h-8"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={!newAssigneeId.trim() || transferring}
                    onClick={() => void transfer()}
                  >
                    提交转办
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setTransferOpen(false)}>
                    取消
                  </Button>
                </div>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export default ProcessShell;
