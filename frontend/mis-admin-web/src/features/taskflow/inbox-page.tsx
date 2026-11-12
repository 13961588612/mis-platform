import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Inbox, Loader2, Search } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ListError, ListLoading } from '@/components/common/empty-state';
import { PaginationFooter } from '@/components/common/pagination-footer';
import { UnreadDot } from '@/components/common/unread-dot';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  fetchInbox,
  fetchMessageDetail,
  fetchMessageStats,
  markMessagesRead,
  searchMessages,
  type MessageDetail,
  type MessageItem,
  type MessageStats,
} from '@/lib/api/messages';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

const MSG_TYPE_TABS = [
  { key: '', label: '全部' },
  { key: 'APPROVAL', label: '审批' },
  { key: 'NOTIFY', label: '通知' },
  { key: 'REMIND', label: '提醒' },
  { key: 'SYSTEM_ALERT', label: '系统告警' },
];

const SEARCH_DEBOUNCE_MS = 300;

function formatTime(iso: string | null | undefined): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

/**
 * 流程维度：我的待办 / 消息收件箱（P2）。
 *
 * <p>租户与用户当前从登录态取；后端 P2 以查询参数接收，P3 接入网关身份透传后收紧。
 */
export function InboxPage() {
  const user = useAuthStore((s) => s.user);
  // 单租户阶段固定 tenantId=1；P3 网关身份透传后改为从登录态取。
  const tenantId = '1';
  const userId = user?.id ?? '';

  const [items, setItems] = useState<MessageItem[]>([]);
  const [stats, setStats] = useState<MessageStats>({ unread: 0, total: 0 });
  const [msgType, setMsgType] = useState('');
  /** 输入框即时值（受控，保证打字流畅）。 */
  const [keyword, setKeyword] = useState('');
  /** 防抖后的生效关键词：只有它变化才触发请求，避免「即输即查」。 */
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const size = 20;

  // 抽屉：点消息在右侧展开详情（不再把用户踢去待办页）
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 搜索防抖：300ms 静默期后才发请求
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const params = {
        tenantId,
        userId,
        msgType: msgType || undefined,
        page,
        size,
      };
      const result = debouncedKeyword.trim()
        ? await searchMessages({ ...params, q: debouncedKeyword.trim() })
        : await fetchInbox(params);
      setItems(result.list);
      setTotal(result.total);
      setStats(await fetchMessageStats(tenantId, userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId, msgType, debouncedKeyword, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // 关键词变化后回到第1 页（否则第 3 页搜出空结果）
  const firstKeywordRun = useRef(true);
  useEffect(() => {
    if (firstKeywordRun.current) {
      firstKeywordRun.current = false;
      return;
    }
    setPage(1);
  }, [debouncedKeyword]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total]);

  async function handleMarkRead(ids: string[]) {
    if (!userId || ids.length === 0) return;
    await markMessagesRead(userId, ids);
    await load();
  }

  /** 点消息：开抽屉看正文，未读的顺手标已读（不再跳 /task/pending）。 */
  async function handleOpen(item: MessageItem) {
    setOpenId(item.id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    if (!item.read) {
      // 标已读失败不阻断查看详情
      void handleMarkRead([item.id]).catch(() => undefined);
    }
    try {
      setDetail(await fetchMessageDetail(item.id, userId));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '加载消息详情失败');
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="消息与待办"
        description="统一收件箱：审批、通知、提醒与系统告警"
        actions={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4" />
            未读 <span className="font-semibold text-destructive">{stats.unread}</span> / 共 {stats.total}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {MSG_TYPE_TABS.map((tab) => (
          <button
            key={tab.key || 'all'}
            type="button"
            onClick={() => {
              setMsgType(tab.key);
              setPage(1);
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition',
              msgType === tab.key
                ? 'bg-primary font-medium text-primary-foreground'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted',
            )}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题 / 摘要"
            className="h-8 w-56"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => {
              // 立即生效：跳过防抖等待
              setDebouncedKeyword(keyword);
              setPage(1);
            }}
          >
            <Search className="mr-1 h-3.5 w-3.5" />
            搜索
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {loading ? (
          <ListLoading />
        ) : error ? (
          <ListError message={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title={debouncedKeyword.trim() ? '没有匹配的消息' : '暂无消息'}
            description={debouncedKeyword.trim() ? `关键词「${debouncedKeyword.trim()}」无结果` : undefined}
          />
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-muted/40',
                  !item.read && 'bg-primary/5',
                )}
                onClick={() => void handleOpen(item)}
              >
                <UnreadDot read={item.read} unreadClassName="bg-destructive" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('truncate text-[13px]', !item.read && 'font-semibold')}>
                      {item.title}
                    </span>
                    {item.referenceTaskId ? (
                      <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
                        待办
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
                {!item.read ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleMarkRead([item.id]);
                    }}
                  >
                    标为已读
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <PaginationFooter total={total} page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* 消息详情：右侧抽屉（480px），完整正文不截断 */}
      <Sheet open={openId !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent side="right" className="w-full max-w-[480px]">
          <SheetHeader>
            <SheetTitle>消息详情</SheetTitle>
            <SheetDescription className="text-xs">
              {detailLoading ? '加载中…' : (detail?.category ?? '消息')}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
            {detailLoading ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : detailError ? (
              <ListError message={detailError} />
            ) : detail ? (
              <>
                <div className="space-y-1">
                  <h3 className="text-[15px] font-semibold leading-snug">{detail.title}</h3>
                  {detail.summary ? (
                    <p className="text-[13px] text-muted-foreground">{detail.summary}</p>
                  ) : null}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-y py-3 text-[12px]">
                  <div>
                    <dt className="text-muted-foreground">类型</dt>
                    <dd>{detail.msgType}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">分类</dt>
                    <dd>{detail.category}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">发送人</dt>
                    <dd>{detail.senderName ?? '系统'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">时间</dt>
                    <dd>{formatTime(detail.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">已读</dt>
                    <dd>
                      {detail.readCount}/{detail.totalCount}
                    </dd>
                  </div>
                </dl>
                <div className="space-y-1">
                  <h4 className="text-[13px] font-semibold">正文</h4>
                  {/* 完整正文，不做行数截断 */}
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                    {detail.content || detail.summary || '（无正文）'}
                  </div>
                </div>
                </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default InboxPage;