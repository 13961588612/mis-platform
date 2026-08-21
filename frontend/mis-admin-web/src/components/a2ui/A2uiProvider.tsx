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
import { callBffAction } from './bff-actions';
import { getActionBinding } from './registry';
import { A2uiContext, type A2uiContextValue } from './a2ui-context';
import type { A2uiClientAction } from '@/lib/a2ui/types';

export type { A2uiContextValue } from './a2ui-context';
export { useA2ui } from './a2ui-context';

export interface A2uiProviderProps {
  /** 用户操作回传（由 chat-core 的 dispatchA2uiAction 注入）。 */
  dispatchAction: (action: A2uiClientAction) => void;
  children: ReactNode;
}

export function A2uiProvider({ dispatchAction, children }: A2uiProviderProps) {
  const activeSurfaceId = useSurfaceStore((s) => s.activeSurfaceId);

  const value = useMemo<A2uiContextValue>(
    () => ({
      dispatchAction,
      executeBffAction: async (componentName, action, payload) => {
        const binding = getActionBinding(componentName, action);
        if (!binding) {
          return {
            ok: false,
            error: {
              code: 4004,
              message: `组件 ${componentName} 的操作 ${action} 未映射到 BFF API`,
              missingPermissions: [],
              permissionDenied: true,
            },
          };
        }
        return callBffAction(binding, payload);
      },
      activeSurfaceId,
    }),
    [dispatchAction, activeSurfaceId],
  );

  return <A2uiContext.Provider value={value}>{children}</A2uiContext.Provider>;
}

export default A2uiProvider;
