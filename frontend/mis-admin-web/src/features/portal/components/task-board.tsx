import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Inbox } from 'lucide-react';
import { fetchMyTasks, type TaskItem } from '@/lib/api/tasks';
import { ListError, ListLoading } from '@/components/common/empty-state';
import { PriorityBadge } from '@/components/common/priority-badge';
import { wfInstanceId } from '@/lib/api/wf-instance';
import { TodoDetailDrawer } from './todo-detail-drawer';
import { PortalMetaTags } from './portal-meta-tags';
import { usePortalLookups } from '../lib/use-portal-lookups';
import { usePortalEntry } from '../lib/use-portal-entry';

interface TaskBoardProps {
  tenantId: string;
  userId: string;
}

/**
 * 工作台主体：我的待办（现代商务白卡）。
 *
 * <p><b>点行的去向（UI 精修轮）</b>：有 `wfInstanceId` 的行 → 就地打开
 * {@link TodoDetailDrawer}（右侧划入，看表单 + 审批进度，不必离开工作台）；
 * **无关联流程的行降级为门内切「待办事项」Tab**（不打开空抽屉，那没有信息量 ——
 * 这正是这里不开抽屉的原因：抽屉靠 `instanceId` 拉流程详情，没有实例时它只能
 * 是一片空白，给用户的负反馈比「跳到列表自己找」更差）。
 * 抽屉临时态**由本组件自持**（`useState`，关闭即销毁、不进 URL），与门户待办 /
 * 消息 Tab 的自持约定一致，Board 保持自包含、不必由容器层层下传。
 *
 * <p><b>本轮改动（门内切 Tab）</b>：右上角「查看全部」与上面那条降级分支原先都
 * `navigate('/task/pending')` 跳出门户，现统一改为经 {@link usePortalEntry} 切到
 * 门户「待办事项」Tab 的「待处理」子 Tab，**URL 恒为 `/portal`**，
 * 与另外两块板的「查看全部」口径统一。
 */
export function TaskBoard({ tenantId, userId }: TaskBoardProps) {
  const entry = usePortalEntry();
  const { appNameOf, bizTypeNameOf } = usePortalLookups(tenantId);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 抽屉临时态：与门户待办 Tab 同约定（不入 URL，关闭即销毁）。
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInstanceId, setDrawerInstanceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchMyTasks({ tenantId, assigneeId: userId, status: 'PENDING', page: 1, size: 5 });
      setItems(r.list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 点行：有实例 → 开抽屉；无实例 → **降级为门内切「待办事项」Tab 的「待处理」子 Tab**
   * （不开空抽屉的理由见类注释：抽屉靠 instanceId 拉流程详情，无实例时是空白）。
   */
  function open(item: TaskItem) {
    const inst = wfInstanceId(item);
    if (inst) {
      setDrawerInstanceId(inst);
      setDrawerOpen(true);
      return;
    }
    entry.open('pending');
  }

  /** 抽屉内动作成功：关抽屉 + 刷新本板列表。 */
  function handleDrawerDone() {
    setDrawerOpen(false);
    void load();
  }

  return (
    <section className="rounded-lg border bg-card shadow-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">我的待办</h2>
        <button
          type="button"
          onClick={() => entry.open('pending')}
          className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground transition hover:text-primary"
        >
          查看全部 <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </header>

      {loading ? (
        <ListLoading label="加载中…" compact />
      ) : error ? (
        <ListError message={error} onRetry={() => void load()} compact />
      ) : items.length === 0 ? (
        <div className="flex h-28 flex-col items-center justify-center gap-1 text-[13px] text-muted-foreground">
          <Inbox className="h-5 w-5 opacity-40" />
          暂无待办
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const overdue = item.dueDate != null && new Date(item.dueDate) < new Date();
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-muted/60"
                >
                  <PriorityBadge priority={item.priority} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{item.bizTitle}</span>
                  <PortalMetaTags appName={appNameOf(item.appCode)} bizTypeName={bizTypeNameOf(item.bizType)} />
                  {overdue ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-destructive">
                      <AlertTriangle className="h-3 w-3" /> 逾期
                    </span>
                  ) : item.dueDate ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      截止 {item.dueDate.replace('T', ' ').slice(5, 16)}
                    </span>
                  ) : null}
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        右侧划入抽屉（UI 精修轮新增）。`Sheet` 是**独立的浮层层**（portal），与首页
        `overflow-auto` 容器互不影响；抽屉内容体是唯一滚动容器
        （`min-h-0 flex-1 overflow-auto`，见 todo-detail-drawer.tsx），内嵌
        ProcessShell(embedded) 不再加 overflow-auto —— 单层滚动红线保持不变。
      */}
      <TodoDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        instanceId={drawerInstanceId}
        onDone={handleDrawerDone}
      />
    </section>
  );
}

export default TaskBoard;