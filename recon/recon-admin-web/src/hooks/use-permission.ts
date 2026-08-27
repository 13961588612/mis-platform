import { useAuthStore } from '@/stores/auth-store';

/**
 * 权限判定 hook（阶段 3：基于壳子下发的 permissions）。
 * <p>
 * 语义（对齐平台 hasPermission）：
 * <ul>
 *   <li>未指定权限码 → 放行</li>
 *   <li>独立运行（未接入会话，user=null）→ 放行（不破坏 dev 联调）</li>
 *   <li>壳内已登录 → 精确判定 permissions.includes(code)；无该码 → 拒绝</li>
 * </ul>
 * 平台侧需在 sys_menu 配置 recon:* 权限码并授权，下发的 permissions 才会包含；
 * 未配置前壳内按钮按「未授权」隐藏属预期（与平台 agent:* 同机制）。
 */
export function usePermission() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  function hasPermission(code?: string): boolean {
    if (!code) return true;
    if (!user) return true; // 独立运行/未接会话：放行
    return permissions.includes(code);
  }

  return { hasPermission, permissions };
}
