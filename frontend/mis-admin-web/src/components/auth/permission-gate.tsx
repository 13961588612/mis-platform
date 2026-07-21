import type { ReactNode } from 'react';
import { usePermission } from '@/hooks/use-permission';

interface PermissionButtonProps {
  permission?: string | null;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({ permission, children, fallback = null }: PermissionButtonProps) {
  const { hasPermission } = usePermission();
  if (!hasPermission(permission)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
