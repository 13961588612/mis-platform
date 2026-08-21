/**
 * A2uiProvider — A2UI 渲染上下文 Provider（T06'）。
 *
 * <p>职责：
 * - 承载 MessageProcessor（纯函数，见 lib/a2ui/MessageProcessor.ts）+ 组件注册表初始化
 * - 提供 `dispatchAction`（用户操作 → Gateway a2ui_action 回传）
 * - 提供 `executeBffAction`（写操作 → bff-actions 调 BFF，403 结构化错误）
 * - 暴露 activeSurfaceId（当前渲染目标，由 MessageProcessor 应用 operations 后更新）
 *
 * <p>组件树内通过 `useA2ui()`（见 a2ui-context.ts）消费；CopilotPanel 与未来的
 * /embed 页共用同一 Provider。context 独立成文件以打破 registry ↔ 组件循环依赖。
 */

import { useMemo, type ReactNode } from 'react';
import { useSurfaceStore } from '@/lib/a2ui/surface-store';
import { getActionBinding } from './registry';
import { A2uiContext, type A2uiContextValue } from './a2ui-context';
import { A2UI_ERROR_CODES, type A2uiClientAction } from '@/lib/a2ui/types';

export type { A2uiContextValue } from './a2ui-context';
export { useA2ui } from './a2ui-context';

export interface A2uiProviderProps {
  /** 用户操作回传（由 chat-core 的 dispatchA2uiAction 注入）。 */
  dispatchAction: (action: A2uiClientAction) => void;
  /**
   * 写操作执行器覆盖（缺省 = bff-actions 直调 BFF）。
   * T07' 嵌入场景注入事件桥适配器（A2UI_EVENT / A2UI_EVENT_RESULT，见 src/embed/embed-bridge.ts）。
   */
  executeBffAction?: A2uiContextValue['executeBffAction'];
  children: ReactNode;
}

export function A2uiProvider({
  dispatchAction,
  executeBffAction: executeBffActionProp,
  children,
}: A2uiProviderProps) {
  const activeSurfaceId = useSurfaceStore((s) => s.activeSurfaceId);

  // 缺省：写操作 → actionApiMap → BFF REST（403 结构化错误由 PermissionErrorBanner 消费）
  // bff-actions/axios 动态 import：不进首屏 bundle（admin 与 embed 均按需拉取）
  const defaultExecuteBffAction = useMemo<A2uiContextValue['executeBffAction']>(
    () => async (componentName, action, payload) => {
      const binding = getActionBinding(componentName, action);
      if (!binding) {
        return {
          ok: false,
          error: {
            code: A2UI_ERROR_CODES.POLICY_UNMAPPED,
            message: `组件 ${componentName} 的操作 ${action} 未映射到 BFF API`,
            missingPermissions: [],
            permissionDenied: true,
          },
        };
      }
      const { callBffAction } = await import('./bff-actions');
      return callBffAction(binding, payload);
    },
    [],
  );

  const executeBffAction = executeBffActionProp ?? defaultExecuteBffAction;

  const value = useMemo<A2uiContextValue>(
    () => ({ dispatchAction, executeBffAction, activeSurfaceId }),
    [dispatchAction, executeBffAction, activeSurfaceId],
  );

  return <A2uiContext.Provider value={value}>{children}</A2uiContext.Provider>;
}

export default A2uiProvider;
