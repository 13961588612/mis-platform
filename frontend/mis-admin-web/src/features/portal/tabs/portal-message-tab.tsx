import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, Search } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState, ListError, ListLoading } from '@/components/common/empty-state';
import { PaginationFooter } from '@/components/common/pagination-footer';
import { UnreadDot } from '@/components/common/unread-dot';
import { MessageDetailDrawer } from '@/features/portal/components/message-detail-drawer';
import {
  fetchInbox,
  fetchMessageStats,
  markMessagesRead,
  searchMessages,
  type MessageItem,
  type MessageStats,
} from '@/lib/api/messages';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

/**
 * 消息四类子 Tab（设计 §2.3 / §8.2 T04）。
 *
 * <p>严格四类：审批 `APPROVAL` / 通知 `NOTIFY` / 提醒 `REMIND` / 系统告警 `SYSTEM_ALERT`。
 * 用户口语的「通过」= 结果通知，归入 `NOTIFY`，**不是独立类型**。默认第一类「审批」。
 */
export const MSG_TABS = [
  { key: 'APPROVAL', label: '审批' },
  { key: 'NOTIFY', label: '通知' },
  { key: 'REMIND', label: '提醒' },
  { key: 'SYSTEM_ALERT', label: '系统告警' },
] as const;

export const DEFAULT_MSG_TAB_KEY = MSG_TABS[0].key;

function formatTime(iso: string | null | undefined): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

/**
 * 门户「消息中心」Tab（T04：四类聚合 + 显式搜索 + 列表 + 详情抽屉）。
 *
 * <p><b>四类如何复用 inbox 范式</b>：结构与 `inbox-page.tsx` 同构（子 Tab + 搜索 + 列表 +
 * 右侧抽屉 + 标已读），差异在：①子 Tab 固定四类且**默认「审批」**（inbox 有「全部」，门户不要）；
 * ②搜索为**显式查询**（点「搜索」/回车才发请求），不是 inbox 的 300ms 防抖；
 * ③抽屉抽成独立组件 `message-detail-drawer.tsx`（承载流程表单 + 回复）。
 *
 * <p><b>显式搜索（沿用 T03a 范式）</b>：输入框只更新 `draft`，它不是数据加载依赖；
 * 只有点「搜索」/回车把 `draft` 提交为 `applied`（并 `setPage(1)`）才触发请求，
 * 故「打字过程中绝不发请求」。**空关键词走 `fetchInbox`，非空走 `searchMessages`**。
 *
 * <p><b>点消息</b>：打开右侧抽屉（`openId` 走 `useState`，**不入 URL**——keep-alive 坑，§1.2），
 * 未读的顺手标已读（失败不阻断查看）。
 *
 * <p>布局：列表滚动容器**单层**（`min-h-0 flex-1 overflow-auto`）。
 */
export function PortalMessageTab() {
  const user = useAuthStore((s) => s.user);
  // 单租户阶段固定 tenantId=1（与门户其它页同口径）。
  const tenantId = '1';
  const userId = user?.id ?? '';

  const [activeKey, setActiveKey] = useState<string>(DEFAULT_MSG_TAB_KEY);
  /** 输入框即时值（受控；**不是**数据加载依赖，故打字不触发请求）。 */
  const [draft, setDraft] = useState('');
  /** 已提交的关键词：只有它变化才触发请求（显式搜索语义）。 */
  const [applied, setApplied] = useState('');
  const [items, setItems] = useState<MessageItem[]>([]);
  const [stats, setStats] = useState<MessageStats>({ unread: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // 抽屉临时态（T04）：点消息 → 打开右侧抽屉，**不入 URL**（keep-alive 坑，设计 §1.2）。
  const [openId, setOpenId] = useState<string | null>(null);

  /** 按当前子 Tab 的 msgType 拉取（空关键词 fetchInbox / 非空 searchMessages）。依赖只含 `applied`/`page`/`activeKey`。 */
  const load = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setTotal(0);
      setStats({ unread: 0, total: 0 });
      setLoading(false);
      return;
    }
    const kw = applied.trim();
    setLoading(true);
    setError(null);
    try {
      const params = { tenantId, userId, msgType: activeKey, page, size: PAGE_SIZE };
      const result = kw
        ? await searchMessages({ ...params, q: kw })
        : await fetchInbox(params);
      setItems(result.list);
      setTotal(result.total);
      setStats(await fetchMessageStats(tenantId, userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [activeKey, userId, tenantId, page, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  /** 切子 Tab：回第 1 页（关键词保留，跨类沿用同一搜索词）。 */
  function handleTabChange(value: string) {
    setActiveKey(value);
    setPage(1);
  }

  /** 显式搜索：把输入提交为生效关键词，并回第 1 页。 */
  function handleSearch() {
    setApplied(draft);
    setPage(1);
  }

  function handleReset() {
    setDraft('');
    setApplied('');
    setPage(1);
  }

  /** 点消息：打开抽屉；未读的顺手标已读（失败不阻断查看详情）。 */
  function handleOpen(item: MessageItem) {
    setOpenId(item.id);
    if (!item.read && userId) {
      void markMessagesRead(userId, [item.id])
        .then(() => load())
        .catch(() => undefined);
    }
  }

  const hasKeyword = applied.trim().length > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <Tabs
        value={activeKey}
        onValueChange={handleTabChange}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="w-fit shrink-0">
            {MSG_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <span className="ml-auto text-[12px] text-muted-foreground">
            未读 <span className="font-semibold text-destructive">{stats.unread}</span> / 共 {stats.total}
          </span>
        </div>

        {/* 显式查询：输入不触发请求，只有点「搜索」或回车才查（与待办 Tab 一致，不用防抖）。 */}
        <div className="flex shrink-0 items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="搜索标题 / 摘要"
            aria-label="消息关键词"
            className="h-8 w-56"
          />
          <Button size="sm" variant="outline" onClick={handleSearch}>
            <Search className="mr-1 h-3.5 w-3.5" />
            搜索
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset}>
            重置
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
          {loading ? (
            <ListLoading />
          ) : error ? (
            <ListError message={error} onRetry={() => void load()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-6 w-6" />}
              title={hasKeyword ? '没有匹配的消息' : '暂无消息'}
              description={hasKeyword ? `关键词「${applied.trim()}」无结果` : undefined}
            />
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleOpen(item)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/40',
                      !item.read && 'bg-primary/5',
                    )}
                  >
                    <UnreadDot read={item.read} unreadClassName="bg-destructive" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('truncate text-[13px]', !item.read && 'font-semibold')}>
                          {item.title}
                        </span>
                        {item.instanceId ? (
                          <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
                            流程
                          </span>
                        ) : null}
                      </div>
                      {item.summary ? (
                        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{item.summary}</p>
                      ) : null}
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{item.category}</span>
                        <span>·</span>
                        <span>{item.senderName ?? '系统'}</span>
                        <span>·</span>
                        <span>{formatTime(item.createdAt)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <PaginationFooter total={total} page={page} totalPages={totalPages} onPageChange={setPage} />
      </Tabs>

      {/* 右侧划入抽屉（T04）：不入 URL，靠 useState 打开。 */}
      <MessageDetailDrawer open={openId !== null} onOpenChange={(v) => !v && setOpenId(null)} messageId={openId} />
    </div>
  );
}

export default PortalMessageTab;
