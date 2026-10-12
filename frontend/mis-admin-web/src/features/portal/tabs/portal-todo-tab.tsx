import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState, ListError, ListLoading } from '@/components/common/empty-state';
import { PaginationFooter } from '@/components/common/pagination-footer';
import { TaskStatusBadge } from '@/features/taskflow/task-status';
import { TodoDetailDrawer } from '@/features/portal/components/todo-detail-drawer';
import { usePortalLookups } from '@/features/portal/lib/use-portal-lookups';
import { fetchHandledTasks, fetchMyTasks, fetchPortalMatters } from '@/lib/api/tasks';
import { fetchMyProcesses } from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';
import { usePortalTodoTabStore } from '@/stores/portal-todo-tab-store';
import { cn } from '@/lib/utils';
import { TODO_TABS } from '../lib/todo-tabs';
import { fromHandledTask, fromPortalMatter, fromTaskItem, fromWfInstance } from '../lib/todo-adapters';
import type { PortalTodoRow } from '../types';

const PAGE_SIZE = 20;

/**
 * P0 参数打通（plumbing）：待办三来源（`my` / `handled` / `sent`）的应用归属过滤通道。
 *
 * <p>当前**无**「当前 APP」选择来源 ⇒ 恒为空对象 ⇒ 不传该 query ⇒ 与现状逐字等价（零回归）。
 * 未来接入 APP 上下文后，仅需在此提供 `{ scope: 'APP', appCode: 'kb' }` 即可自动透传到
 * URL 查询串。
 */
export const APP_SCOPE_FILTER: { scope?: string; appCode?: string } = Object.freeze({});

/** 流程实例状态徽标（`sent` 源用；与 `my-sent-page.tsx` 的口径一致）。 */
const PROCESS_STATUS: Record<string, { text: string; cls: string }> = {
  RUNNING: { text: '进行中', cls: 'bg-info/10 text-info' },
  COMPLETED: { text: '已完成', cls: 'bg-success/10 text-success' },
  TERMINATED: { text: '已终止', cls: 'bg-destructive/10 text-destructive' },
  SUSPENDED: { text: '已挂起', cls: 'bg-warning/10 text-warning' },
};

function ProcessStatusBadge({ status }: { status: string }) {
  const meta = PROCESS_STATUS[status] ?? PROCESS_STATUS.RUNNING;
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px]', meta.cls)}>
      {meta.text}
    </span>
  );
}

/** 表头单元格基础类：13px、左对齐、列间竖线（首列无）。 */
const TH_CLASS =
  'sticky top-0 z-10 h-9 whitespace-nowrap border-l border-border/60 bg-table-header px-3 text-left align-middle text-[13px] font-medium text-muted-foreground first:border-l-0';
/** 数据单元格基础类：列间竖线（首列无）。 */
const TD_CLASS = 'border-l border-border/60 px-3 py-2 align-middle first:border-l-0';

/**
 * 门户「待办事项」Tab（T03a：聚合 + 显式搜索 + 列表；本轮新增「全部」子 Tab）。
 *
 * <p><b>配置驱动</b>：{@link TODO_TABS}（`lib/todo-tabs.ts`）给出各子 Tab 的
 * `{key,label,source,status}`；本组件用一个 `Tabs` 渲染全部子 Tab，并按当前配置的
 * `source/status` 调对应接口，用 {@link PortalTodoRow} 统一渲染——所有子 Tab 共用一套
 * 列表/搜索/分页/空态，**无复制粘贴**，且字面独立（D-6）。
 *
 * <p><b>「全部」（本轮新增，默认选中）</b>：`source==='matters'` 调
 * `/tasks/matters`（三源 UNION 的**服务端聚合**，非前端合并），行由
 * {@link fromPortalMatter} 适配；状态徽标按行 `category` 判定（`'mySent'` = 流程实例 → 流程徽标，
 * 否则待办徽标）。
 *
 * <p><b>列表为表格</b>：`<table>` 含两列 **「平台 / 关联应用」**（`appCode == null` → 「平台」，
 * 否则应用名，取不到回退 code）与 **「业务类型」**（`null` → 「—」，否则业务分类名，取不到回退 code），
 * 经 {@link usePortalLookups} 统一映射。
 *
 * <p><b>整行可点（R-1）</b>：`<tr>` 配 `role="button"` + `tabIndex` + `onKeyDown`(Enter/Space)，
 * 点击打开右侧抽屉（保持原逻辑）。
 *
 * <p><b>搜索（本轮扩展）</b>：「关键词」「发起人」「参与人」三个输入框语义一致——
 * draft/applied 分离（打字不请求）、显式搜索（按钮或回车）才请求、重置清空三者。
 * 「发起人/参与人」作用于**全部子 Tab**，缺省零回归（空白不透传）。
 *
 * <p>布局：滚动容器**单层**（`min-h-0 flex-1 overflow-auto`），表格 `table-fixed` 不横向溢出。
 */
export function PortalTodoTab() {
  const user = useAuthStore((s) => s.user);
  // 单租户阶段固定 tenantId=1（与既有待办/我发起的页同口径）。
  const tenantId = '1';
  const userId = user?.id ?? '';
  const { appNameOf, bizTypeNameOf } = usePortalLookups(tenantId);

  const activeKey = usePortalTodoTabStore((s) => s.activeKey);
  const setActiveKey = usePortalTodoTabStore((s) => s.setActiveKey);
  /** 关键词输入框即时值（受控；**不是**数据加载依赖，故打字不触发请求）。 */
  const [draft, setDraft] = useState('');
  /** 已提交的关键词：只有它变化才触发请求（显式搜索语义）。 */
  const [applied, setApplied] = useState('');
  /** 发起人输入框即时值 / 已提交值（语义同关键词，显式搜索）。 */
  const [initiatorDraft, setInitiatorDraft] = useState('');
  const [initiatorApplied, setInitiatorApplied] = useState('');
  /** 参与人输入框即时值 / 已提交值（语义同关键词，显式搜索）。 */
  const [participantDraft, setParticipantDraft] = useState('');
  const [participantApplied, setParticipantApplied] = useState('');
  const [rows, setRows] = useState<PortalTodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // 抽屉临时态（T03b）：点有实例的行 → 打开右侧抽屉，**不入 URL**（keep-alive 坑，设计 §1.2）。
  const [drawerInstanceId, setDrawerInstanceId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /** 按当前子 Tab 的 source/status 拉取并适配为统一行。依赖只含已提交过滤值/`page`/`activeKey`。 */
  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const tab = TODO_TABS.find((t) => t.key === activeKey) ?? TODO_TABS[0];
    const kw = applied.trim() || undefined;
    const ini = initiatorApplied.trim() || undefined;
    const par = participantApplied.trim() || undefined;
    setLoading(true);
    setError(null);
    try {
      if (tab.source === 'matters') {
        // 「全部」：三源 UNION 服务端聚合。空白参数不透传（零回归）。
        const r = await fetchPortalMatters({
          tenantId,
          userId,
          page,
          size: PAGE_SIZE,
          keyword: kw,
          initiatorName: ini,
          participantName: par,
          ...APP_SCOPE_FILTER,
        });
        setRows(r.list.map(fromPortalMatter));
        setTotal(r.total);
      } else if (tab.source === 'sent') {
        // 参数打通：仅在提供了任一尾部过滤时才追加尾参（缺省 ⇒ 6 参调用 ⇒ 零回归）。
        const scope = APP_SCOPE_FILTER.scope;
        const appCode = APP_SCOPE_FILTER.appCode;
        const r =
          scope || appCode || ini || par
            ? await fetchMyProcesses(tenantId, userId, undefined, page, PAGE_SIZE, kw, scope, appCode, ini, par)
            : await fetchMyProcesses(tenantId, userId, undefined, page, PAGE_SIZE, kw);
        setRows(r.list.map(fromWfInstance));
        setTotal(r.total);
      } else if (tab.source === 'handled') {
        const r = await fetchHandledTasks({
          tenantId,
          assigneeId: userId,
          page,
          size: PAGE_SIZE,
          keyword: kw,
          initiatorName: ini,
          participantName: par,
          ...APP_SCOPE_FILTER,
        });
        setRows(r.list.map(fromHandledTask));
        setTotal(r.total);
      } else {
        const r = await fetchMyTasks({
          tenantId,
          assigneeId: userId,
          status: tab.status,
          page,
          size: PAGE_SIZE,
          keyword: kw,
          initiatorName: ini,
          participantName: par,
          ...APP_SCOPE_FILTER,
        });
        setRows(r.list.map((it) => fromTaskItem(it, { category: tab.key })));
        setTotal(r.total);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [activeKey, userId, tenantId, page, applied, initiatorApplied, participantApplied]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  /** 切子 Tab：回第 1 页（关键词保留，跨类沿用同一搜索词）。 */
  function handleTabChange(value: string) {
    setActiveKey(value);
    setPage(1);
  }

  /** 显式搜索：把三个输入提交为生效过滤值，并回第 1 页。 */
  function handleSearch() {
    setApplied(draft);
    setInitiatorApplied(initiatorDraft);
    setParticipantApplied(participantDraft);
    setPage(1);
  }

  function handleReset() {
    setDraft('');
    setApplied('');
    setInitiatorDraft('');
    setInitiatorApplied('');
    setParticipantDraft('');
    setParticipantApplied('');
    setPage(1);
  }

  /** 发起人 / 处理人展示文案（发起人优先，其次处理人，否则「—」）。 */
  function actorText(row: PortalTodoRow): string {
    if (row.initiatorName) return `发起人 ${row.initiatorName}`;
    if (row.assigneeName) return `处理人 ${row.assigneeName}`;
    return '—';
  }

  /** 打开抽屉查看有实例的待办；无关联流程时降级提示（不入 URL，设计 §1.2）。 */
  function openRow(row: PortalTodoRow) {
    if (row.instanceId) {
      setDrawerInstanceId(row.instanceId);
      setDrawerOpen(true);
      return;
    }
    toast('该待办无关联流程，暂不支持查看');
  }

  /** 抽屉内动作（同意/驳回/转办）成功：关抽屉并刷新当前子 Tab 列表。 */
  function handleDrawerDone() {
    setDrawerOpen(false);
    void load();
  }

  const hasKeyword = applied.trim().length > 0;
  const hasFilter = hasKeyword || initiatorApplied.trim().length > 0 || participantApplied.trim().length > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <Tabs
        value={activeKey}
        onValueChange={handleTabChange}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <TabsList className="w-fit shrink-0">
          {TODO_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* 显式查询：输入不触发请求，只有点「搜索」或回车才查（与用户管理页一致，不用防抖）。
            三个输入框（关键词 / 发起人 / 参与人）语义一致——本期新增后两者，作用于全部子 Tab。 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="搜索标题 / 业务编号"
            aria-label="待办关键词"
            className="h-8 w-56"
          />
          <Input
            value={initiatorDraft}
            onChange={(e) => setInitiatorDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="发起人"
            aria-label="发起人"
            className="h-8 w-40"
          />
          <Input
            value={participantDraft}
            onChange={(e) => setParticipantDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="参与人"
            aria-label="参与人"
            className="h-8 w-40"
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
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title={hasFilter ? '没有匹配的记录' : '暂无记录'}
              description={hasKeyword ? `关键词「${applied.trim()}」无结果` : undefined}
            />
          ) : (
            <table className="w-full table-fixed border-separate border-spacing-0 text-left text-[13px]">
              <colgroup>
                <col />
                <col style={{ width: '12rem' }} />
                <col style={{ width: '9rem' }} />
                <col style={{ width: '8rem' }} />
                <col style={{ width: '9rem' }} />
                <col style={{ width: '9rem' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={TH_CLASS}>标题</th>
                  <th className={TH_CLASS}>业务编号 / 流程</th>
                  <th className={TH_CLASS}>平台 / 关联应用</th>
                  <th className={TH_CLASS}>业务类型</th>
                  <th className={TH_CLASS}>发起人 / 处理人</th>
                  <th className={TH_CLASS}>时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => openRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openRow(row);
                      }
                    }}
                    className="cursor-pointer border-b border-border/50 even:bg-table-stripe hover:bg-table-hover"
                  >
                    <td className={cn(TD_CLASS, 'min-w-0')}>
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{row.title}</span>
                        {row.status ? (
                          // 流程实例行（category='mySent'，来源 sent 或「全部」的 INSTANCE 行）用流程徽标，
                          // 其余用待办徽标。口径见 PortalTodoRow.category 与 fromWfInstance/fromPortalMatter。
                          row.category === 'mySent' ? (
                            <ProcessStatusBadge status={row.status} />
                          ) : (
                            <TaskStatusBadge status={row.status} />
                          )
                        ) : null}
                      </div>
                    </td>
                    <td className={cn(TD_CLASS, 'truncate text-muted-foreground')}>{row.subtitle ?? '—'}</td>
                    <td className={cn(TD_CLASS, 'truncate text-muted-foreground')} title={appNameOf(row.appCode)}>
                      {appNameOf(row.appCode)}
                    </td>
                    <td className={cn(TD_CLASS, 'truncate text-muted-foreground')} title={bizTypeNameOf(row.bizType)}>
                      {bizTypeNameOf(row.bizType)}
                    </td>
                    <td className={cn(TD_CLASS, 'truncate text-muted-foreground')}>{actorText(row)}</td>
                    <td className={cn(TD_CLASS, 'whitespace-nowrap text-muted-foreground')}>
                      {row.createdAt ? row.createdAt.replace('T', ' ').slice(0, 16) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <PaginationFooter total={total} page={page} totalPages={totalPages} onPageChange={setPage} />
      </Tabs>

      {/* 右侧划入抽屉（T03b）：不入 URL，靠 useState 打开；动作成功 → onDone 关抽屉 + 刷新列表。 */}
      <TodoDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        instanceId={drawerInstanceId}
        onDone={handleDrawerDone}
      />
    </div>
  );
}

export default PortalTodoTab;
