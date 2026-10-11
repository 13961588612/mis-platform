import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckSquare, ChevronRight, LayoutDashboard, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { fetchMyTasks, fetchTaskStats, type TaskItem } from '@/lib/api/tasks';
import { fetchInbox, fetchMessageStats, markMessagesRead, type MessageItem } from '@/lib/api/messages';
import { cn } from '@/lib/utils';
import { UnreadDot } from '@/components/common/unread-dot';
import { usePortalTabStore } from '@/stores/portal-tab-store';
import { MessageDetailDrawer } from '@/features/portal/components/message-detail-drawer';

/** 顶栏通知项：待办 / 消息合并流（按时间倒序）。 */
interface NotificationItem {
  id: string;
  /**
   * **原始业务 id**（消息 `messages.id` / 待办 `tasks.id`，无前缀）。
   *
   * <p>与 {@link NotificationItem.id} 严格区分：后者是下拉里的 React key，为了让
   * 待办与消息两类共存而不撞 id 才拼了 `t-` / `m-` 前缀。**业务侧只认 `refId`** ——
   * 消息抽屉要拿它去查详情，若误传 `m-1001` 会查不到。
   */
  refId: string;
  kind: 'task' | 'message';
  title: string;
  body: string;
  time: string;
  /** 排序用的时间戳（ms）；无法解析时为 0，排在最后。 */
  sortAt: number;
  read?: boolean;
  /**
   * 点击后的路由跳转目标。
   *
   * <p>**只有待办项有**：待办点进「我的待办」列表。消息项点开是就地滑出
   * {@link MessageDetailDrawer}（与消息中心同款，流程消息还带只读表单），
   * 不再跳工作台收件箱，故此处为空。
   */
  to?: string;
}

interface HeaderToolkitProps {
  onOpenCommand: () => void;
  className?: string;
  showSearchPill?: boolean;
}

const TENANT_ID = '1';

/**
 * 下拉预览条数上限。
 *
 * <p>待办与消息**各取这么多再合并**（`size: NOTIFICATION_LIMIT`），合并后按
 * 时间倒序截到 {@link NOTIFICATION_LIMIT} 条——两侧都取满才能保证「最近 N 条」
 * 是真正的全局最近 N 条（只取 4+4 时，合并结果会被各自截断的窗口污染）。
 */
const NOTIFICATION_LIMIT = 20;

/** 铃铛数字的展示上限：超过 9 显示「9+」。 */
function badgeText(n: number): string {
  return n > 9 ? '9+' : String(n);
}

/** ISO 时间串 → 毫秒时间戳；无法解析时返回 0（排序时沉底，不抛错）。 */
function toTimestamp(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * 全局顶栏工具区：搜索（⌘K）、通知铃铛、工作台入口。
 *
 * <p>铃铛接真实数据（待办 + 消息），不再使用演示占位；工作台按钮回到门户。
 *
 * <p>**数字一律取后端stats 接口的权威值**（`GET /tasks/stats` 的 pending、
 * `GET /messages/stats` 的 unread），前端不做加总。改造前这里用
 * `items.filter(n => !n.read).length` 前端假算，而列表接口 `size:4` 截断、
 * 待办的 `read` 又恒为 false，导致消息超4 条时铃铛显示「3」而收件箱显示「57」。
 *
 * <p><b>下拉列表 = 待办 + 消息合计最近 {@link NOTIFICATION_LIMIT} 条</b>：
 * 两侧各取 20 条，合并后按 `createdAt` 倒序（`sortAt` 越大越靠前）截取前 20。
 * 排序键取自两个列表接口都稳定返回的 `createdAt`（`TaskItem.createdAt` /
 * `MessageItem.createdAt`，均为非空 ISO 串）；无法解析的沉底而非丢条。
 * 角标数字**仍只取 stats 权威值**，与列表长度无关（列表是预览，角标是全量计数）。
 *
 * <p><b>点条目的去向</b>：待办 → `navigate('/task/pending')`（进「我的待办」列表）；
 * 消息 → **就地滑出 {@link MessageDetailDrawer}**，与门户「消息中心」点消息完全同款。
 * 改造前消息项也走 `navigate('/task/inbox')`，用户必须自己在列表里再点一次才能看到
 * 正文，且流程类消息看不到表单内容。现在复用同一个抽屉组件，流程消息（`instanceId != null`）
 * 会自动拉流程详情并渲染只读 `FormShell`。
 *
 * <p><b>点消息还顺手标已读</b>：与门户 `portal-message-tab.tsx` 的 `handleOpen` 同一套
 * 口径——未读的（`!n.read`）才发 `markMessagesRead(userId, [refId])`，成功后 `load()` 重刷
 * 角标与列表。这是「和消息中心一个效果」不可缺的一环：否则用户点开一条未读消息看到了详情，
 * 铃铛角标却纹丝不动，体验上就是「点了没反应」。**失败不阻断**（`.catch(() => undefined)`）：
 * 标已读是副产物，不能因它失败而挡住用户看详情。
 *
 * <p><b>底部按钮「打开消息中心」</b>：`navigate('/portal')` + 写
 * {@link usePortalTabStore} 的 `activeTab`（门户三 Tab 不进 URL，见该 store 注释）。
 * 这样从顶栏能真正落到门户的「消息中心」页签，而不是停在默认「首页」。
 */
export function HeaderToolkit({ onOpenCommand, className, showSearchPill = true }: HeaderToolkitProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? '';

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  /** 待办待处理数（`GET /tasks/stats`.pending），铃铛数字的权威来源。 */
  const [pendingCount, setPendingCount] = useState(0);
  /** 消息未读数（`GET /messages/stats`.unread），铃铛数字的权威来源。 */
  const [unreadCount, setUnreadCount] = useState(0);
  /**
   * 铃铛里被点开的那条消息的**原始 id**（无 `m-` 前缀）；`null` 表示抽屉关闭。
   *
   * <p>与门户「消息中心」同款：点消息就地滑出 {@link MessageDetailDrawer}，不再跳
   * 工作台收件箱。抽屉内部对流程类消息（`instanceId != null`）会额外拉流程详情并渲染
   * 只读表单，所以「跟流程有关的消息要看到表单内容」这条无需在本文件重复实现。
   */
  const [detailMessageId, setDetailMessageId] = useState<string | null>(null);
  /** 门户 Tab 激活态写入器：底部「打开消息中心」用它把门户切到消息页签。 */
  const setPortalTab = usePortalTabStore((s) => s.setActiveTab);

  const load = useCallback(async () => {
    if (!userId) return;
    const statsTask = fetchTaskStats(TENANT_ID, userId).catch(() => null);
    const statsMsg = fetchMessageStats(TENANT_ID, userId).catch(() => null);
    try {
      //两侧各取 NOTIFICATION_LIMIT 条：合并后按时间倒序取前 NOTIFICATION_LIMIT，
      // 才是真正的「待办 + 消息合计最近 N 条」（任一侧被截断都会污染窗口）。
      const [tasks, messages] = await Promise.allSettled([
        fetchMyTasks({
          tenantId: TENANT_ID,
          assigneeId: userId,
          status: 'PENDING',
          page: 1,
          size: NOTIFICATION_LIMIT,
        }),
        fetchInbox({ tenantId: TENANT_ID, userId, page: 1, size: NOTIFICATION_LIMIT }),
      ]);

      const out: NotificationItem[] = [];
      if (tasks.status === 'fulfilled') {
        for (const t of tasks.value.list as TaskItem[]) {
          out.push({
            id: `t-${t.id}`,
            refId: String(t.id),
            kind: 'task',
            title: t.bizTitle,
            body: `${t.taskType} · 待你处理`,
            time: t.dueDate ? `截止 ${t.dueDate.replace('T', ' ').slice(5, 16)}` : '',
            // 排序用列表接口稳定返回的 createdAt（非空 ISO 串），与展示的「截止时间」无关。
            sortAt: toTimestamp(t.createdAt),
            // 待办列表接口不返回可靠的已读语义（历史实现恒为 false），这里不参与未读计算，
            // 未读数字只看下面的 unreadCount（后端 stats 权威值）。
            to: '/task/pending',
          });
        }
      }
      if (messages.status === 'fulfilled') {
        for (const m of messages.value.list as MessageItem[]) {
          out.push({
            id: `m-${m.id}`,
            refId: String(m.id),
            kind: 'message',
            title: m.title,
            body: m.summary ?? '',
            time: m.createdAt ? m.createdAt.replace('T', ' ').slice(5, 16) : '',
            sortAt: toTimestamp(m.createdAt),
            read: m.read,
            // ⚠️ 消息项**故意不填** `to`：点开是就地滑出消息详情抽屉（见下方
            // `MessageDetailDrawer`），不再 navigate 到工作台收件箱列表。
          });
        }
      }
      // 时间倒序（新的在前）。sortAt 相同（都解析失败）时保持入列顺序：
      // 待办先入、消息后入 —— 这是稳定排序的自然结果，无需额外 tie-break。
      out.sort((a, b) => b.sortAt - a.sortAt);
      setItems(out.slice(0, NOTIFICATION_LIMIT));

      // 统计与列表并行发出；任一失败都不影响铃铛可用（数字回落 0）。
      const [st, sm] = await Promise.all([statsTask, statsMsg]);
      setPendingCount(st?.pending ?? 0);
      setUnreadCount(sm?.unread ?? 0);
    } catch {
      setItems([]);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  // 未处理总数 = 待办待处理（权威 stats）+ 消息未读（权威 stats）。
  // 两个后端计数器的直接呈现，不是「列表长度」的推算：列表只取最近若干条做预览用，
  // 角标反映的是**全量**待处理总量（列表被NOTIFICATION_LIMIT 截断也不影响）。
  const unread = pendingCount + unreadCount;

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      {showSearchPill ? (
        <button
          type="button"
          onClick={onOpenCommand}
          className="hidden min-w-[12rem] items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[13px] text-muted-foreground transition hover:border-primary/35 hover:bg-muted/60 sm:inline-flex"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="text-left">搜索…</span>
          <kbd className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 sm:hidden"
        aria-label="搜索"
        onClick={onOpenCommand}
      >
        <Search className="h-4 w-4" />
      </Button>

      {/* 工作台入口（回门户） */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label="工作台"
        title="工作台"
        onClick={() => navigate('/portal')}
      >
        <LayoutDashboard className="h-4 w-4" />
      </Button>

      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label="通知"
          onClick={() => setOpen((v) => !v)}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground">
              {badgeText(unread)}
            </span>
          ) : null}
        </Button>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="关闭通知"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-md border bg-popover p-1 shadow-card">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-medium">待办与消息</span>
                <span className="text-xs text-muted-foreground">
                  待办 {pendingCount} · 未读 {unreadCount}
                </span>
              </div>
              {items.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无待办或消息</div>
              ) : (
                <ul className="max-h-96 overflow-y-auto py-1">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={cn('flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left hover:bg-accent', !n.read && 'bg-primary/5')}
                        onClick={() => {
                          setOpen(false);
                          if (n.kind === 'message') {
                            // 消息：就地开详情抽屉（流程消息带只读表单），**不跳路由**。
                            setDetailMessageId(n.refId);
                            // 未读的顺手标已读：与门户「消息中心」点消息同款语义
                            // （`portal-message-tab.tsx` handleOpen），补齐「和消息中心
                            // 一个效果」里「角标会随之变化」这一环。**失败不阻断查看详情**
                            // ——标已读只是副产物，用户已经在看抽屉了，不能因它失败而黑屏。
                            if (!n.read && userId) {
                              void markMessagesRead(userId, [n.refId])
                                .then(() => load())
                                .catch(() => undefined);
                            }
                          } else if (n.to) {
                            // 待办：维持原行为，跳「我的待办」列表。
                            navigate(n.to);
                          }
                        }}
                      >
                        {n.kind === 'task' ? (
                          <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                          <UnreadDot read={Boolean(n.read)} className="mt-1 h-1.5 w-1.5" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{n.title}</span>
                            {n.kind === 'task' ? (
                              <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">待办</span>
                            ) : null}
                          </span>
                          {n.body ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.body}</span> : null}
                          {n.time ? <span className="mt-1 block text-[11px] text-muted-foreground">{n.time}</span> : null}
                        </span>
                        <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/*
                 底部入口：打开门户的「消息中心」页签。
                 门户三 Tab 不进 URL（keep-alive 直挂，见 portal-tab-store.ts），所以
                 `navigate` 之后还必须写 store，否则会停在默认「首页」。
               */}
              <button
                type="button"
                className="block w-full border-t px-3 py-2 text-center text-xs text-primary"
                onClick={() => {
                  setOpen(false);
                  setPortalTab('message');
                  navigate('/portal');
                }}
              >
                打开消息中心
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/*
         铃铛消息详情抽屉：与门户「消息中心」复用同一个`MessageDetailDrawer`
         （右侧滑出；流程类消息额外渲染只读表单 + 回复区）。
         挂在铃铛 dropdown 的**同级**（不塞进 dropdown 内部）：Sheet 自带 portal，
         嵌进去反而多一层定位上下文。同目录 `keep-alive-outlet.tsx` 已有
         `components/layout` → `features/*` 的 import 先例。
       */}
      <MessageDetailDrawer
        open={detailMessageId !== null}
        onOpenChange={(v) => {
          if (!v) setDetailMessageId(null);
        }}
        messageId={detailMessageId}
      />
    </div>
  );
}