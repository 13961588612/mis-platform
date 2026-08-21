/**
 * ApprovalCard — A2UI `approval-card` 组件（shadcn 一处实现，T06'）。
 *
 * <p>渲染权限 `approval:view`（registry 声明）；写操作 `approval:decide`（通过/驳回）
 * 经 bff-actions → BFF `/api/v1/approval/decide` 校验；成功后经 Gateway
 * `a2ui_action` 通知 Agent 继续。403 时 PermissionErrorBanner 内联常驻（非 toast）。
 */

import { useState } from 'react';
import { BadgeCheck, CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PermissionErrorBanner } from '@/components/a2ui/PermissionErrorBanner';
import { useA2ui, useA2uiNode } from '../a2ui-context';
import type { A2uiComponentProps, BffActionError } from '@/lib/a2ui/types';

interface ApprovalField {
  label?: string;
  value?: unknown;
}

/** 解析审批 id（props.approvalId，兼容 approval_id）。 */
function resolveApprovalId(props: Record<string, unknown>): string {
  if (typeof props.approvalId === 'string' && props.approvalId) return props.approvalId;
  if (typeof props.approval_id === 'string' && props.approval_id) return props.approval_id;
  return '';
}

export function ApprovalCard({ props }: A2uiComponentProps) {
  const { executeBffAction, dispatchAction } = useA2ui();
  const node = useA2uiNode();
  const surfaceId = node?.surfaceId ?? '';
  const componentId = node?.componentId ?? '';
  const title = typeof props.title === 'string' ? props.title : '操作审批请求';
  const description = typeof props.description === 'string' ? props.description : '';
  const approvalId = resolveApprovalId(props);
  const fields = Array.isArray(props.fields) ? (props.fields as ApprovalField[]) : [];

  const [responding, setResponding] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [bffError, setBffError] = useState<BffActionError | null>(null);

  const decide = async (action: 'approve' | 'reject'): Promise<void> => {
    if (!approvalId || responding) return;
    setResponding(true);
    setBffError(null);
    const result = await executeBffAction('approval-card', action, {
      approvalId,
      action: action === 'approve' ? 'approved' : 'rejected',
    });
    setResponding(false);
    if (result.ok) {
      setResolved(true);
      // 通知 Agent 继续（Gateway a2ui_action → 中间件 processUserAction）；
      // 携带真实 surface.id 与 node.id，供 Gateway 按定位回传（QA 建议 1）
      dispatchAction({
        surfaceId,
        componentId,
        action,
        payload: { approvalId, decision: action === 'approve' ? 'approved' : 'rejected' },
      });
    } else {
      setBffError(result.error ?? null);
    }
  };

  return (
    <Card className="my-2 w-full overflow-hidden rounded-lg border-primary/30 shadow-none">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
        <Badge variant="warning" className="gap-1">
          <ShieldAlert className="h-3 w-3" />
          需要审批
        </Badge>
        {resolved ? (
          <Badge variant="success" className="gap-1">
            <BadgeCheck className="h-3 w-3" />
            已处理
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 pt-1">
        <div>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description ? (
            <CardDescription className="mt-1 text-xs">{description}</CardDescription>
          ) : null}
        </div>

        {fields.length > 0 ? (
          <dl className="space-y-1 text-xs text-muted-foreground">
            {fields.map((f, i) => (
              <div key={i} className="flex gap-2">
                <dt className="font-medium text-foreground/80">{f.label ?? ''}</dt>
                <dd className="break-all">{String(f.value ?? '')}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {approvalId ? (
          <div className="text-[11px] text-muted-foreground/70">
            审批 ID: <code className="rounded bg-muted px-1 py-0.5">{approvalId.slice(0, 16)}</code>
          </div>
        ) : null}

        <PermissionErrorBanner error={bffError} />

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="default"
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            disabled={responding || resolved || !approvalId}
            onClick={() => void decide('approve')}
          >
            {responding ? (
              <span className="animate-pulse">处理中…</span>
            ) : resolved ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              '同意'
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1 text-destructive hover:bg-destructive/10"
            disabled={responding || resolved || !approvalId}
            onClick={() => void decide('reject')}
          >
            {responding ? (
              <span className="animate-pulse">处理中…</span>
            ) : resolved ? (
              <XCircle className="h-4 w-4" />
            ) : (
              '驳回'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default ApprovalCard;
