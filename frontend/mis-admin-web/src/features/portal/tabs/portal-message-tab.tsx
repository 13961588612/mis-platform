import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, Search } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState, ListError, ListLoading } from '@/components/common/empty-state';
import { PaginationFooter } from '@/components/common/pagination-footer';
import { UnreadDot } from '@/components/common/unread-dot';
import { MessageDetailDrawer } from '@/features/portal/components/message-detail-drawer';
import { usePortalLookups } from '@/features/portal/lib/use-portal-lookups';
import {
  fetchInbox,
  fetchMessageStats,
  markMessagesRead,
  searchMessages,
  type MessageItem,
  type MessageStats,
} from '@/lib/api/messages';
import { useAuthStore } from '@/stores/auth-store';
import { MessageManagePanel } from '@/features/portal/components/message-manage-panel';
import { cn } from '@/lib/utils';
import { formatDateTimeSec } from '../lib/format-datetime';

const PAGE_SIZE = 20;

/**
 * P0 参数打通（plumbing）：消息查询的应用归属过滤通道（`scope` / `appCode`）。
 *
 * <p>当前**无**「当前 APP」选择来源 ⇒ 恒为空对象 ⇒ 不传该 query ⇒ 与现状逐字等价（零回归）。
 * 未来接入 APP 上下文后，仅需在此提供 `{ scope: 'APP', appCode: 'kb' }` 即可自动透传到
 * URL 查询串；后端 `scope=APP&appCode=...` 过滤能力已就绪（见 `GET /messages/inbox`）。
 */
export const APP_SCOPE_FILTER: { scope?: string; appCode?: string } = Object.freeze({});

/**
 * 消息子 Tab（设计 §2.3 / §8.2 T04；本轮新增「全部」并设为默认）。
 *
 * <p>首位「全部」为聚合视图：**不传 `msgType`**（后端 BFF `GET /messages/inbox`、`/messages/search`
 * 的 `msgType` 均为 `required=false`，缺省 = 不过滤类型）；其余四类为业务子类，传对应 `msgType`。
 *
 * <p>严格四类：审批 `APPROVAL` / 通知 `NOTIFY` / 提醒 `REMIND` / 系统告警 `SYSTEM_ALERT`。
 * 用户口语的「通过」= 结果通知，归入 `NOTIFY`，**不是独立类型**。默认第一类「全部」。
 */
export const MSG_TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'APPROVAL', label: '审批' },
  { key: 'NOTIFY', label: '通知' },
  { key: 'REMIND', label: '提醒' },
  { key: 'SYSTEM_ALERT', label: '系统告警' },
] as const;

export const DEFAULT_MSG_TAB_KEY = 'ALL';

/** 表头单元格基础类：13px、左对齐、列间竖线（首列无）。 */
const TH_CLASS =
  'sticky top-0 z-10 h-9 whitespace-nowrap border-l border-border/60 bg-table-header px-3 text-left align-middle text-[13px] font-medium text-muted-foreground first:border-l-0';
/** 数据单元格基础类：列间竖线（首列无）。 */
const TD_CLASS = 'border-l border-border/60 px-3 py-2 align-middle first:border-l-0';

/**
 * 门户「消息中心」Tab（T04：四类聚合 + 显式搜索 + 列表 + 详情抽屉）。
 *
 * <p><b>首 Tab 如何复用 inbox 范式</b>：结构与 `inbox-page.tsx` 同构（子 Tab + 搜索 + 列表 +
 * 右侧抽屉 + 标已读），差异在：①子 Tab 为「全部 + 固定四类」且**默认「全部」**（聚合：不传 msgType）；②搜索为**显式查询**
 * （点「搜索」/回车才发请求）；③抽屉抽成独立组件 `message-detail-drawer.tsx`。
 *
 * <p><b>本轮（列表改表格）</b>：列表由 `<ul>` 卡片行改为 `<table>`，新增两列
 * **「平台 / 关联应用」**（`appCode == null` → 「平台」，否则应用名，取不到回退 code）与
 * **「业务类型」**（`bizType == null` → 「—」，否则业务分类名，取不到回退 code）。
 * 两列取值经 {@link usePortalLookups} 统一映射（两 Tab 复用，避免重复请求）。
 *
 * <p><b>整行可点（R-1）</b>：`<tr>` 配 `role="button"` + `tabIndex` + `onKeyDown`(Enter/Space)，
 * 点击打开右侧抽屉（保持原逻辑）。
 *
 * <p>布局：滚动容器**单层**（`min-h-0 flex-1 overflow-auto`），表格 `table-fixed` 不横向溢出。
 */
export function PortalMessageTab() {
  const user = useAuthStore((s) => s.user);
  const canManage = useAuthStore((s) => s.hasPermission('taskflow:message:manage'));
  const [manageOpen, setManageOpen] = useState(false);
  // 单租户阶段固定 tenantId=1（与门户其它页同口径）。
  const tenantId = '1';
  const userId = user?.id ?? '';
  const { appNameOf, bizTypeNameOf } = usePortalLookups(tenantId);

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

  /**
   * 按当前子 Tab 拉取（空关键词 fetchInbox / 非空 searchMessages）。
   *
   * <p><b>「全部」聚合</b>：`activeKey === 'ALL'` 时**不传 `msgType`**（后端缺省 = 不过滤类型），
   * 其余四类传对应 `msgType`。依赖只含 `applied`/`page`/`activeKey`。
   */
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
      const base = { tenantId, userId, page, size: PAGE_SIZE, ...APP_SCOPE_FILTER };
      const params = activeKey === 'ALL' ? base : { ...base, msgType: activeKey };
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

  if (manageOpen) {
    return (
      <div className="flex h-full flex-col">
        <MessageManagePanel onClose={() => setManageOpen(false)} />
      </div>
    );
  }

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
          <span className="ml-auto flex items-center gap-3 text-[12px] text-muted-foreground">
            {canManage ? (
              <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
                消息管理
              </Button>
            ) : null}
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

        {/* 单层滚动容器：直接放 table，禁 h-full overflow-auto 嵌套。 */}
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
            <table className="w-full table-fixed border-separate border-spacing-0 text-left text-[13px]">
              <colgroup>
                <col />
                <col style={{ width: '9rem' }} />
                <col style={{ width: '8rem' }} />
                <col style={{ width: '7rem' }} />
                <col style={{ width: '11rem' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={TH_CLASS}>标题</th>
                  <th className={TH_CLASS}>平台 / 关联应用</th>
                  <th className={TH_CLASS}>业务类型</th>
                  <th className={TH_CLASS}>发送人</th>
                  <th className={TH_CLASS}>发起时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpen(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleOpen(item);
                      }
                    }}
                    className="cursor-pointer border-b border-border/50 even:bg-table-stripe hover:bg-table-hover"
                  >
                    <td className={cn(TD_CLASS, 'min-w-0')}>
                      <div className="flex items-center gap-2">
                        <UnreadDot read={item.read} unreadClassName="bg-destructive" />
                        <span className={cn('truncate text-[13px] font-normal', !item.read && 'font-medium')}>
                          {item.title}
                        </span>
                        {item.instanceId ? (
                          <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
                            流程
                          </span>
                        ) : null}
                      </div>
                      {item.summary ? (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.summary}</p>
                      ) : null}
                    </td>
                    <td className={cn(TD_CLASS, 'truncate text-[11px] text-muted-foreground')} title={appNameOf(item.appCode)}>
                      {appNameOf(item.appCode)}
                    </td>
                    <td className={cn(TD_CLASS, 'truncate text-[11px] text-muted-foreground')} title={bizTypeNameOf(item.bizType)}>
                      {bizTypeNameOf(item.bizType)}
                    </td>
                    <td className={cn(TD_CLASS, 'truncate text-[11px] text-muted-foreground')}>{item.senderName ?? '系统'}</td>
                    <td className={cn(TD_CLASS, 'whitespace-nowrap text-[11px] text-muted-foreground')}>
                      {formatDateTimeSec(item.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <PaginationFooter total={total} page={page} totalPages={totalPages} onPageChange={setPage} />
      </Tabs>

      {/* 右侧划入抽屉：不入 URL；关联流程时动作成功关抽屉并刷新。 */}
      <MessageDetailDrawer
        open={openId !== null}
        onOpenChange={(v) => !v && setOpenId(null)}
        messageId={openId}
        onDone={() => {
          setOpenId(null);
          void load();
        }}
      />
    </div>
  );
}

export default PortalMessageTab;
