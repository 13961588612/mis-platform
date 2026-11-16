import { useAuthStore } from '@/stores/auth-store';

/**
 * 独立本地开发（非 micro-app 环境）无会话时放行：方便 `pnpm dev` 直连 5176 调试。
 * 壳内或生产构建下无会话一律拒绝——否则直连独立入口会看到全部菜单。
 */
const STANDALONE_DEV = import.meta.env.DEV && !window.__MICRO_APP_ENVIRONMENT__;

/**
 * 权限判定 hook（阶段 3：基于壳子下发的 permissions，后端权威校正后覆盖）。
 * <p>
 * 语义（对齐平台 hasPermission）：
 * <ul>
 *   <li>未指定权限码 → 放行</li>
 *   <li>无会话 → 仅独立本地开发放行，其余拒绝</li>
 *   <li>有会话 → 精确判定 permissions.includes(code)；无该码 → 拒绝</li>
 * </ul>
 * 平台侧需在 sys_menu 配置 recon:* 权限码并授权，下发的 permissions 才会包含；
 * 未配置前壳内按钮按「未授权」隐藏属预期（与平台 agent:* 同机制）。
 */
export function usePermission() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  function hasPermission(code?: string): boolean {
    if (!code) return true;
    if (!user) return STANDALONE_DEV;
    return permissions.includes(code);
  }

  return { hasPermission, permissions };
}
