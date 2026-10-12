import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, FileClock } from 'lucide-react';
import { fetchMyProcesses, type WfInstance } from '@/lib/api/workflow';
import { cn } from '@/lib/utils';
import { TodoDetailDrawer } from './todo-detail-drawer';
import { PortalMetaTags } from './portal-meta-tags';
import { usePortalLookups } from '../lib/use-portal-lookups';
import { usePortalEntry } from '../lib/use-portal-entry';

interface ProcessBoardProps {
  tenantId: string;
  userId: string;
}

const STATUS: Record<string, { text: string; cls: string }> = {
  RUNNING: { text: '进行中', cls: 'bg-info/10 text-info' },
  COMPLETED: { text: '已完成', cls: 'bg-success/10 text-success' },
  TERMINATED: { text: '已终止', cls: 'bg-destructive/10 text-destructive' },
  SUSPENDED: { text: '已挂起', cls: 'bg-warning/10 text-warning' },
};

/**
 * 工作台主体：我发起的流程。
 *
 * <p><b>点行的去向（UI 精修轮）</b>：点某条 → 就地打开 {@link TodoDetailDrawer}，
 * `instanceId` 直接取该条的 `id`（本板的行本身就是流程实例 `WfInstance`），
 * 不再跳 `/task/process/{id}` 整页。抽屉临时态**由本组件自持**（`useState`，
 * 关闭即销毁、不进 URL），与门户其它板自持约定一致。
 *
 * <p><b>本轮改动（门内切 Tab）</b>：右上角「查看全部」原先 `navigate('/task/my-sent')`
 * 跳出门户，现改为经 {@link usePortalEntry} 切到门户「待办事项」Tab 的
 * 「我发起的」子 Tab，**URL 恒为 `/portal`**，与另外两块板的「查看全部」口径统一。
 */
export function ProcessBoard({ tenantId, userId }: ProcessBoardProps) {
  const entry = usePortalEntry();
  const { appNameOf, bizTypeNameOf } = usePortalLookups(tenantId);
  const [items, setItems] = useState<WfInstance[]>([]);
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
      const r = await fetchMyProcesses(tenantId, userId, undefined, 1, 4);
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

  /** 点某条流程：开抽屉，行本身即流程实例（id 直接用）。 */
  function open(item: WfInstance) {
    setDrawerInstanceId(String(item.id));
    setDrawerOpen(true);
  }

  /** 抽屉内动作成功：关抽屉 + 刷新本板列表。 */
  function handleDrawerDone() {
    setDrawerOpen(false);
    void load();
  }

  return (
    <section className="rounded-lg border bg-card shadow-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">我发起的</h2>
        <button
          type="button"
          onClick={() => entry.open('mySent')}
          className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground transition hover:text-primary"
        >
          查看全部 <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </header>

      {loading ? (
        <div className="flex h-24 items-center justify-center text-[13px] text-muted-foreground">加载中…</div>
      ) : error ? (
        <div className="flex h-24 flex-col items-center justify-center gap-1 text-[13px] text-destructive">
          {error}
          <button type="button" className="text-[12px] underline" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-24 flex-col items-center justify-center gap-1 text-[13px] text-muted-foreground">
          <FileClock className="h-5 w-5 opacity-40" />
          暂无发起的流程
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const st = STATUS[item.status] ?? STATUS.RUNNING;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {item.businessType} / {item.businessId}
                  </span>
                  <PortalMetaTags appName={appNameOf(item.appCode)} bizTypeName={bizTypeNameOf(item.businessType)} />
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', st.cls)}>{st.text}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        右侧划入抽屉（UI 精修轮新增）。`Sheet` 是独立浮层层（portal），与首页
        `overflow-auto` 容器互不影响；抽屉内容体是唯一滚动容器，内嵌
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

export default ProcessBoard;