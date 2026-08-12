/**
 * 智能体运营控制台统一页面壳（T05 批 1 升级）。
 *
 * <p>T01 时它只是「PageHeader + 功能建设中」的占位；T05 起它是 ui.md §1 强制要求的
 * **Loading / Empty / Error 三态**唯一落点（impl-plan §10.1 约定 5）。
 * 页面自己不许再手写「加载中…」「暂无数据」的 div，否则三态在 12 个页面里会长出 12 种样子。
 *
 * <p>props：
 *   - title       页面标题（必填，与 `lib/nav/agent-nav.ts` 的叶节点 title 保持一致）
 *   - description 副标题（可选）
 *   - permission  页面级权限码（可选）：传入则包一层 `PermissionGate`，
 *                 无权限时显示「无权限」而非「功能建设中」——两者语义完全不同，不能混。
 *   - actions     页头右侧操作区（新建按钮、刷新等）
 *   - loading     true → 渲染 Loader2 旋转态
 *   - error       非空 → 渲染红卡；配 `onRetry` 出现「重试」按钮
 *   - empty       true → 渲染中性空态
 *   - children    正常内容
 *
 * <p>**状态优先级**：error > loading > empty > children > 「功能建设中」兜底。
 * error 排在 loading 前面：请求失败后若仍显示转圈，用户会一直等一个永远不来的结果。
 *
 * <p>**给调用方的建议**：列表页传 `loading={loading && rows.length === 0}`，
 * 让"首次加载"转圈、"刷新"保留旧数据，避免每次刷新整页闪白。
 *
 * <p>**T05 批 3 增量：额外导出 `AgentContentState`**（不改 `AgentPageShell` 任何既有行为）。
 * 起因是两类场景把「三态」与「页头」的耦合暴露了出来：
 *   1. **详情 Tab**（`/agent/agents/:id/{skills|config|coordination}`）的内容组件被
 *      `agent-detail-route.tsx` 渲染在**已有** `AgentPageShell` 内部，再套一层会出现
 *      两个 PageHeader + 两条面包屑；
 *   2. **筛选器必须在 error 态下可用**（会话列表 #27 后端未就绪时返回 501，
 *      用户要能改筛选条件后重试）。若把整页交给 `AgentPageShell error=`，
 *      筛选器会被错误卡一起吞掉，用户只能干瞪眼。
 * 于是把「只渲染三态内容、不带页头」的那部分抽成 `AgentContentState`，
 * `AgentPageShell` 内部复用它 —— 单一实现，三态外观在 12 个页面里保持一致。
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Construction, Inbox, Loader2, RotateCcw } from 'lucide-react';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PermissionGate } from '@/components/auth/permission-gate';

export interface AgentPageShellProps {
  title: string;
  description?: string;
  permission?: string | null;
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  /** 空态主文案，默认「暂无数据」。 */
  emptyText?: string;
  /** 空态副文案（如「点击右上角新建」）。 */
  emptyHint?: string;
  onRetry?: () => void;
  children?: ReactNode;
}

/** 无权限时的占位（不进入「功能建设中」，避免误导为「尚未开发」）。 */
function NoPermissionFallback({ title }: { title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title })} />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">你没有访问该页面的权限。</p>
      </div>
    </div>
  );
}

/** 加载态：居中转圈，高度撑满剩余区域，避免加载完成后内容跳动。 */
function LoadingState() {
  return (
    <div className="flex min-h-[16rem] flex-1 flex-col items-center justify-center gap-3">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">加载中…</p>
    </div>
  );
}

/** 错误态：红卡 + 可选重试。 */
function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="flex flex-1 items-center justify-center border-destructive/40 bg-destructive/5">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <AlertTriangle className="h-7 w-7 text-destructive" />
        <p className="text-sm font-medium text-destructive">加载失败</p>
        <p className="max-w-lg break-words text-xs text-muted-foreground">{message}</p>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw className="h-4 w-4" />
            重试
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** 空态：中性措辞，不要写成「出错了」。 */
function EmptyState({ text, hint }: { text: string; hint?: string }) {
  return (
    <Card className="flex flex-1 items-center justify-center border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Inbox className="h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{text}</p>
        {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/** T01 遗留兜底：既没内容也没三态时，说明这页还没接线。 */
function UnderConstructionState() {
  return (
    <Card className="flex flex-1 items-center justify-center border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Construction className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">功能建设中</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          该模块将在后续批次逐步上线。当前为占位页面，用于验收导航与路由可达性。
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * 三态内容块（**不含** PageHeader）。
 *
 * <p>用于「页面内某个区域」需要独立三态的场景：详情 Tab 的内容区、
 * 列表页的表格区（筛选器留在外面，error 时仍可操作）。
 * 状态优先级与 `AgentPageShell` 完全一致：error > loading > empty > children > fallback。
 */
export interface AgentContentStateProps {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
  emptyHint?: string;
  onRetry?: () => void;
  /** 三态都不命中且 `children` 为空时的兜底；默认 `null`（什么都不渲染）。 */
  fallback?: ReactNode;
  children?: ReactNode;
}

export function AgentContentState({
  loading = false,
  error = null,
  empty = false,
  emptyText = '暂无数据',
  emptyHint,
  onRetry,
  fallback = null,
  children,
}: AgentContentStateProps) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading) return <LoadingState />;
  if (empty) return <EmptyState text={emptyText} hint={emptyHint} />;
  if (children) return <>{children}</>;
  return <>{fallback}</>;
}

export function AgentPageShell({
  title,
  description,
  permission,
  actions,
  loading = false,
  error = null,
  empty = false,
  emptyText = '暂无数据',
  emptyHint,
  onRetry,
  children,
}: AgentPageShellProps) {
  const content: ReactNode = (
    <AgentContentState
      loading={loading}
      error={error}
      empty={empty}
      emptyText={emptyText}
      emptyHint={emptyHint}
      onRetry={onRetry}
      fallback={<UnderConstructionState />}
    >
      {children}
    </AgentContentState>
  );

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title })}
        actions={actions}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {content}
      </div>
    </div>
  );

  if (permission) {
    return (
      <PermissionGate permission={permission} fallback={<NoPermissionFallback title={title} />}>
        {body}
      </PermissionGate>
    );
  }
  return body;
}
