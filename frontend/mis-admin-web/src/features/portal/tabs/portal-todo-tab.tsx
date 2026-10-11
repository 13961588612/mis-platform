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
import { fetchHandledTasks, fetchMyTasks } from '@/lib/api/tasks';
import { fetchMyProcesses } from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';
import { usePortalTodoTabStore } from '@/stores/portal-todo-tab-store';
import { cn } from '@/lib/utils';
import { TODO_TABS } from '../lib/todo-tabs';
import { fromHandledTask, fromTaskItem, fromWfInstance } from '../lib/todo-adapters';
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

/**
 * 门户「待办事项」Tab（T03a：六类聚合 + 显式搜索 + 列表）。
 *
 * <p><b>六类如何配置驱动</b>：{@link TODO_TABS}（`lib/todo-tabs.ts`）给出六类的
 * `{key,label,source,status}`；本组件用一个 `Tabs` 渲染六个子 Tab，并按当前配置的
 * `source/status` 调对应接口，用 {@link PortalTodoRow} 统一渲染——六类共用一套
 * 列表/搜索/分页/空态，**无复制粘贴**，且字面独立（D-6）。
 *
 * <p><b>显式搜索（本批语义，覆盖设计 §1.5 原 300ms 防抖）</b>：输入框只更新 `draft`，
 * 它不是数据加载的依赖；只有点「搜索」/回车把 `draft` 提交为 `applied`（并 `setPage(1)`）
 * 才触发请求，故「打字过程中绝不发请求」。重置清空 `draft`+`applied` 并回第 1 页。
 *
 * <p><b>行点击（T03b）</b>：点有 `instanceId` 的行 → 打开右侧划入抽屉
 * （{@link TodoDetailDrawer}，内嵌 `ProcessShell embedded` + 三动作）；无 `instanceId`
 * 时降级提示。**抽屉不入 URL**（keep-alive 坑，设计 §1.2），故用 `useState` 维护临时态。
 *
 * <p><b>子 Tab 键提升到全局 store（本轮结构改动）</b>：`activeKey` 不再用组件内
 * `useState`，改为订阅 {@link usePortalTodoTabStore}。原因：首页工作台的
 * 「查看全部」/ 概览指标卡在**另一棵组件树**（`PortalHomeTab`）里，原先只能靠跳路由
 * 绕开组件内状态；用户要求这些入口**门内切 Tab**（URL 恒为 `/portal`），
 * 子 Tab 键必须能被外部写入。初值仍为 store 里的 `DEFAULT_TODO_TAB_KEY`（待处理）。
 *
 * <p>布局：列表滚动容器**单层**（`min-h-0 flex-1 overflow-auto`），页内不加内层 padding。
 */
export function PortalTodoTab() {
  const user = useAuthStore((s) => s.user);
  // 单租户阶段固定 tenantId=1（与既有待办/我发起的页同口径）。
  const tenantId = '1';
  const userId = user?.id ?? '';

  const activeKey = usePortalTodoTabStore((s) => s.activeKey);
  const setActiveKey = usePortalTodoTabStore((s) => s.setActiveKey);
  /** 输入框即时值（受控；**不是**数据加载依赖，故打字不触发请求）。 */
  const [draft, setDraft] = useState('');
  /** 已提交的关键词：只有它变化才触发请求（显式搜索语义）。 */
  const [applied, setApplied] = useState('');
  const [rows, setRows] = useState<PortalTodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // 抽屉临时态（T03b）：点有实例的行 → 打开右侧抽屉，**不入 URL**（keep-alive 坑，设计 §1.2）。
  const [drawerInstanceId, setDrawerInstanceId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeTab = useMemo(
    () => TODO_TABS.find((t) => t.key === activeKey) ?? TODO_TABS[0],
    [activeKey],
  );

  /** 按当前子 Tab 的 source/status 拉取并适配为统一行。依赖只含 `applied`/`page`/`activeKey`。 */
  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const tab = TODO_TABS.find((t) => t.key === activeKey) ?? TODO_TABS[0];
    const kw = applied.trim() || undefined;
    setLoading(true);
    setError(null);
    try {
      if (tab.source === 'sent') {
        // 参数打通：仅在提供了 scope/appCode 时才追加尾参（缺省 ⇒ 6 参调用 ⇒ 零回归）。
        const scope = APP_SCOPE_FILTER.scope;
        const appCode = APP_SCOPE_FILTER.appCode;
        const r =
          scope || appCode
            ? await fetchMyProcesses(tenantId, userId, undefined, page, PAGE_SIZE, kw, scope, appCode)
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

        {/* 显式查询：输入不触发请求，只有点「搜索」或回车才查（与用户管理页一致，不用防抖）。 */}
        <div className="flex shrink-0 items-center gap-2">
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
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title={hasKeyword ? '没有匹配的记录' : '暂无记录'}
              description={hasKeyword ? `关键词「${applied.trim()}」无结果` : undefined}
            />
          ) : (
            <ul className="divide-y">
              {rows.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => openRow(row)}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{row.title}</span>
                        {row.status ? (
                          activeTab.source === 'sent' ? (
                            <ProcessStatusBadge status={row.status} />
                          ) : (
                            <TaskStatusBadge status={row.status} />
                          )
                        ) : null}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        {row.subtitle ? (
                          <>
                            <span>{row.subtitle}</span>
                            <span>·</span>
                          </>
                        ) : null}
                        <span>
                          {row.initiatorName
                            ? `发起人 ${row.initiatorName}`
                            : row.assigneeName
                              ? `处理人 ${row.assigneeName}`
                              : '—'}
                        </span>
                        {row.createdAt ? (
                          <>
                            <span>·</span>
                            <span>{row.createdAt.replace('T', ' ').slice(0, 16)}</span>
                          </>
                        ) : null}
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
