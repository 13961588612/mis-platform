import type { ReactNode } from 'react';
import { usePermission } from '@/hooks/use-permission';

/**
 * 按钮/区块级权限门（阶段 3：对齐平台 PermissionGate）。
 * 无权限码 → 放行；无会话 → 仅独立本地开发放行；已登录但缺码 → 渲染 fallback（默认 null）。
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasPermission } = usePermission();
  if (!hasPermission(permission)) return <>{fallback}</>;
  return <>{children}</>;
}
