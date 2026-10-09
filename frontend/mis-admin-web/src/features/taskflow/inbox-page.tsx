import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const MSG_TYPE_TABS = [
  { key: '', label: '全部' },
  { key: 'APPROVAL', label: '审批' },
  { key: 'NOTIFY', label: '通知' },
  { key: 'REMIND', label: '提醒' },
  { key: 'SYSTEM_ALERT', label: '系统告警' },
];

/**
 * 流程维度：我的待办 / 消息收件箱（P2）。
 *
 * <p>租户与用户当前从登录态取；后端 P2 以查询参数接收，P3 接入网关身份透传后收紧。
 */
export function InboxPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  // 单租户阶段固定 tenantId=1；P3 网关身份透传后改为从登录态取。
  const tenantId = '1';
  const userId = user?.id ?? '';

  const [items, setItems] = useState<MessageItem[]>([]);
  const [stats, setStats] = useState<MessageStats>({ unread: 0, total: 0 });
  const [msgType, setMsgType] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const size = 20;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const params = { tenantId, userId, msgType: msgType || undefined, page, size };
      const result = keyword.trim()
        ? await searchMessages({ ...params, q: keyword.trim() })
        : await fetchInbox(params);
      setItems(result.list);
      setTotal(result.total);
      setStats(await fetchMessageStats(tenantId, userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId, msgType, keyword, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total]);

  async function handleMarkRead(ids: string[]) {
    if (!userId || ids.length === 0) return;
    await markMessagesRead(userId, ids);
    await load();
  }

  async function handleOpen(item: MessageItem) {
    if (!item.read) {
      await handleMarkRead([item.id]);
    }
    // P3 接入 ProcessShell 后跳转 /task/pending/{id}；当前先跳待办页
    navigate('/task/pending');
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                void load();
              }
            }}
            placeholder="搜索标题 / 摘要"
            className="h-8 w-56"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPage(1);
              void load();
            }}
          >
            <Search className="mr-1 h-3.5 w-3.5" />
            搜索
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center text-sm text-destructive">{error}</div>
        ) : items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无消息</div>
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
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    item.read ? 'bg-muted-foreground/30' : 'bg-destructive',
                  )}
                />
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
                    <span>{item.createdAt?.replace('T', ' ').slice(0, 16)}</span>
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

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          共 <b className="text-foreground">{total}</b> 条 · 第 {page}/{totalPages} 页
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}

export default InboxPage;