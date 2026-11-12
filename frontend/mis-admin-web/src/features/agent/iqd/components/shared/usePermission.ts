/**
 * usePermission.ts — 建模台权限码 hook（沿用既有 `PermissionGate` / `usePermission`）。
 *
 * <p>三权限码（V87__iqd_modeling_seed.sql 种子，MR-S3）：
 *
 * | 权限码 | 含义 | 前端表现 |
 * |---|---|---|
 * | `iqd:modeling:view`    | 画布只读 / 列表 / 详情可见 | 无 → 不可进页面（40300） |
 * | `iqd:modeling:edit`    | 画布编辑 / 新建模型·关系·Cube / 计算列 / 字段直编 | 无 → 画布只读 |
 * | `iqd:modeling:publish` | 触发构建 / 强制重建 / 重新索引 / 模型校验 | 无 → 发布按钮置灰 |
 *
 * <p><b>为什么单独包一层</b>：权限码字符串是**跨文件契约**（前端 gate / BFF sys_api /
 * mis-iqd {@code @PreAuthorize} 三处必须完全一致）。散写字符串极易漂移，且漂移后果静默
 * （`hasPermission('typo')` 恒 false → 按钮永远置灰，不报错）。集中常量 + 语义化
 * 布尔量（`canEdit` 等）把这类问题收敛到单点。
 *
 * <p>底层仍走既有 `usePermission`（读 `auth-store.permissions`，由 `/auth/menus`
 * 等接口注入，来源 = 角色已授予的 `sys_menu.permission` 集合）。
 *
 * <p><b>本文件是纯 hook（.ts，不含 JSX）</b>：需要按钮/区块级闸门时直接用既有
 * `@/components/auth/permission-gate` 的 `PermissionGate`，把本文件的常量传进
 * `permission` prop 即可 —— 避免再包一层组件、也避免 `.ts` 里出现 JSX。
 */
import { usePermission } from '@/hooks/use-permission';

/** 建模台三权限码（唯一来源，勿在别处硬编码字符串）。 */
export const IQD_MODELING_PERMISSIONS = {
  view: 'iqd:modeling:view',
  edit: 'iqd:modeling:edit',
  publish: 'iqd:modeling:publish',
} as const;

/** 建模台权限判定结果。 */
export interface IqdModelingPermissions {
  /** 画布只读 / 列表 / 详情可见。 */
  canView: boolean;
  /** 画布编辑 / 新建节点 / 计算列 / 字段直编。 */
  canEdit: boolean;
  /** 触发构建 / 强制重建 / 重新索引 / 模型校验。 */
  canPublish: boolean;
  /** 原始判定函数（透传既有 hook，便于组合自定义权限码）。 */
  hasPermission: (code?: string | null) => boolean;
}

/**
 * 建模台权限判定 hook。
 *
 * @returns 三个语义化布尔量 + 透传的 `hasPermission`
 */
export function useIqdModelingPermission(): IqdModelingPermissions {
  const { hasPermission } = usePermission();
  return {
    canView: hasPermission(IQD_MODELING_PERMISSIONS.view),
    canEdit: hasPermission(IQD_MODELING_PERMISSIONS.edit),
    canPublish: hasPermission(IQD_MODELING_PERMISSIONS.publish),
    hasPermission,
  };
}
