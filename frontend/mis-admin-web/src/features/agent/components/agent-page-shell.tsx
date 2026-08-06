/**
 * 智能体运营控制台页面空态壳（T01 占位）。
 *
 * <p>所有 12 个菜单页在 T01 阶段共用此壳：渲染 PageHeader + 一个「功能建设中」空态卡片，
 * 保证用户从侧栏点进任何菜单都不会白屏 / 404 / 报错，真实内容在 T02–T05 逐页填充。
 *
 * <p>props：
 *   - title       页面标题（必填，与 `lib/nav/agent-nav.ts` 的叶节点 title 保持一致）
 *   - description 副标题（可选）
 *   - permission  需要的 permission 码（可选）：传入则包一层 `PermissionGate`，
 *                 无权限时显示「无权限」而非「功能建设中」。T01 各页暂不传，预留接口。
 *   - children    真实内容挂载点（T01 不传；T05 直接以真实组件替换本壳即可）
 */
import type { ReactNode } from 'react';
import { Construction } from 'lucide-react';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { PermissionGate } from '@/components/auth/permission-gate';

export interface AgentPageShellProps {
  title: string;
  description?: string;
  permission?: string | null;
  children?: ReactNode;
}

/** 无权限时的占位（不进入「功能建设中」，避免误导为「尚未开发」）。 */
function NoPermissionFallback({ title }: { title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={title}
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title })}
      />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">你没有访问该页面的权限。</p>
      </div>
    </div>
  );
}

export function AgentPageShell({ title, description, permission, children }: AgentPageShellProps) {
  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title })}
      />
      {children ?? (
        <Card className="flex flex-1 items-center justify-center border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Construction className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">功能建设中</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              该模块将在后续迭代（T02–T05）逐步上线。当前为占位页面，用于验收导航与路由可达性。
            </p>
          </CardContent>
        </Card>
      )}
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
