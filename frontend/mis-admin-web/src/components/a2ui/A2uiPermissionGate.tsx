/**
 * A2uiPermissionGate — A2UI 渲染权限 UX 层门控（T06'）。
 *
 * <p>03-permission-design.md §4.2：前端 registry 声明 requiredPermission 仅影响本地
 * UX（无权组件不渲染，避免"先看到再被拒绝"的闪烁）；安全边界由 Gateway
 * SurfacePermissionFilter 权威过滤兜底。未声明 requiredPermission → 默认可见。
 */

import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';

export interface A2uiPermissionGateProps {
  /** 渲染权限码（undefined = 默认可见）。 */
  requiredPermission?: string;
  /** 无权限时的占位文案（含缺失权限码，可截图抄录）。 */
  deniedText?: string;
  /** 有权限时的内容。 */
  children: ReactNode;
}

/** 权限门控：无权限 → 内联占位（不隐藏结构，保留 id 语义）。 */
export function A2uiPermissionGate({ requiredPermission, deniedText, children }: A2uiPermissionGateProps) {
  const hasPermission = useAuthStore((s) => s.hasPermission);

  if (!requiredPermission) {
    return <>{children}</>;
  }

  if (hasPermission(requiredPermission)) {
    return <>{children}</>;
  }

  const text =
    deniedText ?? `无权限访问此内容（缺少权限码：${requiredPermission}）`;

  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"
    >
      <ShieldAlert className="mt-[0.1rem] h-3.5 w-3.5 shrink-0" />
      <span className="break-all">{text}</span>
    </div>
  );
}

export default A2uiPermissionGate;
