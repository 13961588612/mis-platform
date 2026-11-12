/**
 * PermissionErrorBanner — A2UI 权限错误内联提示条（T06'）。
 *
 * <p>03-permission-design.md §3.4：权限错误不弹 toast 闪现，常驻在组件内，
 * 展示缺失权限码列表，用户可抄录提工单。由 bff-actions 捕获的 403 结构化错误消费。
 */

import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { A2UI_ERROR_CODES, type BffActionError } from '@/lib/a2ui/types';

export interface PermissionErrorBannerProps {
  error?: BffActionError | null;
  className?: string;
}

/** 403 文案（按错误码区分；40303 表示权限源不可用而非用户缺码）。 */
export function permissionErrorMessage(error: BffActionError): string {
  if (error.code === A2UI_ERROR_CODES.ACL_UNAVAILABLE) {
    return '权限服务暂时不可用，已按最小权限拒绝。请稍后重试或联系管理员。';
  }
  if (error.code === A2UI_ERROR_CODES.POLICY_UNMAPPED) {
    return '该操作未映射到权限策略，已拒绝执行。请联系管理员登记接口权限。';
  }
  if (error.missingPermissions.length > 0) {
    return `缺少权限码 ${error.missingPermissions.join('、')}，请联系管理员授权。`;
  }
  return error.message || '权限不足，操作已拒绝。';
}

/** 内联权限错误条（常驻，非 toast）。 */
export function PermissionErrorBanner({ error, className }: PermissionErrorBannerProps) {
  if (!error || !error.permissionDenied) return null;

  return (
    <Alert variant="destructive" className={cn('rounded-md py-2.5', className)}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-xs font-semibold">权限不足</AlertTitle>
      <AlertDescription className="text-xs">
        {permissionErrorMessage(error)}
        {error.missingPermissions.length > 0 ? (
          <code className="ml-1 rounded bg-muted px-1 py-0.5 text-[11px]">
            {error.missingPermissions.join(', ')}
          </code>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export default PermissionErrorBanner;
